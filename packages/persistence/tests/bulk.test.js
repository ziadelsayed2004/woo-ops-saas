import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-bulk-'));
const store = new SqliteStore(join(directory, 'bulk.sqlite'));
const now = new Date().toISOString();
const accountId = randomUUID();
const otherAccountId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();
const viewerId = randomUUID();
const connectionId = randomUUID();
const otherConnectionId = randomUUID();
for (const [id, name] of [
  [accountId, 'Bulk test account'],
  [otherAccountId, 'Other account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email] of [
  [userId, 'bulk@example.test'],
  [otherUserId, 'other@example.test'],
  [viewerId, 'viewer@example.test'],
])
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'test-hash', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, userId, 'admin', now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, viewerId, 'viewer', now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(otherAccountId, otherUserId, 'admin', now);
for (const [id, account, url] of [
  [connectionId, accountId, 'https://bulk-shop.test'],
  [otherConnectionId, otherAccountId, 'https://other-shop.test'],
])
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, account, 'woocommerce', url, 'active', now, now);

const context = { accountId, actorId: userId, correlationId: randomUUID() };
const otherContext = {
  accountId: otherAccountId,
  actorId: otherUserId,
  correlationId: randomUUID(),
};
const viewerContext = { accountId, actorId: viewerId, correlationId: randomUUID() };
const orderInput = (externalOrderId, orderNumber) => ({
  externalOrderId,
  orderNumber,
  remoteStatus: 'processing',
  currency: 'EGP',
  grandTotalMinor: '10000',
  createdAt: now,
  modifiedAt: now,
  customer: {},
  billing: {},
  shipping: {},
  lines: [],
  refunds: [],
  sourceJson: JSON.stringify({ id: externalOrderId, number: orderNumber }),
  sourceHash: `hash-${externalOrderId}`,
});
const orderA = store.upsertRemoteOrder(context, connectionId, orderInput('a-1', 'A-1'));
const orderB = store.upsertRemoteOrder(context, connectionId, orderInput('a-2', 'A-2'));
const otherOrder = store.upsertRemoteOrder(
  otherContext,
  otherConnectionId,
  orderInput('b-1', 'B-1'),
);

test('explicit selections are account-scoped, bounded, and support exclusions', () => {
  const selection = store.createSelection(context, {
    mode: 'explicit',
    orderIds: [orderA, orderB],
    exclusions: [orderB],
  });
  assert.equal(selection.mode, 'explicit');
  assert.deepEqual(selection.exclusions, [orderB]);
  assert.equal(selection.estimatedCount, 1);
  assert.deepEqual(store.resolveSelection(context, selection.id).items, [orderA]);
  assert.throws(() => store.getSelection(otherContext, selection.id), /SELECTION_NOT_FOUND/);
  assert.throws(
    () => store.createSelection(viewerContext, { mode: 'explicit', orderIds: [orderA] }),
    /BULK_PERMISSION_DENIED/,
  );
  assert.equal(
    store.db
      .prepare('SELECT LENGTH(query_json) AS size FROM selection_snapshots WHERE id = ?')
      .get(selection.id).size <
      32 * 1024,
    true,
  );
});

test('query snapshots keep a watermark and exclude later arrivals by default', () => {
  const watermark = new Date().toISOString();
  const selection = store.createSelection(context, {
    mode: 'query',
    query: { filter: { field: 'origin', operator: 'equals', value: 'woo' } },
    watermark,
    exclusions: [orderB],
  });
  const lateOrder = store.upsertRemoteOrder(context, connectionId, orderInput('a-late', 'A-LATE'));
  const later = new Date(Date.parse(selection.watermark) + 1_000).toISOString();
  store.db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run(later, lateOrder);
  const page = store.resolveSelection(context, selection.id);
  assert.deepEqual(page.items, [orderA]);
  assert.equal(page.totalCount, 1);
  const preview = store.previewBulk(context, {
    selectionId: selection.id,
    action: 'mark-export-ready',
  });
  assert.equal(preview.currentCount, 1);
  assert.ok(preview.warnings.includes('SELECTION_WATERMARK_EXCLUDES_LATER_ARRIVALS'));
});

