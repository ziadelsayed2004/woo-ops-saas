import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-query-'));
const store = new SqliteStore(join(directory, 'query.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
for (const id of [accountId, otherAccountId])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, id, now, now);
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://query.test', 'active', now, now);
const context = { accountId, correlationId: randomUUID() };
const makeOrder = (id, status, total) => ({
  externalOrderId: String(id),
  orderNumber: String(1000 + id),
  remoteStatus: status,
  currency: 'EGP',
  grandTotalMinor: String(total),
  createdAt: `2026-08-${String(id).padStart(2, '0')}T00:00:00.000Z`,
  modifiedAt: now,
  customer: { name: `Customer ${id}` },
  billing: {},
  shipping: { state: id === 1 ? 'Cairo' : 'Giza', city: id === 1 ? 'Nasr City' : 'Dokki' },
  lines: [],
  refunds: [],
  sourceJson: JSON.stringify({ id, status }),
  sourceHash: `hash-${id}`,
});
for (const order of [
  makeOrder(1, 'processing', 1000),
  makeOrder(2, 'completed', 2000),
  makeOrder(3, 'processing', 3000),
])
  store.upsertRemoteOrder(context, connectionId, order);

test('query uses typed AND/OR filters, search, and stable bounded cursors', () => {
  const first = store.queryOrders(context, {
    filter: {
      op: 'or',
      children: [
        { field: 'remoteStatus', operator: 'equals', value: 'processing' },
        { field: 'grandTotalMinor', operator: 'greater-than', value: '1500' },
      ],
    },
    limit: 2,
    sort: { field: 'orderNumber', direction: 'asc' },
  });
  assert.equal(first.items.length, 2);
  assert.equal(first.hasMore, true);
  const second = store.queryOrders(context, {
    cursor: first.nextCursor,
    limit: 2,
    sort: { field: 'orderNumber', direction: 'asc' },
  });
  assert.equal(second.items.length, 1);
  assert.equal(store.queryOrders(context, { search: '1002' }).items[0].orderNumber, '1002');
});

test('query rejects unsafe fields/operators and cannot cross account boundaries', () => {
  assert.equal(
    store.queryOrders({ accountId: otherAccountId, correlationId: randomUUID() }).items.length,
    0,
  );
  assert.throws(
    () =>
      store.queryOrders(context, {
        filter: { field: 'remote_status; DROP TABLE orders', operator: 'equals', value: 'x' },
      }),
    /ORDER_FILTER_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      store.queryOrders(context, {
        filter: { field: 'remoteStatus', operator: 'raw-sql', value: 'x' },
      }),
    /ORDER_FILTER_NOT_ALLOWED/,
  );
  assert.throws(
    () =>
      store.queryOrders(context, {
        filter: { field: 'remoteStatus', operator: 'equals', value: { $gt: 'x' } },
      }),
    /ORDER_FILTER_VALUE_INVALID/,
  );
  assert.throws(() => store.queryOrders(context, { limit: 101 }), /ORDER_LIMIT_INVALID/);
  assert.throws(
    () => store.queryOrders(context, { cursor: 'not-a-cursor' }),
    /ORDER_CURSOR_INVALID/,
  );
});

test('query filters orders by the normalized shipping governorate', () => {
  const cairo = store.queryOrders(context, {
    filter: { field: 'governorate', operator: 'contains', value: 'cairo' },
  });
  assert.deepEqual(
    cairo.items.map((item) => item.orderNumber),
    ['1001'],
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
