import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';

test('customer product filtering is authenticated, account-scoped and keeps lifetime totals', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-customer-api-'));
  const databasePath = join(directory, 'customers.sqlite');
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('CUSTOMER_PORT_UNAVAILABLE'));
      server.close(() => resolve(address.port));
    });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      WEB_PUBLIC_URL: baseUrl,
      WOO_OPS_DATA_DIR: directory,
      WOO_OPS_DATABASE: databasePath,
      SESSION_SECRET: 'customer-directory-api-test-secret-with-enough-entropy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));
  let store;
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    return { response, body: response.status === 204 ? null : await response.json() };
  };
  try {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if ((await fetch(`${baseUrl}/health`)).ok) break;
      } catch {
        // Server startup is asynchronous.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!(await fetch(`${baseUrl}/health`)).ok)
      throw new Error(`CUSTOMER_API_START_TIMEOUT ${output.slice(-500)}`);

    const register = async (name) => {
      const result = await request('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          email: `${name}-${randomUUID()}@example.test`,
          password: 'correct horse battery staple',
          accountName: name,
        }),
      });
      assert.equal(result.response.status, 201);
      const cookies = (
        typeof result.response.headers.getSetCookie === 'function'
          ? result.response.headers.getSetCookie()
          : [result.response.headers.get('set-cookie') ?? '']
      ).join('; ');
      return { user: result.body.user, headers: { cookie: cookies } };
    };
    const first = await register('first');
    const second = await register('second');
    store = new SqliteStore(databasePath);
    const now = '2026-09-29T10:00:00.000Z';
    const connections = new Map();
    const addOrder = (owner, id, productId, name, amount) => {
      let connectionId = connections.get(owner.user.accountId);
      if (!connectionId) {
        connectionId = randomUUID();
        store.db
          .prepare(
            'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            connectionId,
            owner.user.accountId,
            'woocommerce',
            `https://${name}.example.test`,
            'active',
            now,
            now,
          );
        connections.set(owner.user.accountId, connectionId);
      }
      store.upsertRemoteOrder(
        {
          accountId: owner.user.accountId,
          actorId: owner.user.id,
          role: 'owner',
          correlationId: randomUUID(),
        },
        connectionId,
        {
          externalOrderId: id,
          orderNumber: id,
          remoteStatus: 'processing',
          externalCustomerId: '44',
          currency: 'EGP',
          grandTotalMinor: amount,
          amounts: { grandTotalMinor: amount, collectedMinor: amount },
          createdAt: now,
          modifiedAt: now,
          customer: { first_name: name, email: `${name}@example.test`, phone: '01000000001' },
          billing: { first_name: name, email: `${name}@example.test` },
          shipping: { governorateNameAr: 'القاهرة' },
          lines: [{ productId, name: 'Item', quantity: 1, unitPriceMinor: amount }],
          refunds: [],
          sourceJson: JSON.stringify({ id }),
          sourceHash: `hash-${id}`,
        },
      );
    };
    addOrder(first, 'first-1', '101', 'First', '10000');
    addOrder(first, 'first-2', '202', 'First', '25000');
    addOrder(second, 'second-1', '101', 'Second', '99000');

    const unauthenticated = await request('/api/v1/customers?productId=101');
    assert.equal(unauthenticated.response.status, 401);
    const firstResult = await request('/api/v1/customers?productId=101', {
      headers: first.headers,
    });
    assert.equal(firstResult.response.status, 200);
    assert.equal(firstResult.body.items.length, 1);
    assert.equal(firstResult.body.items[0].name, 'First');
    assert.equal(firstResult.body.items[0].orderCount, 2);
    assert.equal(firstResult.body.items[0].currencies[0].totalSpendMinor, '35000');
    const secondResult = await request('/api/v1/customers?productId=202', {
      headers: second.headers,
    });
    assert.equal(secondResult.response.status, 200);
    assert.equal(secondResult.body.items.length, 0);
    const invalid = await request('/api/v1/customers?productId=' + 'x'.repeat(101), {
      headers: first.headers,
    });
    assert.equal(invalid.response.status, 400);

    // Follow-up reporting uses local snapshots only, not Woo credentials or network reads.
    store.db
      .prepare("UPDATE orders SET remote_status = 'failed' WHERE account_id = ?")
      .run(first.user.accountId);
    const reportList = await request('/api/v1/customer-recovery?productId=101', {
      headers: first.headers,
    });
    assert.equal(reportList.response.status, 200);
    assert.equal(reportList.body.items.length, 1);
    assert.equal(reportList.body.items[0].failedCount, 2);
    assert.equal(reportList.body.freshness.stale, true);
    assert.equal((await request('/api/v1/customer-recovery')).response.status, 401);
    assert.equal(
      (await request('/api/v1/customer-recovery?accountId=spoof', { headers: first.headers }))
        .response.status,
      400,
    );
    assert.equal(
      (await request('/api/v1/customer-recovery?from=2026-99-99', { headers: first.headers }))
        .response.status,
      400,
    );
    assert.equal(
      (await request('/api/v1/customer-recovery', { headers: second.headers })).body.items.length,
      0,
    );
    const exportBody = { filter: {}, locale: 'ar', idempotencyKey: randomUUID() };
    assert.equal(
      (
        await request('/api/v1/customer-recovery/reports', {
          method: 'POST',
          headers: first.headers,
          body: JSON.stringify(exportBody),
        })
      ).response.status,
      403,
    );
    const csrf = first.headers.cookie.match(/woo_ops_csrf=([^;]+)/u)?.[1];
    assert.ok(csrf);
    const exportHeaders = { ...first.headers, 'x-csrf-token': csrf };
    const created = await request('/api/v1/customer-recovery/reports', {
      method: 'POST',
      headers: exportHeaders,
      body: JSON.stringify(exportBody),
    });
    assert.equal(created.response.status, 202, JSON.stringify(created.body));
    const report = created.body.report;
    assert.equal(
      (await request(`/api/v1/customer-recovery/reports/${report.id}`, { headers: second.headers }))
        .response.status,
      404,
    );
    const duplicate = await request('/api/v1/customer-recovery/reports', {
      method: 'POST',
      headers: exportHeaders,
      body: JSON.stringify(exportBody),
    });
    assert.equal(duplicate.body.report.id, report.id);
    const exportDeadline = Date.now() + 15_000;
    let complete;
    while (Date.now() < exportDeadline) {
      const history = await request('/api/v1/customer-recovery/reports', {
        headers: first.headers,
      });
      complete = history.body.items.find((r) => r.id === report.id);
      if (complete?.status === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(complete?.status, 'completed', output.slice(-1000));
    assert.equal(complete.rowCount, 1);
    assert.equal(
      (await request('/api/v1/customer-recovery/reports', { headers: second.headers })).body.items
        .length,
      0,
    );
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}/download`, {
          headers: second.headers,
        })
      ).response.status,
      404,
    );
    const downloaded = await fetch(
      `${baseUrl}/api/v1/customer-recovery/reports/${report.id}/download`,
      { headers: first.headers },
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers.get('cache-control'), 'private, no-store');
    const bytes = Buffer.from(await downloaded.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.rowCount, 2);
    assert.equal(sheet.getCell('A1').value, 'الاسم بالكامل');
    assert.equal(sheet.getCell('H1').value, 'قيمة الطلب');
    assert.equal(sheet.views[0].rightToLeft, true);
    assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFF1F3F5');
    assert.equal(sheet.getCell('C2').value, 'first@example.test');
    assert.equal(sheet.getCell('B2').value, '01000000001');
    assert.equal(sheet.getCell('D2').value, 'القاهرة');
    assert.equal(sheet.getCell('F2').value.toISOString(), '2026-09-29T10:00:00.000Z');
    assert.equal(sheet.getCell('K2').value, 2);
    assert.equal(
      store.db
        .prepare('SELECT COUNT(*) AS n FROM order_export_events WHERE account_id = ?')
        .get(first.user.accountId).n,
      0,
    );
    assert.equal(
      store.db
        .prepare(
          "SELECT COUNT(*) AS n FROM orders WHERE account_id = ? AND export_state <> 'never-exported'",
        )
        .get(first.user.accountId).n,
      0,
    );
    if (process.env.WOO_OPS_RECOVERY_QA_DIR) {
      mkdirSync(process.env.WOO_OPS_RECOVERY_QA_DIR, { recursive: true });
      writeFileSync(join(process.env.WOO_OPS_RECOVERY_QA_DIR, 'customer-follow-up.xlsx'), bytes);
    }
    const status = await request(`/api/v1/customer-recovery/reports/${report.id}`, {
      headers: first.headers,
    });
    assert.equal(status.body.report.status, 'completed');
    assert.equal('filePath' in status.body.report, false);
    assert.equal(
      (await request('/api/v1/customer-recovery/reports?limit=0', { headers: first.headers }))
        .response.status,
      400,
    );
    assert.equal(
      (
        await request('/api/v1/customer-recovery/reports?cursor=invalid', {
          headers: first.headers,
        })
      ).response.status,
      400,
    );
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}`, {
          method: 'DELETE',
          headers: first.headers,
        })
      ).response.status,
      403,
    );
    const otherCsrf = second.headers.cookie.match(/woo_ops_csrf=([^;]+)/u)?.[1];
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}`, {
          method: 'DELETE',
          headers: { ...second.headers, 'x-csrf-token': otherCsrf },
        })
      ).response.status,
      404,
    );
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}`, {
          method: 'DELETE',
          headers: exportHeaders,
        })
      ).response.status,
      204,
    );
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}`, {
          method: 'DELETE',
          headers: exportHeaders,
        })
      ).response.status,
      204,
    );
    assert.equal(
      (
        await request('/api/v1/customer-recovery/reports', { headers: first.headers })
      ).body.items.some((item) => item.id === report.id),
      false,
    );
    const saved = await fetch(`${baseUrl}/api/v1/customer-recovery/reports/${report.id}/download`, {
      headers: first.headers,
    });
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()), bytes);
    assert.equal(
      store.db
        .prepare('SELECT COUNT(*) AS n FROM order_export_events WHERE account_id = ?')
        .get(first.user.accountId).n,
      0,
    );
    store.db
      .prepare(
        "UPDATE account_memberships SET role = 'viewer' WHERE account_id = ? AND user_id = ?",
      )
      .run(first.user.accountId, first.user.id);
    assert.equal(
      (
        await request(`/api/v1/customer-recovery/reports/${report.id}`, {
          method: 'DELETE',
          headers: exportHeaders,
        })
      ).response.status,
      403,
    );
    assert.equal(
      (
        await request('/api/v1/customer-recovery/reports', {
          method: 'POST',
          headers: exportHeaders,
          body: JSON.stringify({ ...exportBody, idempotencyKey: randomUUID() }),
        })
      ).response.status,
      403,
    );
  } finally {
    if (store?.db.open) store.db.close();
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
    rmSync(directory, { recursive: true, force: true });
  }
});
