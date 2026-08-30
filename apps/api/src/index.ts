import express, { type Express, type Request, type Response } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  bulkCreateSchema,
  bulkPreviewSchema,
  bulkFailuresSchema,
  bulkJobListSchema,
  savedViewCreateSchema,
  savedViewUpdateSchema,
  selectionCreateSchema,
  selectionResolveSchema,
  manualOrderCreateSchema,
  manualOrderUpdateSchema,
  exportProfileCreateSchema,
  exportProfileVersionCreateSchema,
  exportBatchCreateSchema,
  exportMarkOrdersSchema,
  exportUnexportSchema,
  documentTemplateCreateSchema,
  documentTemplateUpdateSchema,
  documentPreviewSchema,
  documentJobCreateSchema,
  analyticsFilterSchema,
  analyticsBreakdownSchema,
  costRuleCreateSchema,
  costRuleUpdateSchema,
  healthResponseSchema,
} from '@woo-ops/contracts';
import { SqliteStore } from '@woo-ops/persistence';
import type {
  AccountContext,
  AccountRole,
  BulkAction,
  ManualOrderInput,
  ManualOrderPatch,
  OrderQueryInput,
  OrderSort,
  SavedViewVisibility,
  ExportColumn,
  ExportFormat,
  ExportRowMode,
  DocumentTemplateRecord,
  AnalyticsFilter,
} from '@woo-ops/persistence';
import {
  canonicalizeStoreUrl,
  createAuthorizationUrl,
  encryptCredentialEnvelope,
} from '@woo-ops/connectors';
import { createHmac, randomBytes } from 'node:crypto';
import { AuthService, can, recordAudit } from './auth.js';
import { verifyWebhookSignature } from '@woo-ops/connectors';
import { generateDocument } from '@woo-ops/documents';
import type { DocumentFormat, DocumentOrder } from '@woo-ops/documents';
import { readPrivatePdf, writePrivatePdf } from './document-files.js';

const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.WOO_OPS_DATA_DIR ?? './data');
const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? `${dataDirectory}/woo-ops.sqlite`);
const documentStorageRoot = resolve(dataDirectory, 'private-documents');
const documentFontBytes = process.env.WOO_OPS_DOCUMENT_FONT_PATH
  ? new Uint8Array(readFileSync(resolve(process.env.WOO_OPS_DOCUMENT_FONT_PATH)))
  : undefined;
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
type CurrentUser = { id: string; accountId: string; role: string };
const correlationId = (response: Response): string =>
  String(response.getHeader('x-correlation-id') ?? randomUUID());
