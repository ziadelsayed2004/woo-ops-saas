import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { healthResponseSchema } from '@woo-ops/contracts';
import { SqliteStore } from '@woo-ops/persistence';
import {
  canonicalizeStoreUrl,
  createAuthorizationUrl,
  encryptCredentialEnvelope,
} from '@woo-ops/connectors';
import { createHmac, randomBytes } from 'node:crypto';
import { AuthService, can, recordAudit } from './auth.js';

const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.WOO_OPS_DATA_DIR ?? './data');
const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? `${dataDirectory}/woo-ops.sqlite`);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new SqliteStore(databasePath);
const auth = new AuthService(store.db);
const app: Express = express();
const attempts = new Map<string, { count: number; resetAt: number }>();
const callbackSecret = process.env.SESSION_SECRET ?? 'development-only-session-secret';
const signState = (nonce: string): string =>
  `${nonce}.${createHmac('sha256', callbackSecret).update(nonce).digest('base64url')}`;
const readState = (state: string): string | null => {
  const [nonce, signature] = state.split('.');
  if (!nonce || !signature) return null;
  return createHmac('sha256', callbackSecret).update(nonce).digest('base64url') === signature
    ? nonce
    : null;
};

app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.use((request, response, next) => {
  const origin = request.header('origin');
  const expectedOrigin = process.env.WEB_PUBLIC_URL ?? 'http://localhost:5173';
  if (
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method) &&
    origin &&
    origin !== expectedOrigin
  ) {
    response.status(403).json({
      error: {
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  next();
});
app.use((_request, response, next) => {
  response.setHeader('x-correlation-id', randomUUID());
  next();
});
app.get('/health', (_request, response) => {
  const body = healthResponseSchema.parse({
    status: 'ok',
    service: 'api',
    database: 'connected',
    version: '0.1.0',
  });
  response.json(body);
});
app.post('/api/v1/connections/woocommerce/authorize', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  try {
    const storeUrl = canonicalizeStoreUrl(String(request.body?.storeUrl ?? ''));
    const nonce = randomBytes(24).toString('base64url');
    const now = new Date();
    store.db
      .prepare(
        'INSERT INTO authorization_states (state_hash, account_id, user_id, store_url, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        nonce,
        user.accountId,
        user.id,
        storeUrl.toString(),
        new Date(now.getTime() + 600000).toISOString(),
        now.toISOString(),
      );
    const returnUrl = `${process.env.WEB_PUBLIC_URL ?? 'http://localhost:5173'}/connections/woocommerce/callback`;
    const callbackUrl = `${process.env.API_PUBLIC_URL ?? 'http://localhost:3000'}/api/v1/connections/woocommerce/return`;
    response.json({
      authorizationUrl: createAuthorizationUrl(storeUrl, {
        state: signState(nonce),
        returnUrl,
        callbackUrl,
      }),
    });
  } catch (error) {
    response.status(400).json({
      error: {
        code: error instanceof Error ? error.message : 'CONNECTOR_URL_INVALID',
        message: 'Invalid WooCommerce store URL',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
  }
});
app.get('/api/v1/connections/woocommerce/return', (request, response) => {
  const nonce = readState(String(request.query.state ?? ''));
  const key = String(request.query.key ?? '');
  const secret = String(request.query.secret ?? '');
  if (!nonce || !key.startsWith('ck_') || !secret.startsWith('cs_')) {
    response.status(400).json({
      error: {
        code: 'CONNECTOR_CALLBACK_INVALID',
        message: 'Authorization callback is invalid',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const row = store.db
    .prepare(
      'SELECT account_id, user_id, store_url, expires_at, used_at FROM authorization_states WHERE state_hash = ?',
    )
    .get(nonce) as
    | {
        account_id: string;
        user_id: string;
        store_url: string;
        expires_at: string;
        used_at: string | null;
      }
    | undefined;
  if (!row || row.used_at || row.expires_at <= new Date().toISOString()) {
    response.status(400).json({
      error: {
        code: 'CONNECTOR_CALLBACK_REPLAYED',
        message: 'Authorization state expired or already used',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) {
    response.status(503).json({
      error: {
        code: 'CREDENTIAL_ENCRYPTION_UNAVAILABLE',
        message: 'Connector encryption is not configured',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const now = new Date().toISOString();
  store.db.transaction(() => {
    store.db
      .prepare(
        'UPDATE authorization_states SET used_at = ? WHERE state_hash = ? AND used_at IS NULL',
      )
      .run(now, nonce);
    store.db
      .prepare(
        'INSERT INTO connections (id, account_id, platform, store_url, status, encrypted_credentials, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, platform, store_url) DO UPDATE SET status = excluded.status, encrypted_credentials = excluded.encrypted_credentials, updated_at = excluded.updated_at',
      )
      .run(
        randomBytes(16).toString('hex'),
        row.account_id,
        'woocommerce',
        row.store_url,
        'active',
        JSON.stringify(encryptCredentialEnvelope({ key, secret }, encryptionKey)),
        now,
        now,
      );
  })();
  response.json({ connected: true, platform: 'woocommerce', storeUrl: row.store_url });
});
app.post('/api/v1/auth/register', (request, response) => {
  try {
    const key = request.ip ?? 'unknown';
    const current = attempts.get(key);
    if (current && current.resetAt > Date.now() && current.count >= 10) {
      response.status(429).json({
        error: {
          code: 'AUTH_RATE_LIMITED',
          message: 'Too many attempts',
          correlationId: response.getHeader('x-correlation-id'),
        },
      });
      return;
    }
    const user = auth.register(
      String(request.body?.email ?? ''),
      String(request.body?.password ?? ''),
      String(request.body?.accountName ?? ''),
    );
    const loggedIn = auth.login(String(request.body.email), String(request.body.password));
    auth.setCookies(response, loggedIn);
    recordAudit(store.db, {
      accountId: user.accountId,
      actorId: user.id,
      action: 'account.registered',
      targetType: 'account',
      targetId: user.accountId,
      correlationId: String(response.getHeader('x-correlation-id')),
      summary: { role: user.role },
    });
    response.status(201).json({ user });
  } catch (error) {
    const code =
      error instanceof Error && error.message === 'AUTH_ACCOUNT_EXISTS'
        ? 'AUTH_ACCOUNT_EXISTS'
        : 'AUTH_INVALID_INPUT';
    response.status(code === 'AUTH_ACCOUNT_EXISTS' ? 409 : 400).json({
      error: {
        code,
        message:
          code === 'AUTH_ACCOUNT_EXISTS' ? 'Unable to create account' : 'Invalid registration data',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
  }
});
app.post('/api/v1/auth/login', (request, response) => {
  const key = request.ip ?? 'unknown';
  const current = attempts.get(key);
  if (!current || current.resetAt <= Date.now())
    attempts.set(key, { count: 1, resetAt: Date.now() + 900000 });
  else current.count += 1;
  if ((attempts.get(key)?.count ?? 0) > 10) {
    response.status(429).json({
      error: {
        code: 'AUTH_RATE_LIMITED',
        message: 'Too many attempts',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  try {
    const loggedIn = auth.login(
      String(request.body?.email ?? ''),
      String(request.body?.password ?? ''),
    );
    auth.setCookies(response, loggedIn);
    response.json({ user: loggedIn.user });
  } catch {
    response.status(401).json({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
  }
});
app.get('/api/v1/auth/session', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  response.json({ user });
});
app.post('/api/v1/auth/logout', (request, response) => {
  const currentUser = auth.current(request);
  if (!currentUser) {
    response.status(204).end();
    return;
  }
  if (!auth.csrfValid(request)) {
    response.status(403).json({
      error: {
        code: 'CSRF_INVALID',
        message: 'CSRF token required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  auth.logout(request, response);
  recordAudit(store.db, {
    accountId: currentUser.accountId,
    actorId: currentUser.id,
    action: 'auth.logged_out',
    targetType: 'user',
    targetId: currentUser.id,
    correlationId: String(response.getHeader('x-correlation-id')),
    summary: {},
  });
  response.status(204).end();
});
app.get('/api/v1/account', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const account = store.db
    .prepare(
      'SELECT id, name, locale, direction, timezone, base_currency FROM accounts WHERE id = ?',
    )
    .get(user.accountId);
  response.json({ account, user });
});
app.patch('/api/v1/account', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  if (!can(user.role, 'account:write') || !auth.csrfValid(request)) {
    response.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Permission or CSRF validation failed',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const allowed = {
    name: request.body?.name,
    locale: request.body?.locale,
    direction: request.body?.direction,
    timezone: request.body?.timezone,
    base_currency: request.body?.base_currency,
  };
  const current = store.db
    .prepare('SELECT name, locale, direction, timezone, base_currency FROM accounts WHERE id = ?')
    .get(user.accountId) as Record<string, string>;
  const next = {
    ...current,
    ...Object.fromEntries(
      Object.entries(allowed).filter(([, value]) => typeof value === 'string' && value.length > 0),
    ),
  };
  store.db
    .prepare(
      'UPDATE accounts SET name = ?, locale = ?, direction = ?, timezone = ?, base_currency = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      next.name,
      next.locale,
      next.direction,
      next.timezone,
      next.base_currency,
      new Date().toISOString(),
      user.accountId,
    );
  recordAudit(store.db, {
    accountId: user.accountId,
    actorId: user.id,
    action: 'account.updated',
    targetType: 'account',
    targetId: user.accountId,
    correlationId: String(response.getHeader('x-correlation-id')),
    summary: {
      fields: Object.keys(allowed).filter(
        (key) => allowed[key as keyof typeof allowed] !== undefined,
      ),
    },
  });
  response.json({ account: next });
});
app.get('/api/v1/audit-events', (request, response) => {
  const user = auth.current(request);
  if (!user || !can(user.role, 'audit:read')) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const limit = Math.min(Math.max(Number(request.query.limit ?? 50), 1), 100);
  const events = store.db
    .prepare(
      'SELECT id, actor_id, action, target_type, target_id, summary_json, correlation_id, created_at FROM audit_events WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(user.accountId, limit);
  response.json({ items: events, limit });
});
app.get('/api/v1/meta', (_request, response) =>
  response.json({ locale: 'ar-EG', direction: 'rtl', readOnlyConnector: true }),
);

app.listen(port, () => console.log(`Woo Ops API listening on ${port}`));

export { app, store };
