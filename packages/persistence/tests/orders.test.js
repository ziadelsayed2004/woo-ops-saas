import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-orders-'));
const store = new SqliteStore(join(directory, 'orders.sqlite'));
const accountId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Test', now, now);
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://shop.test', 'active', now, now);
const context = { accountId, correlationId: randomUUID() };
const order = {
  externalOrderId: '42',
  orderNumber: '10042',
  remoteStatus: 'processing',
  currency: 'EGP',
  grandTotalMinor: '12345',
  createdAt: now,
  modifiedAt: now,
  customer: {},
  billing: {},
  shipping: {},
  lines: [],
  refunds: [{ externalRefundId: '3', amountMinor: '-1000', reason: 'returned' }],
  sourceJson: '{"id":42}',
  sourceHash: 'hash-v1',
};

test('remote order upsert is idempotent and preserves local fields while marking stale exports', () => {
  const id = store.upsertRemoteOrder(context, connectionId, order);
  store.db
    .prepare("UPDATE orders SET local_status = 'packed', export_state = 'exported' WHERE id = ?")
    .run(id);
  store.upsertRemoteOrder(context, connectionId, {
    ...order,
    remoteStatus: 'completed',
    sourceHash: 'hash-v2',
    sourceJson: '{"id":42,"status":"completed"}',
  });
  const row = store.db
    .prepare(
      'SELECT remote_status, local_status, export_state, stale_export_at FROM orders WHERE id = ?',
    )
    .get(id);
  assert.equal(row.remote_status, 'completed');
  assert.equal(row.local_status, 'packed');
  assert.equal(row.export_state, 'exported');
  assert.notEqual(row.stale_export_at, null);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM order_refunds WHERE order_id = ?').get(id)
      .count,
    1,
  );
  store.upsertRemoteOrder(context, connectionId, order);
  assert.equal(
    store.db.prepare('SELECT COUNT(*) AS count FROM orders WHERE account_id = ?').get(accountId)
      .count,
    1,
  );
});

test('order details return normalized sections and stay account scoped', () => {
  const orderId = `${accountId}:${connectionId}:order:42`;
  const detail = store.getOrder(context, orderId);
  assert.equal(detail.id, orderId);
  assert.equal(detail.orderNumber, '10042');
  assert.deepEqual(detail.billing, {});
  assert.equal(Array.isArray(detail.lines), true);
  assert.equal(Array.isArray(detail.refunds), true);
  assert.equal(
    store.getOrder({ accountId: randomUUID(), correlationId: randomUUID() }, orderId),
    null,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
