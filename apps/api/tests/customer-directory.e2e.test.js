import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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
    return { response, body: await response.json() };
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
          customer: { first_name: name, email: `${name}@example.test` },
          billing: { first_name: name, email: `${name}@example.test` },
          shipping: {},
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
