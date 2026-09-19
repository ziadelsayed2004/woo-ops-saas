import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteDatabase as Database } from '@woo-ops/persistence';

const directory = mkdtempSync(join(tmpdir(), 'woo-api-manual-e2e-'));
const databasePath = join(directory, 'e2e.sqlite');
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('E2E_PORT_UNAVAILABLE'));
    server.close(() => resolve(address.port));
  });
});
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    WEB_PUBLIC_URL: baseUrl,
    WOO_OPS_DATA_DIR: directory,
    WOO_OPS_DATABASE: databasePath,
    SESSION_SECRET: 'manual-e2e-session-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => (childOutput += chunk.toString()));
child.stderr.on('data', (chunk) => (childOutput += chunk.toString()));
const stopChild = async () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (child.exitCode === null && process.platform === 'win32' && child.pid)
      await new Promise((done) =>
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
          done(),
        ),
      );
  }
  child.stdout.destroy();
  child.stderr.destroy();
};
const waitForHealth = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
};
const cookiesFrom = (response) =>
  (typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  ).join('; ');
const cookieValue = (cookies, name) => cookies.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '';
const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
};

try {
  await waitForHealth();
  const register = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `manual-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Manual E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const session = cookieValue(cookies, 'woo_ops_session');
  const csrf = cookieValue(cookies, 'woo_ops_csrf');
  const headers = {
    cookie: `woo_ops_session=${session}; woo_ops_csrf=${csrf}`,
    'x-csrf-token': csrf,
  };
  const input = {
    currency: 'EGP',
    customer: { name: 'Manual Customer', email: 'customer@example.test' },
    billing: { first_name: 'Manual Customer', email: 'customer@example.test' },
    shipping: { first_name: 'Manual Customer', address_1: 'Local street' },
    payment: { method: 'manual', title: 'Cash' },
    shippingMethod: { methodId: 'manual', title: 'Courier' },
    lines: [{ name: 'Manual product', quantity: 2, unitPriceMinor: '12500' }],
    shippingCollectedMinor: '1500',
    localStatus: 'processing',
    tags: ['manual'],
    notes: 'Call first',
  };
  const created = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.order.origin, 'manual');
  assert.equal(created.body.order.orderNumber, 'MAN-000001');
  assert.equal(created.body.order.syncPolicy, 'never');
  assert.equal(created.body.order.inventoryPolicy, 'ignore');
  assert.equal(created.body.order.connectionId, null);
  assert.equal(created.body.order.externalOrderId, null);
  assert.equal(created.body.order.grandTotalMinor, '26500');

  const database = new Database(databasePath);
  database
    .prepare("UPDATE orders SET export_state = 'exported' WHERE account_id = ? AND id = ?")
    .run(register.body.user.accountId, created.body.order.id);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM connections').get().count, 0);
  database.close();

  const updated = await request(`/api/v1/manual-orders/${created.body.order.id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      version: 1,
      localStatus: 'packed',
      notes: 'Confirmed',
      tags: ['packed'],
    }),
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.order.localStatus, 'packed');
  assert.equal(updated.body.order.exportState, 'changed-after-export');
  assert.equal(typeof updated.body.order.staleExportAt, 'string');
  assert.equal(updated.body.order.syncPolicy, 'never');

  const queried = await request('/api/v1/orders/query', {
    method: 'POST',
    headers: { cookie: headers.cookie },
    body: JSON.stringify({ filter: { field: 'origin', operator: 'equals', value: 'manual' } }),
  });
  assert.equal(queried.response.status, 200);
  assert.equal(queried.body.items.length, 1);
  assert.equal(queried.body.items[0].id, created.body.order.id);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
