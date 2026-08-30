import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApiJobRunner } from '../src/job-runner.js';
import { SqliteStore } from '@woo-ops/persistence';

const directory = mkdtempSync(join(tmpdir(), 'woo-api-job-runner-'));
const store = new SqliteStore(join(directory, 'runner.sqlite'));
const accountId = randomUUID();
const actorId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Runner account', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'runner@example.test', 'fixture', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'admin', now);
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const worker = { accountId, correlationId: randomUUID() };
const runner = createApiJobRunner(store, { concurrency: 2, leaseSeconds: 5, pollIntervalMs: 10 });

test('API runner executes bulk and analytics jobs through durable transitions', async () => {
  const order = store.createManualOrder(context, {
    currency: 'EGP',
    lines: [{ name: 'Runner product', quantity: 1, unitPriceMinor: '1200' }],
  });
  const selection = store.createSelection(context, { mode: 'explicit', orderIds: [order.id] });
  const bulk = store.createBulkJob(context, {
    selectionId: selection.id,
    action: 'update-local-status',
    parameters: { status: 'ready' },
    idempotencyKey: randomUUID(),
  });
  const analyticsJob = store.enqueueJob(context, {
    id: randomUUID(),
    type: 'analytics.rebuild',
    idempotencyKey: randomUUID(),
    payload: { source: 'manual' },
  });
  const processed = await runner.drain({ maxJobs: 10 });
  assert.equal(processed, 2);
  assert.equal(store.getOrder(context, order.id).localStatus, 'ready');
  assert.equal(store.getBulkJobForWorker(worker, bulk.id).status, 'succeeded');
  assert.equal(store.getJob(context, analyticsJob.id).status, 'succeeded');
});

test('webhook processing normalizes a read-only remote snapshot and is replay-safe', async () => {
  const connectionId = randomUUID();
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(connectionId, accountId, 'woocommerce', 'https://runner-shop.example', 'active', now, now);
  const body = Buffer.from(
    JSON.stringify({
      id: 901,
      number: '901',
      status: 'processing',
      currency: 'EGP',
      total: '125.00',
      date_created_gmt: '2026-08-31T08:00:00Z',
      date_modified_gmt: '2026-08-31T08:00:00Z',
      billing: { first_name: 'Test' },
      shipping: { city: 'Cairo' },
      line_items: [
        {
          id: 1,
          product_id: 11,
          variation_id: 0,
          quantity: 1,
          name: 'Remote item',
          sku: 'REMOTE-1',
          subtotal: '125.00',
          total: '125.00',
          total_tax: '0.00',
        },
      ],
      refunds: [],
    }),
  );
  const inbox = store.acceptWebhook({
    id: randomUUID(),
    accountId,
    connectionId,
    deliveryKey: randomUUID(),
    topic: 'order.created',
    body,
    checksum: createHash('sha256').update(body).digest('hex'),
  });
  const job = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'webhook.process',
    idempotencyKey: inbox.inboxId,
    payload: { inboxId: inbox.inboxId },
  });
  await runner.drain({ maxJobs: 10 });
  assert.equal(store.getJob(context, job.id).status, 'succeeded');
  const order = store.getOrder(context, `${accountId}:${connectionId}:order:901`);
  assert.equal(order.remoteStatus, 'processing');
  assert.equal(
    store.db.prepare('SELECT status FROM webhook_inbox WHERE id = ?').get(inbox.inboxId).status,
    'processed',
  );
  await runner.drain({ maxJobs: 10 });
  assert.equal(
    store.getOrder(context, `${accountId}:${connectionId}:order:901`).remoteStatus,
    'processing',
  );
});

test('webhook deletion marks the local remote snapshot without issuing a platform mutation', async () => {
  const connectionId = store.db
    .prepare('SELECT id FROM connections WHERE account_id = ? LIMIT 1')
    .get(accountId).id;
  const body = Buffer.from(JSON.stringify({ id: 901 }));
  const inbox = store.acceptWebhook({
    id: randomUUID(),
    accountId,
    connectionId,
    deliveryKey: randomUUID(),
    topic: 'order.deleted',
    body,
    checksum: createHash('sha256').update(body).digest('hex'),
  });
  const job = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'webhook.process',
    idempotencyKey: inbox.inboxId,
    payload: { inboxId: inbox.inboxId },
    maxAttempts: 1,
  });
  await runner.drain({ maxJobs: 1 });
  assert.equal(store.getJob(context, job.id).status, 'succeeded');
  assert.equal(
    store.db.prepare('SELECT remote_deleted_at FROM orders WHERE external_order_id = ?').get('901')
      .remote_deleted_at !== null,
    true,
  );
});

test('unconfigured effect jobs fail visibly and never masquerade as completed work', async () => {
  const job = store.enqueueJob(worker, {
    id: randomUUID(),
    type: 'export.generate',
    idempotencyKey: randomUUID(),
    payload: { orderId: 'fixture' },
    maxAttempts: 1,
  });
  await runner.drain({ maxJobs: 10 });
  const result = store.getJob(context, job.id);
  assert.equal(result.status, 'dead-lettered');
  assert.equal(result.lastError, 'EXPORT_HANDLER_NOT_CONFIGURED');
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