const sendApiError = (response: Response, status: number, code: string, message: string): void => {
  response.status(status).json({
    error: { code, message, correlationId: correlationId(response) },
  });
};
const authenticatedUser = (request: Request, response: Response): CurrentUser | null => {
  const user = auth.current(request);
  if (!user) {
    sendApiError(response, 401, 'AUTH_UNAUTHENTICATED', 'Authentication required');
    return null;
  }
  return user;
};
const operationContext = (user: CurrentUser, response: Response): AccountContext => ({
  accountId: user.accountId,
  actorId: user.id,
  role: ['owner', 'admin', 'operator', 'viewer'].includes(user.role)
    ? (user.role as AccountRole)
    : 'viewer',
  correlationId: correlationId(response),
});
const operationStatus = (error: unknown): number => {
  const code = error instanceof Error ? error.message : '';
  if (code.includes('PERMISSION')) return 403;
  if (code.includes('NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('EXPIRED') || code.includes('RETRY')) return 409;
  return 400;
};
const sendOperationError = (response: Response, error: unknown): void => {
  sendApiError(
    response,
    operationStatus(error),
    error instanceof Error ? error.message : 'OPERATIONS_INVALID',
    'Operation request could not be completed',
  );
};
const requireOperationWrite = (request: Request, response: Response): CurrentUser | null => {
  const user = authenticatedUser(request, response);
  if (!user) return null;
  if (!can(user.role, 'operations:write') || !auth.csrfValid(request)) {
    sendApiError(response, 403, 'FORBIDDEN', 'Permission or CSRF validation failed');
    return null;
  }
  return user;
};
type AnalyticsRequestFilter = {
  from?: string | undefined;
  to?: string | undefined;
  source?: 'woo' | 'manual' | 'combined' | undefined;
  currency?: string | undefined;
  store?: string | undefined;
  status?: string | undefined;
  shippingMethod?: string | undefined;
  product?: string | undefined;
  category?: string | undefined;
  author?: string | undefined;
};
const analyticsFilterInput = (value: AnalyticsRequestFilter): AnalyticsFilter => ({
  ...(value.from === undefined ? {} : { from: value.from }),
  ...(value.to === undefined ? {} : { to: value.to }),
  ...(value.source === undefined ? {} : { source: value.source }),
  ...(value.currency === undefined ? {} : { currency: value.currency }),
  ...(value.store === undefined ? {} : { store: value.store }),
  ...(value.status === undefined ? {} : { status: value.status }),
  ...(value.shippingMethod === undefined ? {} : { shippingMethod: value.shippingMethod }),
  ...(value.product === undefined ? {} : { product: value.product }),
  ...(value.category === undefined ? {} : { category: value.category }),
  ...(value.author === undefined ? {} : { author: value.author }),
});

const documentTemplateForEngine = (template: DocumentTemplateRecord) => ({
  id: template.id,
  version: template.version,
  name: template.name,
  companyName: template.companyName,
  ...(template.companyAddress === null ? {} : { companyAddress: template.companyAddress }),
  ...(template.footerText === null ? {} : { footerText: template.footerText }),
  locale: template.locale,
  direction: template.direction,
  ...(template.body ? { body: template.body } : {}),
  ...(documentFontBytes ? { fontBytes: documentFontBytes } : {}),
});

const documentFormatForAction = (
  action: 'generate-invoice' | 'generate-thermal' | 'generate-label' | 'print-documents',
): DocumentFormat | undefined =>
  action === 'generate-invoice'
    ? 'a4'
    : action === 'generate-thermal'
      ? 'thermal-80mm'
      : action === 'generate-label'
        ? 'label-100x150mm'
        : undefined;

app.disable('x-powered-by');
app.use(
  express.json({
    limit: '256kb',
    verify: (request, _response, buffer) => {
      (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);
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
app.post('/api/v1/orders/query', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: String(response.getHeader('x-correlation-id')),
      },
    });
    return;
  }
  try {
    const result = store.queryOrders(
      {
        accountId: user.accountId,
        actorId: user.id,
        correlationId: String(response.getHeader('x-correlation-id')),
      },
      request.body as OrderQueryInput,
    );
    response.json(result);
  } catch (error) {
    const code =
      error instanceof Error && error.message.startsWith('ORDER_')
        ? error.message
        : 'ORDER_QUERY_INVALID';
    response.status(400).json({
      error: {
        code,
        message: 'Invalid order query',
        correlationId: String(response.getHeader('x-correlation-id')),
      },
    });
  }
});
app.get('/api/v1/orders/:orderId', (request, response) => {
  const user = auth.current(request);
  if (!user) {
    response.status(401).json({
      error: {
        code: 'AUTH_UNAUTHENTICATED',
        message: 'Authentication required',
        correlationId: String(response.getHeader('x-correlation-id')),
      },
    });
    return;
  }
  const order = store.getOrder(
    {
      accountId: user.accountId,
      actorId: user.id,
      correlationId: String(response.getHeader('x-correlation-id')),
    },
    request.params.orderId,
  );
  if (!order) {
    response.status(404).json({
      error: {
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
        correlationId: String(response.getHeader('x-correlation-id')),
      },
    });
    return;
  }
  response.json({ order });
});
app.post('/api/v1/manual-orders', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = manualOrderCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'MANUAL_ORDER_INVALID', 'Manual order data is invalid');
    return;
  }
  try {
    const order = store.createManualOrder(
      operationContext(user, response),
      parsed.data as ManualOrderInput,
    );
    response.status(201).json({ order });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.patch('/api/v1/manual-orders/:orderId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = manualOrderUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'MANUAL_ORDER_INVALID', 'Manual order data is invalid');
    return;
  }
  try {
    const order = store.updateManualOrder(
      operationContext(user, response),
      request.params.orderId,
      parsed.data as ManualOrderPatch,
    );
    response.json({ order });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/webhooks/woocommerce/:connectionId', (request, response) => {
  const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
  const connectionId = request.params.connectionId;
  const connection = store.db
    .prepare('SELECT id, account_id FROM connections WHERE id = ? AND platform = ?')
    .get(connectionId, 'woocommerce') as { id: string; account_id: string } | undefined;
  const secret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
  const signature = request.header('x-wc-webhook-signature');
  if (
    !connection ||
    !rawBody ||
    !secret ||
    !signature ||
    !verifyWebhookSignature(rawBody, signature, secret)
  ) {
    response.status(401).json({
      error: {
        code: 'WEBHOOK_INVALID',
        message: 'Webhook verification failed',
        correlationId: response.getHeader('x-correlation-id'),
      },
    });
    return;
  }
  const checksum = createHash('sha256').update(rawBody).digest('hex');
  const deliveryKey =
    request.header('x-wc-webhook-delivery-id') ??
    `${request.header('x-wc-webhook-topic') ?? 'unknown'}:${checksum}`;
  const accepted = store.acceptWebhook({
    id: randomUUID(),
    accountId: connection.account_id,
    connectionId: connection.id,
    deliveryKey,
    topic: request.header('x-wc-webhook-topic') ?? 'unknown',
    body: rawBody,
    checksum,
  });
  if (accepted.accepted) {
    store.enqueueJob(
      { accountId: connection.account_id, correlationId: randomUUID() },
      {
        id: randomUUID(),
        type: 'webhook.process',
        idempotencyKey: deliveryKey,
        payload: { inboxId: accepted.inboxId },
        maxAttempts: 5,
      },
    );
  }
  response
    .status(accepted.accepted ? 202 : 200)
    .json({ accepted: true, duplicate: !accepted.accepted, inboxId: accepted.inboxId });
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
app.post('/api/v1/selections', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = selectionCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'SELECTION_INPUT_INVALID', 'Selection input is invalid');
    return;
  }
  const body = parsed.data;
  try {
    const selection = store.createSelection(operationContext(user, response), {
      mode: body.mode,
      ...(body.orderIds !== undefined ? { orderIds: body.orderIds } : {}),
      ...(body.query !== undefined ? { query: body.query as OrderQueryInput } : {}),
      ...(body.exclusions !== undefined ? { exclusions: body.exclusions } : {}),
      ...(body.watermark !== undefined ? { watermark: body.watermark } : {}),
      ...(body.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
    });
    response.status(201).json({ selection });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/selections/:selectionId', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({
      selection: store.getSelection(operationContext(user, response), request.params.selectionId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.delete('/api/v1/selections/:selectionId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  try {
    store.deleteSelection(operationContext(user, response), request.params.selectionId);
    response.status(204).end();
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/selections/:selectionId/resolve-count', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = selectionResolveSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'SELECTION_RESOLVE_INPUT_INVALID',
      'Selection paging input is invalid',
    );
    return;
  }
  try {
    const paging = {
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    };
    response.json({
      page: store.resolveSelection(
        operationContext(user, response),
        request.params.selectionId,
        paging,
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/saved-views', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({ items: store.listSavedViews(operationContext(user, response)) });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/saved-views', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = savedViewCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'SAVED_VIEW_INPUT_INVALID', 'Saved view input is invalid');
    return;
  }
  const body = parsed.data;
  try {
    const view = store.createSavedView(operationContext(user, response), {
      name: body.name,
      ...(body.query !== undefined ? { query: body.query as OrderQueryInput } : {}),
      ...(body.sort !== undefined ? { sort: body.sort as OrderSort | null } : {}),
      ...(body.columns !== undefined ? { columns: body.columns } : {}),
      ...(body.pageSize !== undefined ? { pageSize: body.pageSize } : {}),
      ...(body.visibility !== undefined
        ? { visibility: body.visibility as SavedViewVisibility }
        : {}),
    });
    response.status(201).json({ view });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.patch('/api/v1/saved-views/:viewId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = savedViewUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'SAVED_VIEW_INPUT_INVALID', 'Saved view input is invalid');
    return;
  }
  const body = parsed.data;
  try {
    const view = store.updateSavedView(operationContext(user, response), request.params.viewId, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.query !== undefined ? { query: body.query as OrderQueryInput } : {}),
      ...(body.sort !== undefined ? { sort: body.sort as OrderSort | null } : {}),
      ...(body.columns !== undefined ? { columns: body.columns } : {}),
      ...(body.pageSize !== undefined ? { pageSize: body.pageSize } : {}),
      ...(body.visibility !== undefined
        ? { visibility: body.visibility as SavedViewVisibility }
        : {}),
      ...(body.version !== undefined ? { version: body.version } : {}),
    });
    response.json({ view });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.delete('/api/v1/saved-views/:viewId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  try {
    store.deleteSavedView(operationContext(user, response), request.params.viewId);
    response.status(204).end();
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/bulk-jobs/preview', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = bulkPreviewSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'BULK_INPUT_INVALID', 'Bulk preview input is invalid');
    return;
  }
  const body = parsed.data;
  try {
    response.json({
      preview: store.previewBulk(operationContext(user, response), {
        selectionId: body.selectionId,
        action: body.action as BulkAction,
        ...(body.parameters !== undefined ? { parameters: body.parameters } : {}),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/bulk-jobs', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = bulkCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'BULK_INPUT_INVALID', 'Bulk input is invalid');
    return;
  }
  const body = parsed.data;
  try {
    const job = store.createBulkJob(operationContext(user, response), {
      selectionId: body.selectionId,
      action: body.action as BulkAction,
      idempotencyKey: body.idempotencyKey,
      ...(body.parameters !== undefined ? { parameters: body.parameters } : {}),
    });
    response.status(202).json({ job });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/bulk-jobs', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = bulkJobListSchema.safeParse({
    cursor: request.query.cursor === undefined ? undefined : String(request.query.cursor),
    limit: request.query.limit === undefined ? undefined : Number(request.query.limit),
    status: request.query.status === undefined ? undefined : String(request.query.status),
  });
  if (!parsed.success) {
    sendApiError(response, 400, 'BULK_JOB_LIST_INPUT_INVALID', 'Bulk job list input is invalid');
    return;
  }
  try {
    const paging = {
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    };
    response.json(store.listBulkJobs(operationContext(user, response), paging));
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/bulk-jobs/:jobId', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({
      job: store.getBulkJob(operationContext(user, response), request.params.jobId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/bulk-jobs/:jobId/retry-failures', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  try {
    response.json({
      job: store.retryBulkFailures(operationContext(user, response), request.params.jobId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/bulk-jobs/:jobId/cancel', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  try {
    response.json({
      job: store.cancelBulkJob(operationContext(user, response), request.params.jobId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/bulk-jobs/:jobId/errors', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = bulkFailuresSchema.safeParse({
    cursor: request.query.cursor === undefined ? undefined : String(request.query.cursor),
    limit: request.query.limit === undefined ? undefined : Number(request.query.limit),
  });
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'BULK_FAILURE_INPUT_INVALID',
      'Bulk failure paging input is invalid',
    );
    return;
  }
  try {
    const paging = {
      ...(parsed.data.cursor !== undefined ? { cursor: parsed.data.cursor } : {}),
      ...(parsed.data.limit !== undefined ? { limit: parsed.data.limit } : {}),
    };
    response.json({
      ...store.listBulkFailures(operationContext(user, response), request.params.jobId, paging),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/export-profiles', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({ items: store.listExportProfiles(operationContext(user, response)) });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/export-profiles', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = exportProfileCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'EXPORT_PROFILE_INPUT_INVALID', 'Export profile input is invalid');
    return;
  }
  try {
    response.status(201).json({
      profile: store.createExportProfile(operationContext(user, response), {
        name: parsed.data.name,
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/export-profiles/:profileId/versions', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = exportProfileVersionCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'EXPORT_PROFILE_VERSION_INPUT_INVALID',
      'Export profile version input is invalid',
    );
    return;
  }
  const body = parsed.data;
  try {
    response.status(201).json({
      version: store.createExportProfileVersion(
        operationContext(user, response),
        request.params.profileId,
        {
          format: body.format as ExportFormat,
          rowMode: body.rowMode as ExportRowMode,
          columns: body.columns as ExportColumn[],
          filenameTemplate: body.filenameTemplate,
          ...(body.config !== undefined ? { config: body.config } : {}),
        },
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/export-batches', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = exportBatchCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'EXPORT_BATCH_INPUT_INVALID', 'Export batch input is invalid');
    return;
  }
  try {
    response.status(202).json({
      batch: store.createExportBatch(operationContext(user, response), parsed.data),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/export-batches', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const rawLimit = request.query.limit === undefined ? undefined : Number(request.query.limit);
  try {
    response.json({
      items:
        rawLimit === undefined
          ? store.listExportBatches(operationContext(user, response))
          : store.listExportBatches(operationContext(user, response), rawLimit),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/export-batches/:batchId', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({
      batch: store.getExportBatch(operationContext(user, response), request.params.batchId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/export-batches/:batchId/mark-exported', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = exportMarkOrdersSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'EXPORT_MARK_INPUT_INVALID', 'Export order IDs are invalid');
    return;
  }
  try {
    response.json({
      result: store.recordExportedOrders(
        operationContext(user, response),
        request.params.batchId,
        parsed.data.orderIds,
        parsed.data.snapshotHash,
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/orders/:orderId/export-history', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({
      items: store.listOrderExportEvents(operationContext(user, response), request.params.orderId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/orders/:orderId/export-state/unexport', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = exportUnexportSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'EXPORT_UNEXPORT_INPUT_INVALID', 'An unexport reason is required');
    return;
  }
  try {
    response.json({
      event: store.unexportOrder(
        operationContext(user, response),
        request.params.orderId,
        parsed.data.reason,
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/document-templates', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({ items: store.listDocumentTemplates(operationContext(user, response)) });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/document-templates', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = documentTemplateCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'DOCUMENT_TEMPLATE_INPUT_INVALID',
      'Document template input is invalid',
    );
    return;
  }
  try {
    const body = parsed.data;
    response.status(201).json({
      template: store.createDocumentTemplate(operationContext(user, response), {
        name: body.name,
        format: body.format,
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.direction === undefined ? {} : { direction: body.direction }),
        ...(body.body === undefined ? {} : { body: body.body }),
        companyName: body.companyName,
        ...(body.companyAddress === undefined ? {} : { companyAddress: body.companyAddress }),
        ...(body.footerText === undefined ? {} : { footerText: body.footerText }),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.patch('/api/v1/document-templates/:templateId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = documentTemplateUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'DOCUMENT_TEMPLATE_INPUT_INVALID',
      'Document template input is invalid',
    );
    return;
  }
  try {
    const body = parsed.data;
    response.json({
      template: store.updateDocumentTemplate(
        operationContext(user, response),
        request.params.templateId,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.format === undefined ? {} : { format: body.format }),
          ...(body.locale === undefined ? {} : { locale: body.locale }),
          ...(body.direction === undefined ? {} : { direction: body.direction }),
          ...(body.body === undefined ? {} : { body: body.body }),
          ...(body.companyName === undefined ? {} : { companyName: body.companyName }),
          ...(body.companyAddress === undefined ? {} : { companyAddress: body.companyAddress }),
          ...(body.footerText === undefined ? {} : { footerText: body.footerText }),
          ...(body.active === undefined ? {} : { active: body.active }),
        },
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/document-templates/:templateId/preview', async (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = documentPreviewSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'DOCUMENT_PREVIEW_INPUT_INVALID',
      'Document preview input is invalid',
    );
    return;
  }
  try {
    const template = store.getDocumentTemplate(
      operationContext(user, response),
      request.params.templateId,
    );
    const result = await generateDocument({
      order: parsed.data.order as DocumentOrder,
      format: parsed.data.format ?? template.format,
      template: documentTemplateForEngine(template),
      ...(parsed.data.orderId === undefined ? {} : { orderId: parsed.data.orderId }),
      ...(parsed.data.documentNumber === undefined
        ? {}
        : { documentNumber: parsed.data.documentNumber }),
      ...(parsed.data.barcodeValue === undefined ? {} : { barcodeValue: parsed.data.barcodeValue }),
      ...(parsed.data.qrValue === undefined ? {} : { qrValue: parsed.data.qrValue }),
      ...(parsed.data.thermalHeightMm === undefined
        ? {}
        : { thermalHeightMm: parsed.data.thermalHeightMm }),
    });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Length', result.bytes.byteLength);
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Document-Checksum', result.checksum);
    response.setHeader('Content-Disposition', 'inline; filename="document-preview.pdf"');
    response.send(Buffer.from(result.bytes));
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/document-templates/:templateId/orders/:orderId', async (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = documentPreviewSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(
      response,
      400,
      'DOCUMENT_GENERATION_INPUT_INVALID',
      'Document generation input is invalid',
    );
    return;
  }
  try {
    const context = operationContext(user, response);
    const template = store.getDocumentTemplate(context, request.params.templateId);
    const order = store.getOrder(context, request.params.orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const format = parsed.data.format ?? template.format;
    const result = await generateDocument({
      order: order as DocumentOrder,
      format,
      template: documentTemplateForEngine(template),
      orderId: request.params.orderId,
      ...(parsed.data.documentNumber === undefined
        ? {}
        : { documentNumber: parsed.data.documentNumber }),
      ...(parsed.data.barcodeValue === undefined ? {} : { barcodeValue: parsed.data.barcodeValue }),
      ...(parsed.data.qrValue === undefined ? {} : { qrValue: parsed.data.qrValue }),
      ...(parsed.data.thermalHeightMm === undefined
        ? {}
        : { thermalHeightMm: parsed.data.thermalHeightMm }),
    });
    const fileId = randomUUID();
    const stored = writePrivatePdf(documentStorageRoot, user.accountId, fileId, result.bytes);
    const orderNumber = String(order.orderNumber ?? request.params.orderId);
    const filename = `${template.name}-${orderNumber}-${format}.pdf`
      .replace(/[^A-Za-z0-9._-]/gu, '_')
      .slice(0, 160);
    const file = store.registerDocumentFile(context, {
      id: fileId,
      orderId: request.params.orderId,
      templateId: template.id,
      format,
      relativePath: stored.relativePath,
      filename: filename.endsWith('.pdf') ? filename : `${filename}.pdf`,
      byteSize: stored.byteSize,
      checksum: stored.checksum,
    });
    response.status(201).json({ file });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/orders/:orderId/documents', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    response.json({
      items: store.listDocumentFiles(operationContext(user, response), request.params.orderId),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/document-files/:fileId', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    const file = store.getDocumentFile(operationContext(user, response), request.params.fileId);
    const bytes = readPrivatePdf(documentStorageRoot, file.relativePath, file.checksum);
    const safeFilename = file.filename.replace(/[^A-Za-z0-9._-]/gu, '_');
    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', bytes.byteLength);
    response.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    response.setHeader('Content-Security-Policy', "default-src 'none'");
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Document-Checksum', file.checksum);
    response.send(bytes);
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined;
    if (code === 'ENOENT') {
      sendApiError(response, 404, 'DOCUMENT_FILE_NOT_FOUND', 'Document file not found');
      return;
    }
    sendOperationError(response, error);
  }
});
app.post('/api/v1/document-jobs', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = documentJobCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'DOCUMENT_JOB_INPUT_INVALID', 'Document job input is invalid');
    return;
  }
  try {
    const body = parsed.data;
    const context = operationContext(user, response);
    store.getDocumentTemplate(context, body.templateId);
    const format = body.format ?? documentFormatForAction(body.action);
    response.status(202).json({
      job: store.createBulkJob(context, {
        selectionId: body.selectionId,
        action: body.action as BulkAction,
        parameters: {
          templateId: body.templateId,
          ...(format === undefined ? {} : { format }),
        },
        idempotencyKey: body.idempotencyKey,
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/analytics/metric-definitions', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  response.json({ items: store.getAnalyticsSummary(operationContext(user, response)).definitions });
});
app.post('/api/v1/analytics/summary', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = analyticsFilterSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(response, 400, 'ANALYTICS_INPUT_INVALID', 'Analytics filter is invalid');
    return;
  }
  try {
    response.json({
      summary: store.getAnalyticsSummary(
        operationContext(user, response),
        analyticsFilterInput(parsed.data),
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/analytics/timeseries', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = analyticsFilterSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(response, 400, 'ANALYTICS_INPUT_INVALID', 'Analytics filter is invalid');
    return;
  }
  try {
    response.json({
      timeseries: store.getAnalyticsTimeseries(
        operationContext(user, response),
        analyticsFilterInput(parsed.data),
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/analytics/breakdown', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  const parsed = analyticsBreakdownSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(response, 400, 'ANALYTICS_INPUT_INVALID', 'Analytics breakdown is invalid');
    return;
  }
  try {
    const filter = analyticsFilterInput(parsed.data);
    response.json({
      breakdown: store.getAnalyticsBreakdown(operationContext(user, response), {
        ...filter,
        ...(parsed.data.dimension === undefined ? {} : { dimension: parsed.data.dimension }),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/cost-rules', (request, response) => {
  const user = authenticatedUser(request, response);
  if (!user) return;
  try {
    const rawScope = typeof request.query.scope === 'string' ? request.query.scope : undefined;
    const scopes = ['product', 'variation', 'shipping', 'payment', 'return'] as const;
    if (rawScope !== undefined && !scopes.includes(rawScope as (typeof scopes)[number]))
      throw new Error('COST_RULE_SCOPE_INVALID');
    response.json({
      items: store.listCostRules(operationContext(user, response), {
        ...(rawScope === undefined ? {} : { scope: rawScope as (typeof scopes)[number] }),
        ...(typeof request.query.currency === 'string' ? { currency: request.query.currency } : {}),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/cost-rules', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = costRuleCreateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'COST_RULE_INPUT_INVALID', 'Cost rule input is invalid');
    return;
  }
  try {
    const input = parsed.data;
    response.status(201).json({
      rule: store.createCostRule(operationContext(user, response), {
        scope: input.scope,
        key: input.key,
        currency: input.currency,
        amountMinor: input.amountMinor,
        source: input.source,
        effectiveFrom: input.effectiveFrom,
        ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
        ...(input.active === undefined ? {} : { active: input.active }),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.patch('/api/v1/cost-rules/:ruleId', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = costRuleUpdateSchema.safeParse(request.body);
  if (!parsed.success) {
    sendApiError(response, 400, 'COST_RULE_INPUT_INVALID', 'Cost rule input is invalid');
    return;
  }
  try {
    const input = parsed.data;
    response.json({
      rule: store.updateCostRule(operationContext(user, response), request.params.ruleId, {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
      }),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.post('/api/v1/analytics/rebuilds', (request, response) => {
  const user = requireOperationWrite(request, response);
  if (!user) return;
  const parsed = analyticsFilterSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendApiError(response, 400, 'ANALYTICS_INPUT_INVALID', 'Analytics rebuild input is invalid');
    return;
  }
  try {
    response.status(202).json({
      rebuild: store.rebuildAnalyticsFacts(
        operationContext(user, response),
        analyticsFilterInput(parsed.data),
      ),
    });
  } catch (error) {
    sendOperationError(response, error);
  }
});
app.get('/api/v1/meta', (_request, response) =>
  response.json({ locale: 'ar-EG', direction: 'rtl', readOnlyConnector: true }),
);

app.listen(port, () => console.log(`Woo Ops API listening on ${port}`));

export { app, store };
