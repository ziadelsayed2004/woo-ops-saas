import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore, schemaVersion } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-exports-'));
const store = new SqliteStore(join(directory, 'exports.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const actorId = randomUUID();
const otherActorId = randomUUID();
const now = new Date().toISOString();

for (const [id, name] of [
  [accountId, 'Export account'],
  [otherAccountId, 'Other export account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account] of [
  [actorId, 'export@example.test', accountId],
  [otherActorId, 'other-export@example.test', otherAccountId],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'test-hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(account, id, 'admin', now);
}
const context = { accountId, actorId, correlationId: randomUUID(), role: 'admin' };
const otherContext = {
  accountId: otherAccountId,
  actorId: otherActorId,
  correlationId: randomUUID(),
  role: 'admin',
};

const order = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'Export customer' },
  lines: [{ name: 'Export product', sku: '001', quantity: 1, unitPriceMinor: '1000' }],
});
const selection = store.createSelection(context, { mode: 'explicit', orderIds: [order.id] });
const profile = store.createExportProfile(context, { name: 'Courier sheet' });
const version = store.createExportProfileVersion(context, profile.id, {
  format: 'xlsx',
  rowMode: 'line',
  columns: [
    { key: 'orderNumber', label: 'Order', type: 'text' },
    { key: 'line.sku', label: 'SKU', type: 'text' },
  ],
  filenameTemplate: 'courier-{format}',
});

test('versioned export metadata is migrated and scoped to the account', () => {
  assert.equal(schemaVersion, 21);
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 0);
  assert.deepEqual(profile.active, true);
  assert.equal(version.version, 1);
  assert.equal(version.profileId, profile.id);
  assert.equal(store.listExportProfiles(otherContext).length, 0);
  assert.throws(
    () => store.getExportProfileVersion(otherContext, version.id),
    /EXPORT_PROFILE_VERSION_NOT_FOUND/,
  );
});

test('export batches pin selection watermark, are idempotent, and retain counts/checksum', () => {
  const first = store.createExportBatch(context, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: 'export-request-1',
  });
  const duplicate = store.createExportBatch(context, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: 'export-request-1',
  });
  assert.equal(duplicate.id, first.id);
  assert.equal(first.status, 'queued');
  assert.ok(first.jobId);
  assert.equal(first.snapshotOrderCount, 0);
  assert.equal(first.snapshotComplete, false);
  assert.equal(first.attemptCount, 0);
  assert.equal(first.watermark, selection.watermark);
  assert.equal(first.orderCount, 1);
  assert.equal(first.rowCount, 0);
  assert.equal(store.getJob(context, first.jobId).type, 'export.generate');
  const snapshotPage = store.materializeExportSnapshotPage(context, first.id);
  assert.equal(snapshotPage.hasMore, false);
  assert.equal(snapshotPage.orderCount, 1);
  assert.equal(snapshotPage.orderIds.length, 1);
  assert.ok(snapshotPage.snapshotHash);
  assert.equal(store.getExportBatch(context, first.id).snapshotOrderCount, 1);
  assert.equal(store.startExportBatch(context, first.id).status, 'running');
  const completed = store.completeExportBatch(context, first.id, {
    orderCount: 1,
    rowCount: 1,
    filename: 'courier.xlsx',
    filePath: 'exports/account/export-request-1.xlsx',
    checksum: 'a'.repeat(64),
    snapshotHash: first.snapshotHash,
    orderSnapshotHash: snapshotPage.snapshotHash,
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.checksum, 'a'.repeat(64));
  assert.equal(completed.rowCount, 1);
  assert.equal(completed.orderSnapshotHash, snapshotPage.snapshotHash);
  assert.equal(
    store.completeExportBatch(context, first.id, {
      orderCount: 1,
      rowCount: 1,
      filename: 'courier.xlsx',
      filePath: 'exports/account/export-request-1.xlsx',
      checksum: 'a'.repeat(64),
    }).id,
    first.id,
  );
  assert.throws(
    () =>
      store.createExportBatch(otherContext, {
        selectionId: selection.id,
        profileVersionId: version.id,
        idempotencyKey: 'other-request',
      }),
    /SELECTION_NOT_FOUND/,
  );
  assert.throws(() => store.deleteSelection(context, selection.id), /SELECTION_IN_USE/);
});

test('query export snapshots remain markable when current order fields no longer match', () => {
  const queryOrder = store.createManualOrder(context, {
    currency: 'EGP',
    customer: { name: 'Snapshot customer' },
    lines: [{ name: 'Snapshot product', quantity: 1, unitPriceMinor: '700' }],
  });
  const querySelection = store.createSelection(context, {
    mode: 'query',
    query: {
      search: queryOrder.orderNumber,
      filter: { field: 'localStatus', operator: 'equals', value: 'new' },
    },
  });
  const queryBatch = store.createExportBatch(context, {
    selectionId: querySelection.id,
    profileVersionId: version.id,
    idempotencyKey: 'query-export-snapshot',
  });
  const snapshotPage = store.materializeExportSnapshotPage(context, queryBatch.id);
  assert.deepEqual(snapshotPage.orderIds, [queryOrder.id]);
  store.startExportBatch(context, queryBatch.id);
  store.completeExportBatch(context, queryBatch.id, {
    orderCount: 1,
    rowCount: 1,
    filename: 'query-export.csv',
    filePath: 'exports/query-export.csv',
    checksum: 'b'.repeat(64),
    snapshotHash: queryBatch.snapshotHash,
    orderSnapshotHash: snapshotPage.snapshotHash,
  });
  store.updateManualOrder(context, queryOrder.id, { version: 1, localStatus: 'packed' });
  assert.equal(
    store.recordExportedOrders(context, queryBatch.id, [queryOrder.id], snapshotPage.snapshotHash)
      .recorded,
    1,
  );
  assert.equal(store.getOrder(context, queryOrder.id).exportState, 'exported');
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
