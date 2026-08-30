import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import Database from 'better-sqlite3';
import { WooCommerceConnector, normalizeWooOrder } from '@woo-ops/connectors';
import { generateCsv } from '../../../packages/exports/dist/index.js';
import { SqliteStore } from '@woo-ops/persistence';
import { createBackup, listBackups, restoreBackup } from '../dist/backup.js';

const waitForPort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('CRITICAL_E2E_PORT_UNAVAILABLE'));
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

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('runs the complete local critical journey with Woo fixtures', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'woo-critical-e2e-'));
  const databasePath = join(dataDirectory, 'woo-ops.sqlite');
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
      SESSION_SECRET: 'critical-e2e-session-secret-with-enough-entropy',
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
    throw new Error(`CRITICAL_E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
  };
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? await response.json()
      : await response.arrayBuffer();
    return { response, body };
  };

  try {
    await waitForHealth();
    const register = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'critical-owner@example.test',
        password: 'correct horse battery staple',
        accountName: 'Critical journey',
      }),
    });
    assert.equal(register.response.status, 201);
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'critical-owner@example.test',
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
    const accountId = register.body.user.accountId;
    const actorId = register.body.user.id;
    assert.ok(session);
    assert.ok(csrf);

    const rawWooOrder = {
      id: 9001,
      number: 'WOO-9001',
      status: 'processing',
      currency: 'EGP',
      total: '125.00',
      date_created_gmt: '2026-08-30T08:00:00.000Z',
      date_modified_gmt: '2026-08-30T08:10:00.000Z',
      billing: {
        first_name: 'أحمد',
        last_name: 'علي',
        email: 'customer@example.test',
        phone: '01000000000',
        city: 'Cairo',
      },
      shipping: { address_1: 'Critical street', city: 'Cairo', country: 'EG' },
      line_items: [
        {
          id: 1,
          product_id: 101,
          variation_id: 0,
          name: 'Critical shirt',
          sku: 'SKU-CRITICAL',
          quantity: 2,
          subtotal: '100.00',
          total: '100.00',
          total_tax: '0.00',
        },
      ],
      shipping_lines: [],
      fee_lines: [],
      coupon_lines: [],
      refunds: [],
    };
    const connector = new WooCommerceConnector(
      'fixture-webhook-secret',
      new URL('https://fixture-shop.example.test'),
      { key: 'ck_read_only', secret: 'cs_read_only' },
      async (_url, init) => {
        assert.equal(init.method, 'GET');
        assert.equal(init.redirect, 'manual');
        return new Response(JSON.stringify([rawWooOrder]), {
          headers: { 'x-wp-totalpages': '1' },
        });
      },
      async () => [{ address: '93.184.216.34' }],
    );
    const pulled = [];
    for await (const page of connector.pullRemote('orders')) pulled.push(...page);
    assert.equal(pulled.length, 1);
    const normalized = normalizeWooOrder(pulled[0]);
    assert.equal(normalized.externalOrderId, '9001');
    assert.equal(normalized.grandTotalMinor, '12500');

    const connectionId = 'critical-connection-1';
    const database = new Database(databasePath);
    database
      .prepare(
        'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        connectionId,
        accountId,
        'woocommerce',
        'https://fixture-shop.example.test',
        'active',
        normalized.createdAt,
        normalized.modifiedAt,
      );
    database.close();
    const syncStore = new SqliteStore(databasePath);
    const context = {
      accountId,
      actorId,
      role: 'admin',
      correlationId: 'critical-sync-correlation',
    };
    const importedId = syncStore.upsertRemoteOrder(context, connectionId, normalized);
    syncStore.db.close();

    const filtered = await request('/api/v1/orders/query', {
      method: 'POST',
      headers: readHeaders,
      body: JSON.stringify({
        search: 'SKU-CRITICAL',
        filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
        limit: 50,
        sort: { field: 'remoteCreatedAt', direction: 'desc' },
      }),
    });
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.body.items.length, 1);
    assert.equal(filtered.body.items[0].id, importedId);

    const manual = await request('/api/v1/manual-orders', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        currency: 'EGP',
        customer: { name: 'Local customer' },
        lines: [{ name: 'Local item', quantity: 1, unitPriceMinor: '5500' }],
        shippingCollectedMinor: '500',
        localStatus: 'processing',
      }),
    });
    assert.equal(manual.response.status, 201);
    assert.equal(manual.body.order.origin, 'manual');
    assert.equal(manual.body.order.syncPolicy, 'never');
    assert.equal(manual.body.order.inventoryPolicy, 'ignore');
    const manualId = manual.body.order.id;
    const orderIds = [importedId, manualId];

    const selection = await request('/api/v1/selections', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ mode: 'explicit', orderIds }),
    });
    assert.equal(selection.response.status, 201);
    assert.equal(selection.body.selection.estimatedCount, 2);
    const profile = await request('/api/v1/export-profiles', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Critical shipping export' }),
    });
    assert.equal(profile.response.status, 201);
    const version = await request(`/api/v1/export-profiles/${profile.body.profile.id}/versions`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        format: 'csv',
        rowMode: 'order',
        columns: [
          { key: 'orderNumber', label: 'Order', type: 'text' },
          { key: 'currency', label: 'Currency', type: 'text' },
          { key: 'grandTotalMinor', label: 'Total minor', type: 'text' },
        ],
        filenameTemplate: 'critical-{format}',
      }),
    });
    assert.equal(version.response.status, 201);
    const batch = await request('/api/v1/export-batches', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        selectionId: selection.body.selection.id,
        profileVersionId: version.body.version.id,
        idempotencyKey: 'critical-export-1',
      }),
    });
    assert.equal(batch.response.status, 202);
    assert.equal(batch.body.batch.status, 'queued');

    const exportStore = new SqliteStore(databasePath);
    const exportContext = { ...context, correlationId: 'critical-export-correlation' };
    let csv;
    let exportPath;
    let completedBatch;
    try {
      const exportOrders = orderIds.map((id) => exportStore.getOrder(exportContext, id));
      assert.equal(exportOrders.every(Boolean), true);
      csv = generateCsv(exportOrders, {
        name: 'Critical shipping export',
        version: 1,
        format: 'csv',
        rowMode: 'order',
        columns: [
          { key: 'orderNumber', label: 'Order', type: 'text' },
          { key: 'currency', label: 'Currency', type: 'text' },
          { key: 'grandTotalMinor', label: 'Total minor', type: 'text' },
        ],
        filenameTemplate: 'critical-{format}',
      });
      exportPath = join(dataDirectory, 'exports', 'critical.csv');
      mkdirSync(join(dataDirectory, 'exports'), { recursive: true });
      writeFileSync(exportPath, csv, { mode: 0o600 });
      exportStore.startExportBatch(exportContext, batch.body.batch.id);
      completedBatch = exportStore.completeExportBatch(exportContext, batch.body.batch.id, {
        orderCount: orderIds.length,
        rowCount: orderIds.length,
        filename: 'critical.csv',
        filePath: 'exports/critical.csv',
        checksum: sha256(csv),
      });
    } finally {
      if (exportStore.db.open) exportStore.db.close();
    }
    assert.equal(completedBatch.status, 'completed');
    const marked = await request(`/api/v1/export-batches/${completedBatch.id}/mark-exported`, {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ orderIds }),
    });
    assert.equal(marked.response.status, 200);
    assert.equal(marked.body.result.recorded, 2);
    const exported = await request('/api/v1/orders/query', {
      method: 'POST',
      headers: readHeaders,
      body: JSON.stringify({
        filter: { field: 'exportState', operator: 'equals', value: 'exported' },
      }),
    });
    assert.equal(exported.body.items.length, 2);

    const costRule = await request('/api/v1/cost-rules', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        scope: 'product',
        key: '101',
        currency: 'EGP',
        amountMinor: '500',
        source: 'critical fixture',
        effectiveFrom: '2026-01-01T00:00:00.000Z',
      }),
    });
    assert.equal(costRule.response.status, 201);
    const rebuild = await request('/api/v1/analytics/rebuilds', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({ source: 'combined' }),
    });
    assert.equal(rebuild.response.status, 202);
    const analytics = await request('/api/v1/analytics/summary', {
      method: 'POST',
      headers: readHeaders,
      body: JSON.stringify({ source: 'combined' }),
    });
    assert.equal(analytics.response.status, 200);
    assert.equal(analytics.body.summary.currencies[0].orderCount, 2);

    const template = await request('/api/v1/document-templates', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        name: 'Critical invoice',
        format: 'a4',
        locale: 'en-US',
        direction: 'ltr',
        body: '{{order.number}} {{customer.name}}',
        companyName: 'Woo Ops',
      }),
    });
    assert.equal(template.response.status, 201);
    const invoice = await request(
      `/api/v1/document-templates/${template.body.template.id}/orders/${manualId}`,
      {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ format: 'a4', barcodeValue: 'MANUAL-CRITICAL' }),
      },
    );
    assert.equal(invoice.response.status, 201, JSON.stringify(invoice.body));
    const thermal = await request(
      `/api/v1/document-templates/${template.body.template.id}/orders/${manualId}`,
      {
        method: 'POST',
        headers: writeHeaders,
        body: JSON.stringify({ format: 'thermal-80mm', barcodeValue: 'MANUAL-CRITICAL' }),
      },
    );
    assert.equal(thermal.response.status, 201, JSON.stringify(thermal.body));
    const download = await request(`/api/v1/document-files/${invoice.body.file.id}`, {
      headers: readHeaders,
    });
    assert.equal(download.response.status, 200);
    assert.ok(download.body.byteLength > 100);
    assert.match(download.response.headers.get('x-document-checksum') ?? '', /^[a-f0-9]{64}$/);

    await stopApi(child);
    const backupStore = new SqliteStore(databasePath);
    let manifest;
    let extra;
    try {
      manifest = await createBackup({
        dataDirectory,
        databasePath,
        database: backupStore.db,
        retention: 2,
      });
      extra = backupStore.createManualOrder(exportContext, {
        currency: 'EGP',
        lines: [{ name: 'After backup', quantity: 1, unitPriceMinor: '100' }],
      });
    } finally {
      if (backupStore.db.open) backupStore.db.close();
    }
    assert.equal(listBackups(dataDirectory).length, 1);
    const restored = await restoreBackup({
      dataDirectory,
      databasePath,
      backupId: manifest.id,
      dryRun: false,
    });
    assert.equal(restored.restored, true);
    const restoredStore = new SqliteStore(databasePath);
    try {
      assert.equal(restoredStore.getOrder(exportContext, extra.id), null);
      assert.equal(restoredStore.getOrder(exportContext, manualId)?.origin, 'manual');
      assert.equal(restoredStore.listDocumentFiles(exportContext, manualId).length, 2);
      assert.equal(readFileSync(exportPath).byteLength, csv.byteLength);
    } finally {
      if (restoredStore.db.open) restoredStore.db.close();
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) await stopApi(child);
    try {
      rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      console.error(
        `CRITICAL_E2E_CLEANUP_FAILED ${error instanceof Error ? error.message : error}`,
      );
    }
  }
});
