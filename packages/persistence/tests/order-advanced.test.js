import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-order-advanced-'));
const store = new SqliteStore(join(directory, 'orders.sqlite'));
const accountId = randomUUID();
const actorId = randomUUID();
const connectionId = randomUUID();
const now = '2026-08-30T09:00:00.000Z';
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Advanced account', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'advanced@example.test', 'hash', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'admin', now);
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://advanced.test', 'active', now, now);

const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const input = {
  externalOrderId: '9001',
  orderNumber: '9001',
  remoteStatus: 'processing',
  createdVia: 'checkout',
  channel: 'online',
  posLocation: 'Cairo POS',
  externalCustomerId: 'customer-9',
  currency: 'EGP',
  grandTotalMinor: '125000',
  amounts: {
    merchandiseSubtotalMinor: '110000',
    discountMinor: '5000',
    merchandiseNetMinor: '105000',
    shippingCollectedMinor: '10000',
    taxMinor: '10000',
    feesMinor: '0',
    refundMinor: '25000',
    grandTotalMinor: '125000',
    collectedMinor: '125000',
  },
  createdAt: '2026-08-29T08:00:00.000Z',
  modifiedAt: now,
  customer: { name: 'Ahmed Ali', email: 'AHMED@EXAMPLE.TEST', phone: '01000000000' },
  billing: {
    first_name: 'Ahmed',
    last_name: 'Ali',
    email: 'AHMED@EXAMPLE.TEST',
    phone: '01000000000',
  },
  shipping: { city: 'Cairo' },
  payment: { methodId: 'cod', title: 'Cash on delivery', status: 'paid' },
  paymentMethodId: 'cod',
  paymentMethodTitle: 'Cash on delivery',
  paymentStatus: 'paid',
  shippingMethod: { methodId: 'flat_rate', title: 'Standard', carrier: 'DHL' },
  shippingMethodId: 'flat_rate',
  shippingMethodTitle: 'Standard',
  shippingCarrier: 'DHL',
  shippingCollectedMinor: '10000',
  lines: [
    {
      externalLineId: 'line-1',
      productId: 'product-1',
      variationId: 'variation-1',
      sku: 'SHIRT-01',
      name: 'Cotton shirt',
      quantity: 2,
      subtotalMinor: '110000',
      totalMinor: '105000',
      productSnapshot: { categories: ['shirts'], authors: ['brand-author'] },
    },
  ],
  refunds: [{ externalRefundId: 'refund-1', amountMinor: '-25000', reason: 'partial return' }],
  productIds: ['product-1'],
  variationIds: ['variation-1'],
  skus: ['SHIRT-01'],
  categories: ['shirts'],
  authors: ['brand-author'],
  tags: ['priority'],
  couponCodes: ['WELCOME'],
  metadata: [
    { key: 'api_key', value: 'secret-remote-value' },
    { key: 'delivery_note', value: 'Leave at reception' },
  ],
  sourceJson: JSON.stringify({ id: 9001, transaction_id: 'secret-transaction' }),
  sourceHash: 'advanced-source-v1',
};
const orderId = store.upsertRemoteOrder(context, connectionId, input);

test('canonical projection supports broad typed filters, total count and facets', () => {
  const result = store.queryOrders(context, {
    search: 'SHIRT-01',
    filter: {
      op: 'and',
      children: [
        { field: 'customerEmail', operator: 'equals', value: 'ahmed@example.test' },
        { field: 'product', operator: 'contains', value: 'product-1' },
        { field: 'productId', operator: 'contains-any', value: ['product-1'] },
        { field: 'paymentStatus', operator: 'equals', value: 'paid' },
        { field: 'shippingAmount', operator: 'greater-than', value: '5000' },
        { field: 'hasRefund', operator: 'is-true' },
      ],
    },
    sort: { field: 'remoteCreatedAt', direction: 'desc' },
  });
  assert.equal(result.totalCount, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].customerName, 'Ahmed Ali');
  assert.equal(result.items[0].refundState, 'partial');
  assert.equal(result.items[0].quantityTotal, 2);
  assert.equal(
    result.facets.find((facet) => facet.field === 'paymentStatus')?.values[0]?.value,
    'paid',
  );
  assert.equal(
    result.facets.find((facet) => facet.field === 'category')?.values[0]?.value,
    'shirts',
  );
});

test('order output separates private remote snapshots from canonical public facts', () => {
  const detail = store.getOrder(context, orderId);
  assert.equal(detail.sourceJson, undefined);
  assert.equal(detail.lines[0].source, undefined);
  assert.equal(detail.payment.transaction_id, undefined);
  assert.equal(detail.customerEmail, 'ahmed@example.test');
  assert.equal(detail.paymentMethodId, 'cod');
  assert.equal(detail.shippingCarrier, 'DHL');
  assert.deepEqual(detail.metadata, [{ key: 'delivery_note', value: 'Leave at reception' }]);
});

test('local workflow, tags, notes and resync are audited and never mutate remote facts', () => {
  const first = store.updateOrderLocalWorkflow(context, orderId, {
    version: 1,
    localStatus: 'ready-for-export',
  });
  assert.equal(first.localStatus, 'ready-for-export');
  assert.equal(first.remoteStatus, 'processing');
  const tagged = store.addOrderTag(context, orderId, { tag: 'packed', version: 2 });
  const noted = store.addOrderNote(context, orderId, { text: 'Call before delivery', version: 3 });
  assert.deepEqual(tagged.tags, ['packed']);
  assert.equal(noted.notesHistory.length, 1);
  const resync = store.enqueueOrderResync(context, orderId);
  assert.equal(resync.orderId, orderId);
  assert.equal(
    store.getWorkerJob({ accountId, correlationId: randomUUID() }, resync.jobId).type,
    'sync.incremental',
  );
  const timeline = store.listOrderTimeline(context, orderId);
  assert.ok(timeline.items.some((item) => item.eventType === 'workflow.updated'));
  assert.ok(timeline.items.some((item) => item.eventType === 'tag.added'));
  assert.ok(timeline.items.some((item) => item.eventType === 'note.added'));
  assert.ok(timeline.items.some((item) => item.eventType === 'resync.requested'));
  assert.throws(
    () => store.updateOrderLocalWorkflow(context, orderId, { version: 1, localStatus: 'bad' }),
    /ORDER_VERSION_CONFLICT/,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
