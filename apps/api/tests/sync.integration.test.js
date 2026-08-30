import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { encryptCredentialEnvelope } from '@woo-ops/connectors';
import { SqliteStore } from '@woo-ops/persistence';
import { createApiJobRunner } from '../src/job-runner.js';
import { createWooSyncEffect, healthCheckWooConnection } from '../src/woo-sync.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-sync-integration-'));
const store = new SqliteStore(join(directory, 'sync.sqlite'));
const accountId = randomUUID();
const actorId = randomUUID();
const connectionId = randomUUID();
const now = '2026-08-31T10:00:00.000Z';
const encryptionKey = Buffer.alloc(32, 13).toString('base64');
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const worker = { accountId, correlationId: randomUUID() };

store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Sync account', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'sync-owner@example.test', 'fixture', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'admin', now);
store.db
  .prepare(
    `INSERT INTO connections (id, account_id, platform, store_url, status, encrypted_credentials, created_at, updated_at)
     VALUES (?, ?, 'woocommerce', ?, 'active', ?, ?, ?)`,
  )
  .run(
    connectionId,
    accountId,
    'https://sync-shop.example.test',
    JSON.stringify(
      encryptCredentialEnvelope({ key: 'ck_sync_read', secret: 'cs_sync_secret' }, encryptionKey),
    ),
    now,
    now,
  );

const order = (id) => ({
  id,
  number: `SYNC-${id}`,
  status: 'processing',
  currency: 'EGP',
  total: id === 1 ? '125.00' : '225.00',
  date_created_gmt: '2026-08-30T08:00:00.000Z',
  date_modified_gmt: `2026-08-30T08:0${id}:00.000Z`,
  billing: { email: `sync-${id}@example.test` },
  shipping: { city: 'Cairo' },
  line_items: [
    {
      id,
      product_id: 100 + id,
      variation_id: 0,
      name: `Sync product ${id}`,
      sku: `SYNC-${id}`,
      quantity: 1,
      subtotal: id === 1 ? '125.00' : '225.00',
      total: id === 1 ? '125.00' : '225.00',
      total_tax: '0.00',
    },
  ],
  refunds: [],
});

const response = (body, totalPages = 1) =>
  new Response(JSON.stringify(body), { headers: { 'x-wp-totalpages': String(totalPages) } });

test('Woo sync health, resumable checkpoints, retry classification, and reconciliation are durable', async () => {
  let failSecondOrderPage = true;
  let reconcileMode = false;
  const calls = [];
  const request = async (url, init) => {
    const parsed = new URL(String(url));
    calls.push({ url: parsed, init });
    assert.equal(init.method, 'GET');
    if (parsed.pathname.endsWith('/system_status'))
      return response({ version: '9.8.0', environment: { wp_version: '6.7.2' } });
    if (parsed.pathname.endsWith('/products'))
      return response([{ id: 101, name: 'Sync product', type: 'simple', variations: [] }]);
    if (parsed.pathname.endsWith('/categories')) return response([{ id: 7, name: 'Clothing' }]);
    if (parsed.pathname.endsWith('/tags')) return response([{ id: 8, name: 'Featured' }]);
    if (parsed.pathname.endsWith('/shipping_classes'))
      return response([{ id: 9, name: 'Standard' }]);
    if (parsed.pathname.endsWith('/orders')) {
      const page = Number(parsed.searchParams.get('page'));
      if (reconcileMode) return response([order(1)]);
      if (page === 1) return response([order(1)], 2);
      if (page === 2 && failSecondOrderPage) {
        failSecondOrderPage = false;
        throw new Error('fetch failed');
      }
      return response([order(2)], 2);
    }
    throw new Error(`unexpected endpoint ${parsed.pathname}`);
  };
  const options = {
    encryptionKey,
    request,
    resolveHost: async () => [{ address: '93.184.216.34' }],
    overlapSeconds: 300,
  };
  const execution = {
    accountId,
    correlationId: randomUUID(),
    signal: new AbortController().signal,
    isCancellationRequested: () => false,
    reportProgress: () => undefined,
  };

  const healthy = await healthCheckWooConnection(store, context, connectionId, options);
  assert.equal(healthy.healthStatus, 'healthy');
  assert.equal(healthy.platformVersion, '9.8.0');
  assert.equal(healthy.wordpressVersion, '6.7.2');
  assert.equal(healthy.syncStatus, 'idle');

  const initialJob = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'sync.initial',
    idempotencyKey: 'sync-resume-initial',
    payload: { connectionId },
    maxAttempts: 3,
  });
  const effect = createWooSyncEffect(store, options);
  await assert.rejects(effect(initialJob, execution), /fetch failed/);
  const failedRun = store.getSyncRun(worker, initialJob.id);
  assert.equal(failedRun.status, 'failed');
  assert.equal(failedRun.errorCategory, 'network');
  assert.match(failedRun.cursor, /"phase":"orders"/u);
  assert.match(failedRun.cursor, /"page":2/u);
  assert.equal(failedRun.items, 5);
  assert.equal(store.getConnection(context, connectionId).syncStatus, 'failed');

  await effect(initialJob, execution);
  const completedRun = store.getSyncRun(worker, initialJob.id);
  assert.equal(completedRun.status, 'succeeded');
  assert.equal(completedRun.items, 6);
  assert.match(completedRun.cursor, /"phase":"complete"/u);
  assert.equal(store.getConnection(context, connectionId).syncStatus, 'succeeded');
  assert.equal(
    store.db
      .prepare('SELECT COUNT(*) AS count FROM catalog_items WHERE account_id = ?')
      .get(accountId).count,
    4,
  );
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM orders WHERE account_id = ?').get(accountId)
      .count,
    2,
  );

  reconcileMode = true;
  const reconcileJob = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'sync.reconcile',
    idempotencyKey: 'sync-reconcile-1',
    payload: { connectionId },
    maxAttempts: 2,
  });
  await effect(reconcileJob, execution);
  assert.equal(store.getSyncRun(worker, reconcileJob.id).status, 'succeeded');
  assert.equal(
    store.db.prepare('SELECT remote_deleted_at FROM orders WHERE external_order_id = ?').get('2')
      .remote_deleted_at !== null,
    true,
  );
  assert.equal(store.getConnection(context, connectionId).syncDeletedCount, 1);
  assert.ok(calls.every(({ init }) => init.redirect === 'manual'));
  store.db
    .prepare(
      "UPDATE jobs SET status = 'succeeded', progress = 100 WHERE account_id = ? AND id IN (?, ?)",
    )
    .run(accountId, initialJob.id, reconcileJob.id);
});

test('API runner wires sync jobs to the durable effect and keeps failures observable', async () => {
  const job = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'sync.incremental',
    idempotencyKey: 'sync-incremental-runner',
    payload: { connectionId },
    maxAttempts: 1,
  });
  const runner = createApiJobRunner(store, {
    concurrency: 1,
    pollIntervalMs: 10,
    effects: {
      sync: createWooSyncEffect(store, {
        encryptionKey,
        request: async (url, init) => {
          assert.equal(init.method, 'GET');
          const parsed = new URL(String(url));
          if (parsed.pathname.endsWith('/orders')) return response([]);
          throw new Error('WOO_UNEXPECTED_INCREMENTAL_ENDPOINT');
        },
        resolveHost: async () => [{ address: '93.184.216.34' }],
      }),
    },
  });
  await runner.drain({ maxJobs: 1 });
  assert.equal(store.getJob(context, job.id).status, 'succeeded');
  assert.equal(store.getSyncRun(worker, job.id).status, 'succeeded');
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
