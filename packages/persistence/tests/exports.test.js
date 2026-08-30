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
const otherContext = { accountId: otherAccountId, actorId: otherActorId, correlationId: randomUUID(), role: 'admin' };

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
  assert.equal(schemaVersion, 12);
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
  assert.equal(first.watermark, selection.watermark);
  assert.equal(first.orderCount, 1);
  assert.equal(first.rowCount, 0);
  assert.equal(store.startExportBatch(context, first.id).status, 'running');
  const completed = store.completeExportBatch(context, first.id, {
    orderCount: 1,
    rowCount: 1,
    filename: 'courier.xlsx',
    filePath: 'exports/account/export-request-1.xlsx',
    checksum: 'a'.repeat(64),
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.checksum, 'a'.repeat(64));
  assert.equal(completed.rowCount, 1);
  assert.equal(store.completeExportBatch(context, first.id, {
    orderCount: 1,
    rowCount: 1,
    filename: 'courier.xlsx',
    filePath: 'exports/account/export-request-1.xlsx',
    checksum: 'a'.repeat(64),
  }).id, first.id);
  assert.throws(
    () => store.createExportBatch(otherContext, {
      selectionId: selection.id,
      profileVersionId: version.id,
      idempotencyKey: 'other-request',
    }),
    /SELECTION_NOT_FOUND/,
  );
  assert.throws(() => store.deleteSelection(context, selection.id), /SELECTION_IN_USE/);
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
