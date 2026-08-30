import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-manual-orders-'));
const store = new SqliteStore(join(directory, 'manual.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const actorId = randomUUID();
const assigneeId = randomUUID();
const now = new Date().toISOString();
for (const [id, name] of [
  [accountId, 'Manual account'],
  [otherAccountId, 'Other account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account] of [
  [actorId, 'manual@example.test', accountId],
  [assigneeId, 'operator@example.test', accountId],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ',
    )
    .run(id, email, 'test-hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(account, id, id === actorId ? 'admin' : 'operator', now);
}
const context = { accountId, actorId, correlationId: randomUUID(), role: 'admin' };
const input = {
  currency: 'egp',
  customer: { first_name: 'عميل', last_name: 'تجريبي', email: 'customer@example.test' },
  billing: { address_1: 'Test street', city: 'Cairo' },
  shipping: { address_1: 'Delivery street', city: 'Giza' },
  payment: { method: 'cod', title: 'Cash on delivery' },
  shippingMethod: { methodId: 'flat_rate', title: 'Standard', collectedMinor: '1500' },
  lines: [
    {
      name: 'Test product',
      sku: 'SKU-1',
      quantity: 2,
      unitPriceMinor: '12500',
      discountMinor: '500',
      taxMinor: '250',
    },
  ],
  shippingCollectedMinor: '1500',
  taxMinor: '100',
  discountMinor: '300',
  feesMinor: '50',
  localStatus: 'processing',
  tags: ['manual', 'priority'],
  notes: 'Call before delivery',
  assigneeId,
};

test('manual orders use local invariants, sequence numbers, and common queries', () => {
  const order = store.createManualOrder(context, input);
  assert.equal(order.origin, 'manual');
  assert.equal(order.orderNumber, 'MAN-000001');
  assert.equal(order.syncPolicy, 'never');
  assert.equal(order.inventoryPolicy, 'ignore');
  assert.equal(order.connectionId, null);
  assert.equal(order.externalOrderId, null);
  assert.equal(order.currency, 'EGP');
  assert.equal(order.grandTotalMinor, '26100');
  assert.deepEqual(order.tags, ['manual', 'priority']);
  assert.equal(order.assigneeId, assigneeId);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM connections').get().count, 0);
  const result = store.queryOrders(context, {
    filter: { field: 'origin', operator: 'equals', value: 'manual' },
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, order.id);
});

test('manual updates remain local and mark an exported/documented order stale', () => {
  const orderId = store.queryOrders(context).items[0].id;
  store.db
    .prepare("UPDATE orders SET export_state = 'exported' WHERE account_id = ? AND id = ?")
    .run(accountId, orderId);
  const updated = store.updateManualOrder(context, orderId, {
    version: 1,
    localStatus: 'packed',
    notes: 'Customer confirmed address',
    tags: ['manual', 'packed'],
  });
  assert.equal(updated.localStatus, 'packed');
  assert.equal(updated.exportState, 'changed-after-export');
  assert.equal(updated.version, 2);
  assert.equal(typeof updated.staleExportAt, 'string');
  assert.equal(updated.syncPolicy, 'never');
  assert.equal(updated.inventoryPolicy, 'ignore');
  assert.equal(Array.isArray(updated.notesHistory), true);
  assert.equal(updated.notesHistory.length, 2);
  assert.throws(
    () => store.updateManualOrder(context, orderId, { version: 1, localStatus: 'new' }),
    /MANUAL_ORDER_VERSION_CONFLICT/,
  );
});

test('manual order writes validate account membership and never cross account boundaries', () => {
  assert.equal(
    store.getOrder({ accountId: otherAccountId, actorId, correlationId: randomUUID() }, 'missing'),
    null,
  );
  assert.throws(
    () =>
      store.createManualOrder(context, {
        ...input,
        lines: [{ ...input.lines[0], discountMinor: '999999' }],
      }),
    /MANUAL_ORDER_DISCOUNT_INVALID/,
  );
  assert.throws(
    () => store.createManualOrder(context, { ...input, assigneeId: randomUUID() }),
    /MANUAL_ORDER_ASSIGNEE_INVALID/,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