test('saved views are private/shared, versioned, and account-scoped', () => {
  const view = store.createSavedView(context, {
    name: 'Processing orders',
    query: { filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' } },
    columns: ['orderNumber', 'grandTotalMinor'],
    pageSize: 25,
    visibility: 'shared',
  });
  assert.equal(store.listSavedViews(context).length, 1);
  assert.equal(store.listSavedViews(otherContext).length, 0);
  assert.throws(
    () => store.listSavedViews({ ...context, actorId: otherUserId }),
    /BULK_PERMISSION_DENIED/,
  );
  const updated = store.updateSavedView(context, view.id, {
    name: 'Processing orders v2',
    version: view.version,
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.name, 'Processing orders v2');
  assert.throws(
    () => store.updateSavedView(context, view.id, { version: 1 }),
    /SAVED_VIEW_VERSION_CONFLICT/,
  );
});

test('bulk jobs are idempotent and retry individual failures', () => {
  const selection = store.createSelection(context, {
    mode: 'explicit',
    orderIds: [orderA, orderB],
  });
  const first = store.createBulkJob(context, {
    selectionId: selection.id,
    action: 'mark-export-ready',
    idempotencyKey: 'export-ready-1',
  });
  const duplicate = store.createBulkJob(context, {
    selectionId: selection.id,
    action: 'mark-export-ready',
    idempotencyKey: 'export-ready-1',
  });
  assert.equal(duplicate.id, first.id);
  assert.equal(first.totalCount, 2);
  assert.equal(store.listBulkJobs(context, { status: 'queued' }).items.length, 1);
  assert.throws(
    () =>
      store.createBulkJob(context, {
        selectionId: selection.id,
        action: 'remote-update-order',
        idempotencyKey: 'forbidden',
      }),
    /BULK_ACTION_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      store.createBulkJob(context, {
        selectionId: selection.id,
        action: 'mark-export-ready',
        idempotencyKey: 'order-ids-in-job',
        parameters: { orderIds: [orderA] },
      }),
    /BULK_PARAMETERS_INVALID/,
  );
  assert.throws(() => store.getBulkJob(otherContext, first.id), /BULK_JOB_NOT_FOUND/);

  const claimedFirst = store.claimNextBulkItem(context, first.id);
  assert.ok(claimedFirst);
  assert.equal(claimedFirst.attemptCount, 1);
  store.completeBulkItem(context, first.id, claimedFirst.orderId, {
    success: false,
    error: 'temporary failure',
  });
  const claimedSecond = store.claimNextBulkItem(context, first.id);
  assert.ok(claimedSecond);
  store.completeBulkItem(context, first.id, claimedSecond.orderId, { success: true });
  assert.equal(store.getBulkJob(context, first.id).status, 'partial');
  assert.equal(store.listBulkFailures(context, first.id).items.length, 1);

  const retried = store.retryBulkFailures(context, first.id);
  assert.equal(retried.status, 'queued');
  const claimedRetry = store.claimNextBulkItem(context, first.id);
  assert.equal(claimedRetry.orderId, claimedFirst.orderId);
  assert.equal(claimedRetry.attemptCount, 2);
  store.completeBulkItem(context, first.id, claimedRetry.orderId, { success: true });
  const completed = store.getBulkJob(context, first.id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.progress, 100);
  assert.equal(completed.failedCount, 0);
});

test('query bulk jobs retain a small job payload and materialize items in bounded claims', () => {
  const selection = store.createSelection(context, {
    mode: 'query',
    query: { search: 'A-' },
  });
  const job = store.createBulkJob(context, {
    selectionId: selection.id,
    action: 'generate-invoice',
    parameters: { templateId: 'invoice-default' },
    idempotencyKey: 'invoice-query-1',
  });
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM bulk_job_items WHERE job_id = ?').get(job.id)
      .count,
    0,
  );
  assert.ok(
    store.db
      .prepare('SELECT LENGTH(parameters_json) AS size FROM bulk_jobs WHERE id = ?')
      .get(job.id).size <
      32 * 1024,
  );
  let item = store.claimNextBulkItem(context, job.id);
  while (item) {
    store.completeBulkItem(context, job.id, item.orderId, { success: true });
    item = store.claimNextBulkItem(context, job.id);
  }
  assert.equal(store.getBulkJob(context, job.id).status, 'succeeded');
});

test.after(() => {
  assert.equal(otherOrder.startsWith(`${otherAccountId}:`), true);
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
