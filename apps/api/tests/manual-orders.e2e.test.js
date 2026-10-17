import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteDatabase as Database, SqliteStore } from '@woo-ops/persistence';

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
    WOO_OPS_EGYPT_SHIPPING_RATES_JSON: '{"Cairo":"1500"}',
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

  const config = await request('/api/v1/manual-orders/config', {
    headers: { cookie: headers.cookie },
  });
  assert.deepEqual(config.body.rates, [
    {
      governorate: 'Cairo',
      amountMinor: '1500',
      title: 'Configured rate',
      methodId: 'configured-rate',
      source: 'environment',
    },
  ]);
  assert.equal(config.body.ratesSource, 'environment');

  const proofBytes = Buffer.from('private transfer proof');
  const proof = await request(`/api/v1/manual-orders/${created.body.order.id}/payment-proof`, {
    method: 'POST',
    headers: {
      ...headers,
      'content-type': 'image/png',
      'x-file-name': 'transfer.png',
    },
    body: proofBytes,
  });
  assert.equal(proof.response.status, 201);
  assert.equal(proof.body.proof.mimeType, 'image/png');
  const proofDownload = await fetch(
    `${baseUrl}/api/v1/manual-orders/${created.body.order.id}/payment-proof`,
    { headers: { cookie: headers.cookie } },
  );
  assert.equal(proofDownload.status, 200);
  assert.deepEqual(Buffer.from(await proofDownload.arrayBuffer()), proofBytes);

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

  const seed = new SqliteStore(databasePath);
  const context = {
    accountId: register.body.user.accountId,
    actorId: register.body.user.id,
    role: 'owner',
    correlationId: randomUUID(),
  };
  const connectionId = randomUUID();
  const now = new Date().toISOString();
  seed.db
    .prepare(
      "INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, 'woocommerce', 'https://tax.example.test', 'active', ?, ?)",
    )
    .run(connectionId, context.accountId, now, now);
  seed.upsertCatalogPage(context, {
    connectionId,
    cursor: 'complete',
    pages: 1,
    items: [
      {
        identity: 'product:10',
        kind: 'product',
        externalId: '10',
        parentExternalId: null,
        name: 'Tax product',
        sourceJson: JSON.stringify({
          source: { id: 10, price: '100.00', tax_status: 'taxable', tax_class: '' },
        }),
      },
    ],
  });
  seed.replaceWooTaxPolicy(context, connectionId, {
    version: 1,
    enabled: true,
    currency: 'EGP',
    pricesIncludeTax: false,
    roundAtSubtotal: false,
    basedOn: 'shipping',
    shippingTaxClass: 'inherit',
    taxClasses: [],
    base: { country: 'EG', state: 'C', city: '', postcode: '' },
    rates: [
      {
        id: '1',
        country: 'EG',
        state: '',
        postcodes: [],
        cities: [],
        rate: '14',
        name: 'VAT',
        priority: 1,
        order: 0,
        compound: false,
        shipping: true,
        taxClass: '',
      },
    ],
  });
  seed.db.close();
  const automatic = {
    ...input,
    taxMode: 'store',
    shipping: { country: 'EG', state: 'EGC' },
    shippingCollectedMinor: '0',
    taxMinor: '99999',
    lines: [
      {
        name: 'Tax product',
        productId: '10',
        quantity: 1,
        unitPriceMinor: '10000',
        taxMinor: '99999',
      },
    ],
  };
  const preview = await request('/api/v1/manual-orders/tax-preview', {
    method: 'POST',
    headers,
    body: JSON.stringify(automatic),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.amounts.taxMinor, '1400');
  assert.equal(preview.body.amounts.grandTotalMinor, '11400');
  const automaticOrder = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...automatic, taxPolicyHash: preview.body.policyHash }),
  });
  assert.equal(automaticOrder.response.status, 201);
  assert.equal(automaticOrder.body.order.amounts.taxMinor, '1400');
  assert.equal(automaticOrder.body.order.taxMode, 'store');
  const readyConfig = await request('/api/v1/manual-orders/config', { headers });
  assert.equal(readyConfig.body.taxes.status, 'ready');
  const denied = await request('/api/v1/manual-orders/tax-preview', {
    method: 'POST',
    body: JSON.stringify(automatic),
  });
  assert.equal(denied.response.status, 401);
  const other = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `other-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Other',
    }),
  });
  const otherCookies = cookiesFrom(other.response);
  const isolated = await request('/api/v1/manual-orders/tax-preview', {
    method: 'POST',
    headers: { cookie: otherCookies },
    body: JSON.stringify(automatic),
  });
  assert.equal(isolated.response.status, 400);
  assert.equal(isolated.body.error.code, 'STORE_TAX_NOT_SYNCED');
  const invalid = await request('/api/v1/manual-orders/tax-preview', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...automatic, accountId: context.accountId }),
  });
  assert.equal(invalid.response.status, 400);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
