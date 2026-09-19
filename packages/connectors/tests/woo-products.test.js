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

test('Woo catalog kinds use the official nested product endpoints', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.com'),
    { key: 'k', secret: 's' },
    async (url) => {
      calls.push(new URL(String(url)).pathname);
      return response([], { 'x-wp-totalpages': '1' });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  for (const kind of ['categories', 'tags', 'shipping_classes']) {
    for await (const _page of connector.pullCatalog(kind)) break;
  }
  assert.deepEqual(calls, [
    '/wp-json/wc/v3/products/categories',
    '/wp-json/wc/v3/products/tags',
    '/wp-json/wc/v3/products/shipping_classes',
  ]);
});

test('numeric Woo variation references are resolved read-only with price and stock facts', async () => {
  const methods = [];
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.com'),
    { key: 'k', secret: 's' },
    async (url, init) => {
      methods.push(init?.method);
      const value = String(url);
      if (value.includes('/products/10/variations'))
        return response(
          [{ id: 11, sku: 'S-11', price: '499.50', stock_status: 'instock', stock_quantity: 3 }],
          { 'x-wp-totalpages': '1' },
        );
      return response([{ id: 10, name: 'Shoe', type: 'variable', variations: [11] }], {
        'x-wp-totalpages': '1',
      });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullCatalog('products')) pages.push(page);
  const items = toCatalogItems(pages[0]);
  assert.equal(JSON.parse(items[1].sourceJson).price, '499.50');
  assert.deepEqual(methods, ['GET', 'GET']);
});

test('Woo shipping zones expose only explicit Egyptian state flat rates', async () => {
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.com'),
    { key: 'k', secret: 's' },
    async (url) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith('/shipping/zones'))
        return new Response(JSON.stringify([{ id: 2, name: 'Cairo zone' }]));
      if (path.endsWith('/shipping/zones/2/locations'))
        return new Response(
          JSON.stringify([
            { code: 'EG:C', type: 'state' },
            { code: 'EG:SHR', type: 'state' },
            { code: 'EG', type: 'country' },
          ]),
        );
      return new Response(
        JSON.stringify([
          {
            instance_id: 9,
            method_id: 'flat_rate',
            title: 'Standard delivery',
            enabled: true,
            settings: { cost: { value: '65.50' } },
          },
          {
            instance_id: 10,
            method_id: 'free_shipping',
            title: 'Free',
            enabled: true,
            settings: {},
          },
        ]),
      );
    },
    async () => [{ address: '93.184.216.34' }],
  );

  assert.deepEqual(await connector.readEgyptShippingRates(), [
    {
      zoneId: '2',
      methodId: '9',
      title: 'Standard delivery',
      stateCode: 'EGC',
      amountMinor: '6550',
      currency: 'EGP',
    },
    {
      zoneId: '2',
      methodId: '9',
      title: 'Standard delivery',
      stateCode: 'EGSHR',
      amountMinor: '6550',
      currency: 'EGP',
    },
  ]);
});
