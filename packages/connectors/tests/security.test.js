import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalizeStoreUrl,
  assertPublicStoreUrl,
  validateWooOrder,
  verifyWebhookSignature,
  WooCommerceConnector,
} from '../dist/index.js';

const orderFixture = {
  id: 42,
  number: '10042',
  status: 'processing',
  currency: 'EGP',
  total: '123.45',
  line_items: [],
};
const publicResolver = async () => [{ address: '93.184.216.34' }];

test('store URL validation blocks private address ranges and unsafe origins', () => {
  for (const value of [
    'https://127.0.0.1',
    'https://10.0.0.7',
    'https://172.16.0.2',
    'https://192.168.1.20',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]',
    'https://[fc00::1]',
    'https://[::ffff:127.0.0.1]',
    'https://printer.internal',
    'https://user:password@shop.example.test',
    'https://shop.example.test:8443',
    'http://shop.example.test',
  ])
    assert.throws(() => canonicalizeStoreUrl(value), /CONNECTOR_/);
  assert.equal(
    canonicalizeStoreUrl('https://shop.example.test/store/').toString(),
    'https://shop.example.test/store',
  );
});

test('DNS resolution is checked before a public hostname is used', async () => {
  await assert.rejects(
    assertPublicStoreUrl(new URL('https://shop.example.test'), async () => [
      { address: '192.168.10.5' },
    ]),
    /CONNECTOR_PRIVATE_HOST/,
  );
});

test('connector requests are GET-only, do not follow redirects, and reject origin changes', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'webhook-secret',
    new URL('https://shop.example.test'),
    { key: 'ck_read', secret: 'cs_read' },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify([orderFixture]), {
        headers: { 'x-wp-totalpages': '1' },
      });
    },
    publicResolver,
  );
  const pages = [];
  for await (const page of connector.pullRemote('orders')) pages.push(page);
  assert.equal(pages.length, 1);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.redirect, 'manual');

  const redirectConnector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.test'),
    { key: 'ck_read', secret: 'cs_read' },
    async () => new Response(null, { status: 302, headers: { location: 'https://evil.test' } }),
    publicResolver,
  );
  await assert.rejects(
    (async () => {
      for await (const _page of redirectConnector.pullRemote('orders')) break;
    })(),
    /WOO_REDIRECT_BLOCKED/,
  );

  const originConnector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.test'),
    { key: 'ck_read', secret: 'cs_read' },
    async () => {
      const response = new Response(JSON.stringify([]), { headers: { 'x-wp-totalpages': '1' } });
      Object.defineProperty(response, 'url', { value: 'https://evil.test/orders' });
      return response;
    },
    publicResolver,
  );
  await assert.rejects(
    (async () => {
      for await (const _page of originConnector.pullRemote('orders')) break;
    })(),
    /WOO_ORIGIN_CHANGED/,
  );
});

test('connector retries Woo authentication for shared hosts that strip Authorization', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.test'),
    { key: 'ck_read', secret: 'cs_read' },
    async (url, init) => {
      calls.push({ url: new URL(String(url)), init });
      if (calls.length === 1) return new Response('{}', { status: 401 });
      if (new URL(String(url)).pathname.endsWith('/woo-ops/export-status'))
        return new Response('{}', { status: 404 });
      return new Response(JSON.stringify([orderFixture]), {
        status: 200,
        headers: { 'x-wp-totalpages': '1' },
      });
    },
    publicResolver,
  );

  for await (const _page of connector.pullRemote('orders')) break;

  assert.equal(calls.length, 3);
  assert.match(String(calls[0].init.headers.authorization), /^Basic /u);
  assert.equal(calls[0].url.searchParams.has('consumer_key'), false);
  assert.equal(calls[1].init.headers.authorization, undefined);
  assert.equal(calls[1].url.searchParams.get('consumer_key'), 'ck_read');
  assert.equal(calls[1].url.searchParams.get('consumer_secret'), 'cs_read');
  assert.equal(calls[1].init.redirect, 'manual');
  assert.equal(calls[2].init.method, 'GET');
  assert.equal(calls[2].url.pathname, '/wp-json/wc/v3/woo-ops/export-status');
});

test('the export-status companion integration is read-only and bounded', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    '',
    new URL('https://shop.example.test'),
    { key: 'ck_read', secret: 'cs_read' },
    async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init });
      if (parsed.pathname.endsWith('/woo-ops/export-status'))
        return new Response(JSON.stringify({ version: 1, items: [] }));
      return new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, index) => ({ ...orderFixture, id: index + 1 })),
        ),
        { headers: { 'x-wp-totalpages': '1' } },
      );
    },
    publicResolver,
  );

  for await (const _page of connector.pullOrderPages('orders')) break;

  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls[1].url.searchParams.get('ids').split(',').length, 100);
  assert.equal(typeof connector.createOrder, 'undefined');
  assert.equal(typeof connector.updateOrder, 'undefined');
});

test('the WordPress companion registers only an authenticated bounded read route', () => {
  const plugin = readFileSync(
    new URL(
      '../../../integrations/wordpress/woo-ops-export-status-bridge/woo-ops-export-status-bridge.php',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(plugin, /WP_REST_Server::READABLE/u);
  assert.match(plugin, /current_user_can\( 'manage_woocommerce' \)/u);
  assert.match(plugin, /current_user_can\( 'edit_shop_orders' \)/u);
  assert.match(plugin, /\{0,99\}/u);
  assert.match(plugin, /wc_export_is_order_exported/u);
  assert.match(plugin, /WOO_OPS_EXPORT_STATUS_GLOBAL_TERM = 'global'/u);
  assert.match(plugin, /taxonomy_exists\( WOO_OPS_EXPORT_STATUS_TAXONOMY \)/u);
  assert.match(plugin, /is_object_in_term\(/u);
  assert.match(plugin, /Taxonomies_Handler/u);
  assert.match(plugin, /is_order_exported_globally/u);
  assert.match(plugin, /'source'\s+=>\s+'extension_api'/u);
  assert.match(plugin, /get_post_meta\( \$order_id, WOO_OPS_EXPORT_STATUS_META_KEY, true \)/u);
  assert.match(plugin, /\(bool\) \$post_meta_value/u);
  assert.match(plugin, /\(bool\) \$order_meta_value/u);
  assert.match(plugin, /'bridgeVersion'\s+=>\s+'1\.5\.0'/u);
  assert.match(plugin, /_wc_customer_order_csv_export_is_exported/u);
  assert.match(plugin, /true === \$taxonomy_status/u);
  assert.doesNotMatch(plugin, /WP_REST_Server::(?:CREATABLE|EDITABLE|DELETABLE)/u);
  assert.doesNotMatch(
    plugin,
    /(?:update|add|delete)_post_meta|->save\s*\(|wp_delete_post|wc_create_order/u,
  );
  assert.doesNotMatch(plugin, /'postMetaValue'|'orderMetaValue'/u);
});

test('schema drift is quarantined and webhook signatures require strict base64', () => {
  assert.deepEqual(validateWooOrder(orderFixture).status, 'accepted');
  assert.deepEqual(validateWooOrder({ id: 42, number: '10042' }), {
    status: 'quarantined',
    reason: 'schema-drift',
  });
  const body = Buffer.from('{"id":42}');
  const signature = createHmac('sha256', 'secret').update(body).digest('base64');
  assert.equal(verifyWebhookSignature(body, signature, 'secret'), true);
  assert.equal(verifyWebhookSignature(body, signature.slice(0, -1), 'secret'), false);
  assert.equal(verifyWebhookSignature(body, signature, ''), false);
});
