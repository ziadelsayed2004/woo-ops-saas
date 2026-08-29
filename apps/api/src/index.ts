import express, { type Express } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { healthResponseSchema } from '@woo-ops/contracts';
import { SqliteStore } from '@woo-ops/persistence';
import { AuthService } from './auth.js';

const port = Number(process.env.PORT ?? 3000);
const dataDirectory = resolve(process.env.WOO_OPS_DATA_DIR ?? './data');
const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? `${dataDirectory}/woo-ops.sqlite`);
mkdirSync(dirname(databasePath), { recursive: true });
const store = new SqliteStore(databasePath);
const auth = new AuthService(store.db);
const app: Express = express();
const attempts = new Map<string, { count: number; resetAt: number }>();

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
  if (!auth.current(request)) {
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
  response.status(204).end();
});
app.get('/api/v1/meta', (_request, response) =>
  response.json({ locale: 'ar-EG', direction: 'rtl', readOnlyConnector: true }),
);

app.listen(port, () => console.log(`Woo Ops API listening on ${port}`));

export { app, store };
