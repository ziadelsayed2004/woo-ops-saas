import assert from 'node:assert/strict';
import test from 'node:test';
import { decimalToMinorUnits, normalizeWooOrder, WooCommerceConnector } from '../dist/index.js';

const fixture = {
  id: 42,
  number: '10042',
  status: 'processing',
  currency: 'EGP',
  total: '123.45',
  date_created_gmt: '2026-08-30T10:00:00Z',
  date_modified_gmt: '2026-08-30T10:05:00Z',
  billing: { first_name: 'Ali', email: 'ali@example.test' },
  shipping: { city: 'Cairo' },
  line_items: [
    {
      id: 7,
      product_id: 9,
      variation_id: 10,
      sku: 'SKU-9',
      name: 'Item',
      quantity: 2,
      subtotal: '100.00',
      total: '110.00',
      total_tax: '13.45',
    },
  ],
  refunds: [{ id: 3, total: '-10.00', reason: 'returned' }],
};

test('normalizes Woo order money, dates, lines, and refunds deterministically', () => {
  const normalized = normalizeWooOrder(fixture);
  assert.equal(decimalToMinorUnits('123.45'), '12345');
  assert.equal(normalized.grandTotalMinor, '12345');
  assert.equal(normalized.createdAt, '2026-08-30T10:00:00.000Z');
  assert.equal(normalized.lines[0].totalMinor, '11000');
  assert.equal(normalized.refunds[0].amountMinor, '-1000');
  assert.equal(normalized.sourceHash, normalizeWooOrder(fixture).sourceHash);
});

test('pulls orders read-only and resumes at a requested page', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.test'),
    { key: 'ck', secret: 'cs' },
    async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(calls.length === 1 ? [fixture] : []), {
        headers: { 'x-wp-totalpages': '2' },
      });
    },
  );
  const pages = [];
  for await (const page of connector.pullRemote('orders', 50, 2)) pages.push(page);
  assert.equal(pages.length, 1);
  assert.match(calls[0], /orders\?page=2&per_page=50/);
  assert.equal(connector.capabilities.orders, true);
});
