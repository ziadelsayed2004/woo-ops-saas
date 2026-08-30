import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore, schemaVersion } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-export-state-'));
const store = new SqliteStore(join(directory, 'export-state.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const adminId = randomUUID();
const operatorId = randomUUID();
const otherActorId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
for (const [id, name] of [
  [accountId, 'State account'],
  [otherAccountId, 'Other account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account, role] of [
  [adminId, 'state-admin@example.test', accountId, 'admin'],
  [operatorId, 'state-operator@example.test', accountId, 'operator'],
  [otherActorId, 'state-other@example.test', otherAccountId, 'admin'],
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
    .run(account, id, role, now);
}
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://shop.example.test', 'connected', now, now);
const adminContext = { accountId, actorId: adminId, role: 'admin', correlationId: randomUUID() };
const operatorContext = {
  accountId,
  actorId: operatorId,
  role: 'operator',
  correlationId: randomUUID(),
};
const otherContext = {
  accountId: otherAccountId,
  actorId: otherActorId,
  role: 'admin',
  correlationId: randomUUID(),
};
const remote = {
  externalOrderId: 'woo-100',
  orderNumber: '100',
  remoteStatus: 'processing',
  currency: 'EGP',
  grandTotalMinor: '1500',
  createdAt: '2026-08-30T10:00:00.000Z',
  modifiedAt: '2026-08-30T10:00:00.000Z',
  customer: { name: 'Remote buyer' },
  billing: { phone: '0100' },
  shipping: { city: 'Cairo' },
  lines: [{ sku: 'SKU-1', quantity: 1 }],
  refunds: [],
  sourceJson: JSON.stringify({ id: 100, total: '15.00' }),
  sourceHash: '1'.repeat(64),
};
const orderId = store.upsertRemoteOrder(adminContext, connectionId, remote);
const selection = store.createSelection(adminContext, { mode: 'explicit', orderIds: [orderId] });
const profile = store.createExportProfile(adminContext, { name: 'State export' });
const version = store.createExportProfileVersion(adminContext, profile.id, {
  format: 'csv',
  rowMode: 'order',
  columns: [{ key: 'orderNumber', label: 'Order', type: 'text' }],
  filenameTemplate: 'state-{format}',
});

const completeBatch = (key) => {
  const batch = store.createExportBatch(adminContext, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: key,
  });
  store.completeExportBatch(adminContext, batch.id, {
    orderCount: 1,
    rowCount: 1,
    filename: `${key}.csv`,
    filePath: `exports/${key}.csv`,
    checksum: createHash('sha256').update(key).digest('hex'),
  });
  return batch.id;
};

test('successful batches derive local exported state and keep append-only history', () => {
  assert.equal(schemaVersion, 16);
  const batchId = completeBatch('state-1');
  assert.equal(
    store.recordExportedOrders(adminContext, batchId, [orderId], '2'.repeat(64)).recorded,
    1,
  );
  assert.equal(
    store.recordExportedOrders(adminContext, batchId, [orderId], '2'.repeat(64)).recorded,
    0,
  );
  assert.equal(store.getOrder(adminContext, orderId).exportState, 'exported');
  assert.equal(store.listOrderExportEvents(adminContext, orderId).length, 1);
  const secondBatchId = completeBatch('state-2');
  store.recordExportedOrders(adminContext, secondBatchId, [orderId], '3'.repeat(64));
  const events = store.listOrderExportEvents(adminContext, orderId);
  assert.equal(events.length, 2);
  assert.equal(events[0].batchId, secondBatchId);
  assert.equal(store.getExportBatch(adminContext, batchId).status, 'completed');
});

test('remote changes become visibly stale and a local re-export clears only local stale state', () => {
  store.upsertRemoteOrder(adminContext, connectionId, {
    ...remote,
    sourceJson: JSON.stringify({ id: 100, total: '17.00' }),
    sourceHash: '4'.repeat(64),
    modifiedAt: '2026-08-30T11:00:00.000Z',
    grandTotalMinor: '1700',
  });
  assert.equal(store.getOrder(adminContext, orderId).exportState, 'changed-after-export');
  assert.equal(
    store.queryOrders(adminContext, {
      filter: { field: 'exportState', operator: 'equals', value: 'changed-after-export' },
    }).items.length,
    1,
  );
  const batchId = completeBatch('state-3');
  store.recordExportedOrders(adminContext, batchId, [orderId]);
  assert.equal(store.getOrder(adminContext, orderId).exportState, 'exported');
  assert.equal(store.getOrder(adminContext, orderId).staleExportAt, null);
  assert.equal(store.listOrderExportEvents(adminContext, orderId).length, 3);
});

test('unexport requires admin permission, keeps history, and is local-only', () => {
  assert.throws(
    () => store.unexportOrder(operatorContext, orderId, 'Operator cannot unexport'),
    /EXPORT_UNEXPORT_PERMISSION_DENIED/,
  );
  const event = store.unexportOrder(adminContext, orderId, 'Customer cancelled shipment');
  assert.equal(event.type, 'unexported');
  assert.equal(event.batchId, null);
  assert.equal(event.reason, 'Customer cancelled shipment');
  assert.equal(store.getOrder(adminContext, orderId).exportState, 'never-exported');
  assert.equal(store.listOrderExportEvents(adminContext, orderId).length, 4);
  assert.throws(() => store.listOrderExportEvents(otherContext, orderId), /ORDER_NOT_FOUND/);
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
