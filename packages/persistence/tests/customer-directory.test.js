import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-customers-'));
const store = new SqliteStore(join(directory, 'customers.sqlite'));
const now = '2026-09-20T10:00:00.000Z';

const setup = (label) => {
  const accountId = randomUUID();
  const actorId = randomUUID();
  const connectionId = randomUUID();
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, label, now, now);
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(actorId, `${label}@example.test`, 'hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(accountId, actorId, 'admin', now);
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      connectionId,
      accountId,
      'woocommerce',
      `https://${label}.example.test`,
      'active',
      now,
      now,
    );
  return {
    context: { accountId, actorId, role: 'admin', correlationId: randomUUID() },
    connectionId,
  };
};

const first = setup('first');
const second = setup('second');
const order = (id, name, email, total, createdAt) => ({
  externalOrderId: id,
  orderNumber: id,
  remoteStatus: 'processing',
  externalCustomerId: '44',
  currency: 'EGP',
  grandTotalMinor: total,
  amounts: { grandTotalMinor: total, collectedMinor: total },
  createdAt,
  modifiedAt: createdAt,
  customer: { first_name: name, email, phone: '01000000000' },
  billing: {
    first_name: name,
    email,
    phone: '01000000000',
    address_1: '1 Main Street',
    city: 'Cairo',
  },
  shipping: { first_name: name, address_1: '2 Shipping Street', city: 'Giza' },
  lines: [],
  refunds: [],
  sourceJson: JSON.stringify({ id }),
  sourceHash: `hash-${id}`,
});

store.upsertRemoteOrder(first.context, first.connectionId, {
  ...order('1', 'Ahmed', 'ahmed@example.test', '10000', '2026-09-19T10:00:00.000Z'),
  lines: [{ productId: '101', name: 'Notebook', quantity: 1, unitPriceMinor: '10000' }],
});
store.upsertRemoteOrder(first.context, first.connectionId, {
  ...order('2', 'Ahmed', 'ahmed@example.test', '25000', now),
  lines: [{ productId: '202', name: 'Pen', quantity: 1, unitPriceMinor: '25000' }],
});
store.upsertRemoteOrder(second.context, second.connectionId, {
  ...order('3', 'Other secret', 'other@example.test', '99900', now),
  lines: [{ productId: '101', name: 'Notebook', quantity: 1, unitPriceMinor: '99900' }],
});

store.upsertRemoteOrder(first.context, first.connectionId, {
  ...order('4', 'Mona', 'mona@example.test', '8000', now),
  externalCustomerId: '45',
  lines: [{ productId: '202', name: 'Pen', quantity: 1, unitPriceMinor: '8000' }],
});

test('customer directory aggregates Woo identities, currencies and complete recent details', () => {
  const result = store.listWooCustomers(first.context, { search: 'ahmed', limit: 20 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].key, 'woo:44');
  assert.equal(result.items[0].orderCount, 2);
  assert.deepEqual(result.items[0].currencies, [
    { currency: 'EGP', orderCount: 2, totalSpendMinor: '35000' },
  ]);
  const profile = store.getWooCustomer(first.context, 'woo:44');
  assert.equal(profile.email, 'ahmed@example.test');
  assert.equal(profile.billing.address_1, '1 Main Street');
  assert.equal(profile.shipping.address_1, '2 Shipping Street');
  assert.equal(profile.recentOrders.length, 2);
});

test('product filter selects purchasing customers without shrinking lifetime totals or crossing accounts', () => {
  const notebook = store.listWooCustomers(first.context, { productId: '101', limit: 1 });
  assert.deepEqual(
    notebook.items.map((item) => item.key),
    ['woo:44'],
  );
  assert.equal(notebook.items[0].orderCount, 2);
  assert.deepEqual(notebook.items[0].currencies, [
    { currency: 'EGP', orderCount: 2, totalSpendMinor: '35000' },
  ]);
  assert.equal(notebook.nextCursor, null);

  const pen = store.listWooCustomers(first.context, { productId: '202', limit: 1 });
  assert.equal(pen.items.length, 1);
  assert.equal(pen.hasMore, true);
  const next = store.listWooCustomers(first.context, {
    productId: '202',
    limit: 1,
    cursor: pen.nextCursor,
  });
  assert.equal(next.items.length, 1);
  assert.notEqual(next.items[0].key, pen.items[0].key);
  assert.equal(next.hasMore, false);
  assert.equal(store.listWooCustomers(second.context, { productId: '202' }).items.length, 0);
  assert.equal(
    store.listWooCustomers(first.context, { productId: '101', search: 'Mona' }).items.length,
    0,
  );
});

test('customer directory never crosses account boundaries', () => {
  assert.equal(store.listWooCustomers(first.context, { search: 'Other secret' }).items.length, 0);
  assert.equal(store.getWooCustomer(second.context, 'woo:44').name, 'Other secret');
  assert.equal(store.getWooCustomer(first.context, 'email:other@example.test'), null);
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
