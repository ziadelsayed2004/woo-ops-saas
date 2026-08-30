import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WooCommerceConnector,
  catalogIdentity,
  normalizeCatalogRecord,
  toCatalogItems,
} from '../dist/index.js';

const response = (body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'x-wp-totalpages': '2', ...headers },
  });

test('Woo product pages are validated, paginated, and normalized with deterministic variation identities', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'webhook-secret',
    new URL('https://shop.example.com'),
    { key: 'ck_read', secret: 'cs_read' },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return calls.length === 1
        ? response([
            { id: 10, name: 'Shoe', type: 'variable', variations: [{ id: 11, sku: 'S-11' }] },
          ])
        : response([], { 'x-wp-totalpages': '2' });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullCatalog('products')) pages.push(page);
  assert.equal(pages.length, 2);
  assert.equal(calls[0].url.includes('/wp-json/wc/v3/products?page=1'), true);
  const items = toCatalogItems(pages[0]);
  assert.equal(items.length, 2);
  assert.equal(items[1].identity, 'product:10:variation:11');
  assert.equal(
    catalogIdentity('products', { externalProductId: 10, externalVariationId: null }),
    'product:10:variation:base',
  );
});

test('Woo catalog schema and rate failures are classified', async () => {
  assert.throws(
    () => normalizeCatalogRecord('categories', { id: 'bad', name: 'x' }),
    /WOO_SCHEMA_INVALID/,
  );
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.com'),
    { key: 'k', secret: 's' },
    async () => new Response('{}', { status: 429 }),
    async () => [{ address: '93.184.216.34' }],
  );
  await assert.rejects(async () => {
    for await (const _page of connector.pullCatalog('products')) break;
  }, /WOO_RATE_LIMITED/);
});
