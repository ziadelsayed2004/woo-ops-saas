import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';
import { createApiJobRunner } from '../src/job-runner.js';
import { createExportEffect } from '../src/export-effect.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-export-runtime-'));
const storageRoot = join(directory, 'private-exports');
const store = new SqliteStore(join(directory, 'exports.sqlite'));
const accountId = randomUUID();
const actorId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Export runtime', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'export-runtime@example.test', 'fixture', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'admin', now);
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };

test('export batch creates a durable job, writes a private artifact, and marks state locally', async () => {
  const first = store.createManualOrder(context, {
    currency: 'EGP',
    customer: { name: 'Export runtime customer' },
    billing: { phone: '01001234567' },
    lines: [{ name: 'Runtime item', sku: '00123', quantity: 1, unitPriceMinor: '12500' }],
  });
  const second = store.createManualOrder(context, {
    currency: 'EGP',
    customer: { name: 'Second customer' },
    lines: [{ name: 'Second item', quantity: 2, unitPriceMinor: '500' }],
  });
  const selection = store.createSelection(context, {
    mode: 'explicit',
    orderIds: [first.id, second.id],
  });
  const profile = store.createExportProfile(context, { name: 'Runtime CSV' });
  const version = store.createExportProfileVersion(context, profile.id, {
    format: 'csv',
    rowMode: 'line',
    columns: [
      { key: 'orderNumber', label: 'Order', type: 'text' },
      { key: 'billing.phone', label: 'Phone', type: 'text' },
      { key: 'line.sku', label: 'SKU', type: 'text' },
      { key: 'line.name', label: 'Product', type: 'text' },
    ],
    filenameTemplate: 'runtime-{format}',
  });
  const batch = store.createExportBatch(context, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: 'runtime-export-1',
  });
  assert.ok(batch.jobId);
  assert.equal(store.getJob(context, batch.jobId).type, 'export.generate');

  const runner = createApiJobRunner(store, {
    concurrency: 1,
    pollIntervalMs: 10,
    effects: { export: createExportEffect(store, storageRoot) },
  });
  assert.equal(await runner.drain({ maxJobs: 1 }), 1);
  const completed = store.getExportBatch(context, batch.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.snapshotComplete, true);
  assert.equal(completed.orderCount, 2);
  assert.equal(completed.rowCount, 2);
  assert.ok(completed.filePath);
  assert.ok(completed.checksum);
  assert.ok(completed.orderSnapshotHash);
  const artifact = readFileSync(join(storageRoot, completed.filePath));
  assert.equal(createHash('sha256').update(artifact).digest('hex'), completed.checksum);
  assert.match(artifact.toString('utf8'), /Order,Phone,SKU,Product/);
  assert.equal(store.getOrder(context, first.id).exportState, 'exported');
  assert.equal(store.getOrder(context, second.id).exportState, 'exported');
  assert.equal(store.getJob(context, batch.jobId).status, 'succeeded');
  assert.equal(existsSync(join(directory, 'public', completed.filePath)), false);
});

test('failed export batches can be retried with a new deterministic job identity', () => {
  const order = store.createManualOrder(context, {
    currency: 'EGP',
    lines: [{ name: 'Retry item', quantity: 1, unitPriceMinor: '100' }],
  });
  const selection = store.createSelection(context, { mode: 'explicit', orderIds: [order.id] });
  const profile = store.createExportProfile(context, { name: `Retry ${randomUUID()}` });
  const version = store.createExportProfileVersion(context, profile.id, {
    format: 'csv',
    rowMode: 'order',
    columns: [{ key: 'orderNumber', label: 'Order', type: 'text' }],
    filenameTemplate: 'retry-{format}',
  });
  const batch = store.createExportBatch(context, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: randomUUID(),
  });
  store.failExportBatch(context, batch.id, 'fixture failure');
  const retried = store.retryExportBatch(context, batch.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attemptCount, 1);
  assert.notEqual(retried.jobId, batch.jobId);
  const superseded = store.getJob(context, batch.jobId);
  assert.equal(superseded.status, 'failed');
  assert.equal(superseded.cancelRequested, true);
  assert.equal(superseded.lastError, 'EXPORT_RETRY_SUPERSEDED');
  assert.equal(store.getJob(context, retried.jobId).status, 'queued');
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
