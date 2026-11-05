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
  assert.equal(schemaVersion, 26);
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

test('history pages reach older exports and deletion preserves export evidence and order state', () => {
  const created = [];
  for (let index = 0; index < 24; index++) {
    const batch = store.createExportBatch(context, {
      selectionId: selection.id,
      profileVersionId: version.id,
      idempotencyKey: `history-${index}`,
    });
    store.failExportBatch(context, batch.id, 'TEST_FAILURE');
    created.push(batch.id);
  }
  const all = [];
  let cursor;
  do {
    const page = store.listExportBatchPage(context, { limit: 7, ...(cursor ? { cursor } : {}) });
    all.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(all).size, all.length);
  for (const id of created) assert.ok(all.includes(id));
  assert.deepEqual(store.listExportBatchPage(otherContext).items, []);
  for (const input of [
    { limit: 101 },
    { limit: 0 },
    { cursor: '' },
    { cursor: 'broken' },
    { cursor: 'x'.repeat(1025) },
  ]) {
    assert.throws(
      () => store.listExportBatchPage(context, input),
      /EXPORT_BATCH_(LIMIT|CURSOR)_INVALID/,
    );
  }
  const completed = store.listExportBatches(context).find((item) => item.status === 'completed');
  assert.ok(completed);
  const beforeOrder = store.getOrder(context, order.id);
  const beforeEvents = store.listOrderExportEvents(context, order.id);
  const beforeSnapshots = store.db
    .prepare('SELECT * FROM export_batch_snapshots WHERE batch_id = ?')
    .all(completed.id);
  assert.throws(() => store.deleteExportBatchHistory(otherContext, completed.id), /NOT_FOUND/);
  store.db
    .prepare("UPDATE account_memberships SET role = 'viewer' WHERE account_id = ? AND user_id = ?")
    .run(accountId, actorId);
  assert.throws(
    () => store.deleteExportBatchHistory({ ...context, role: 'viewer' }, completed.id),
    /PERMISSION/,
  );
  store.db
    .prepare("UPDATE account_memberships SET role = 'admin' WHERE account_id = ? AND user_id = ?")
    .run(accountId, actorId);
  store.deleteExportBatchHistory(context, completed.id);
  store.deleteExportBatchHistory(context, completed.id);
  assert.equal(
    store.listExportBatches(context).some((batch) => batch.id === completed.id),
    false,
  );
  assert.deepEqual(store.getExportBatch(context, completed.id), completed);
  assert.deepEqual(store.getOrder(context, order.id), beforeOrder);
  assert.deepEqual(store.listOrderExportEvents(context, order.id), beforeEvents);
  assert.deepEqual(
    store.db.prepare('SELECT * FROM export_batch_snapshots WHERE batch_id = ?').all(completed.id),
    beforeSnapshots,
  );
  const repeated = store.createExportBatch(context, {
    selectionId: completed.selectionId,
    profileVersionId: completed.profileVersionId,
    idempotencyKey: completed.idempotencyKey,
  });
  assert.equal(repeated.id, completed.id);
  const active = store.createExportBatch(context, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: 'active-history',
  });
  assert.throws(() => store.deleteExportBatchHistory(context, active.id), /ACTIVE_CONFLICT/);
  store.startExportBatch(context, active.id);
  assert.throws(() => store.deleteExportBatchHistory(context, active.id), /ACTIVE_CONFLICT/);
});

test('schema 24 history upgrade retains existing rows and does not rewrite orders', () => {
  const path = join(directory, 'legacy.sqlite');
  let legacy = new SqliteStore(path);
  try {
    legacy.db
      .prepare('INSERT INTO accounts (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .run('legacy', 'Legacy', now, now);
    legacy.db
      .prepare(
        `INSERT INTO orders (id,account_id,origin,order_number,currency,grand_total_minor,created_at,updated_at,search_text,normalized_json)
      VALUES ('old-order','legacy','manual','MAN-1','EGP','100',?,?,'','{}')`,
      )
      .run(now, now);
    const before = legacy.db.prepare('SELECT * FROM orders').all();
    legacy.db.exec(
      'DROP INDEX export_batches_visible_history; ALTER TABLE export_batches DROP COLUMN history_deleted_at; DELETE FROM schema_migrations WHERE version = 25;',
    );
    legacy.db.close();
    legacy = new SqliteStore(path);
    assert.equal(legacy.db.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n, 26);
    assert.deepEqual(legacy.db.prepare('SELECT * FROM orders').all(), before);
  } finally {
    legacy.db.close();
  }
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
