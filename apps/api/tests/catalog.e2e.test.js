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

test('catalog API validates repeated category IDs and returns their account-scoped intersection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-catalog-api-'));
  const databasePath = join(directory, 'catalog.sqlite');
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string')
        return reject(new Error('CATALOG_PORT_UNAVAILABLE'));
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
      SESSION_SECRET: 'catalog-category-api-test-secret-with-enough-entropy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));
  let store;
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
      throw new Error(`CATALOG_API_START_TIMEOUT ${output.slice(-500)}`);

    const unauthenticated = await fetch(`${baseUrl}/api/v1/catalog?categoryId=4`);
    assert.equal(unauthenticated.status, 401);
    const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `catalog-${randomUUID()}@example.test`,
        password: 'correct horse battery staple',
        accountName: 'Catalog test',
      }),
    });
    assert.equal(registration.status, 201);
    const { user } = await registration.json();
    const cookie = (
      typeof registration.headers.getSetCookie === 'function'
        ? registration.headers.getSetCookie()
        : [registration.headers.get('set-cookie') ?? '']
    ).join('; ');
    const connectionId = randomUUID();
    const now = new Date().toISOString();
    store = new SqliteStore(databasePath);
    store.db
      .prepare(
        'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        connectionId,
        user.accountId,
        'woocommerce',
        'https://catalog.example.test',
        'active',
        now,
        now,
      );
    store.upsertCatalogPage(
      { accountId: user.accountId, correlationId: randomUUID() },
      {
        connectionId,
        cursor: 'products:1',
        pages: 1,
        items: [
          { externalId: '10', categories: [4, 5], name: 'Shared' },
          { externalId: '11', categories: [4], name: 'Single' },
        ].map((item) => ({
          identity: `product:${item.externalId}:variation:base`,
          kind: 'product',
          externalId: item.externalId,
          parentExternalId: null,
          name: item.name,
          sku: null,
          sourceJson: JSON.stringify({
            categories: item.categories.map((id) => ({ id, name: `Category ${id}` })),
          }),
        })),
      },
    );
    const request = (query) => fetch(`${baseUrl}/api/v1/catalog?${query}`, { headers: { cookie } });
    const filtered = await request('kind=product&categoryId=4&categoryId=5&limit=1');
    assert.equal(filtered.status, 200);
    const filteredBody = await filtered.json();
    assert.equal(filteredBody.totalCount, 1);
    assert.deepEqual(
      filteredBody.items.map((item) => item.name),
      ['Shared'],
    );
    assert.equal((await request('categoryId=0')).status, 400);
    assert.equal((await request('categoryId=4&categoryId=bad')).status, 400);
    assert.equal(
      (await request(new URLSearchParams(Array(21).fill(['categoryId', '4'])).toString())).status,
      400,
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
