import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const waitForPort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('CONNECTION_E2E_PORT_UNAVAILABLE'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const stopApi = async (child) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (child.exitCode === null && child.pid !== undefined && process.platform === 'win32')
      await new Promise((resolve) =>
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          resolve,
        ),
      );
  }
  child.stdout.destroy();
  child.stderr.destroy();
};

const cookiesFrom = (response) =>
  (typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  ).join('; ');
const cookieValue = (cookies, name) => cookies.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '';

test('connection lifecycle HTTP APIs enforce admin CSRF, hide secrets, and queue local sync work', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'woo-connections-e2e-'));
  const databasePath = join(dataDirectory, 'connections.sqlite');
  const port = await waitForPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      WEB_PUBLIC_URL: baseUrl,
      API_PUBLIC_URL: baseUrl,
      WOO_OPS_DATA_DIR: dataDirectory,
      WOO_OPS_DATABASE: databasePath,
      SESSION_SECRET: 'connections-e2e-session-secret-with-enough-entropy',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let childOutput = '';
  child.stdout.on('data', (chunk) => (childOutput += chunk.toString()));
  child.stderr.on('data', (chunk) => (childOutput += chunk.toString()));

  const waitForHealth = async () => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${baseUrl}/health`);
        if (response.ok) return;
      } catch {
        // The API is still starting.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`CONNECTION_E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
  };
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.text();
    return { response, body };
  };

  try {
    await waitForHealth();
    const register = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'connections-owner@example.test',
        password: 'correct horse battery staple',
        accountName: 'Connections E2E',
      }),
    });
    assert.equal(register.response.status, 201);
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'connections-owner@example.test',
        password: 'correct horse battery staple',
      }),
    });
    assert.equal(login.response.status, 200);
    const cookies = cookiesFrom(login.response);
    const session = cookieValue(cookies, 'woo_ops_session');
    const csrf = cookieValue(cookies, 'woo_ops_csrf');
    const cookie = `woo_ops_session=${session}; woo_ops_csrf=${csrf}`;
    const readHeaders = { cookie };
    const writeHeaders = { cookie, 'x-csrf-token': csrf };

    const empty = await request('/api/v1/connections', { headers: readHeaders });
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.body.items, []);
    const missingCsrf = await request('/api/v1/connections/woocommerce/authorize', {
      method: 'POST',
      headers: readHeaders,
      body: JSON.stringify({ storeUrl: 'https://example.com' }),
    });
    assert.equal(missingCsrf.response.status, 403);

    const authorization = await request('/api/v1/connections/woocommerce/authorize', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ storeUrl: 'https://example.com' }),
    });
    assert.equal(authorization.response.status, 200);
    const authorizationUrl = new URL(authorization.body.authorizationUrl);
    const state = authorizationUrl.searchParams.get('user_id');
    assert.ok(state);
    assert.equal(authorizationUrl.searchParams.get('scope'), 'read');
    assert.equal(authorizationUrl.searchParams.has('state'), false);
    assert.equal(
      authorizationUrl.searchParams.get('callback_url'),
      `${baseUrl}/api/v1/connections/woocommerce/return`,
    );
    assert.equal(
      authorizationUrl.searchParams.get('return_url'),
      `${baseUrl}/connections/woocommerce/callback`,
    );
    const invalidPermission = await request('/api/v1/connections/woocommerce/return', {
      method: 'POST',
      body: JSON.stringify({
        user_id: state,
        consumer_key: 'ck_http_read',
        consumer_secret: 'cs_http_secret',
        key_permissions: 'read_write',
      }),
    });
    assert.equal(invalidPermission.response.status, 400);
    const callback = await request('/api/v1/connections/woocommerce/return', {
      method: 'POST',
      body: JSON.stringify({
        user_id: state,
        consumer_key: 'ck_http_read',
        consumer_secret: 'cs_http_secret',
        key_permissions: 'read',
      }),
    });
    assert.equal(callback.response.status, 200);
    assert.equal(callback.body.connected, true);
    assert.equal(Object.hasOwn(callback.body, 'connectionId'), false);
    const replay = await request('/api/v1/connections/woocommerce/return', {
      method: 'POST',
      body: JSON.stringify({
        user_id: state,
        consumer_key: 'ck_http_read',
        consumer_secret: 'cs_http_secret',
        key_permissions: 'read',
      }),
    });
    assert.equal(replay.response.status, 409);

    const listed = await request('/api/v1/connections', { headers: readHeaders });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.items.length, 1);
    const connectionId = listed.body.items[0].id;
    assert.equal(Object.hasOwn(listed.body.items[0], 'encryptedCredentials'), false);
    const detail = await request(`/api/v1/connections/${connectionId}`, { headers: readHeaders });
    assert.equal(detail.response.status, 200);
    assert.equal(Object.hasOwn(detail.body.connection, 'encryptedCredentials'), false);

    const rotated = await request(`/api/v1/connections/${connectionId}/rotate`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ key: 'ck_http_rotated', secret: 'cs_http_rotated' }),
    });
    assert.equal(rotated.response.status, 200);
    const webhookSecret = await request(`/api/v1/connections/${connectionId}/webhook-secret`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ secret: 'connection-http-webhook-secret' }),
    });
    assert.equal(webhookSecret.response.status, 200);
    assert.equal(Object.hasOwn(webhookSecret.body.connection, 'encryptedWebhookSecret'), false);

    const incremental = await request(`/api/v1/connections/${connectionId}/sync-runs/incremental`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ idempotencyKey: 'http-incremental-1' }),
    });
    assert.equal(incremental.response.status, 202);
    assert.equal(incremental.body.job.type, 'sync.incremental');
    assert.equal(Object.hasOwn(incremental.body.job, 'payload'), false);

    const rejectedDisconnect = await request(`/api/v1/connections/${connectionId}/disable`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        confirmation: 'DISCONNECT',
        currentPassword: 'not the current password',
      }),
    });
    assert.equal(rejectedDisconnect.response.status, 400);
    const disabled = await request(`/api/v1/connections/${connectionId}/disable`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        confirmation: 'DISCONNECT',
        currentPassword: 'correct horse battery staple',
      }),
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.connection.status, 'disabled');
    const blockedSync = await request(`/api/v1/connections/${connectionId}/reconcile`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ idempotencyKey: 'http-reconcile-after-disable' }),
    });
    assert.equal(blockedSync.response.status, 400);
  } finally {
    await stopApi(child);
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
