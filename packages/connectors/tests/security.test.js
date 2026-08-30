import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
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
