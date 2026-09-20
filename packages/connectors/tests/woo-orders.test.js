import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decimalToMinorUnits,
  decryptCredentialEnvelope,
  decryptSecretEnvelope,
  encryptCredentialEnvelope,
  encryptSecretEnvelope,
  normalizeWooOrder,
  WooCommerceConnector,
} from '../dist/index.js';

const fixture = {
  id: 42,
  number: '10042',
  status: 'processing',
  currency: 'EGP',
  total: '123.45',
  date_created_gmt: '2026-08-30T10:00:00Z',
  date_modified_gmt: '2026-08-30T10:05:00Z',
  billing: { first_name: 'Ali', email: 'ali@example.test' },
  shipping: { city: 'Zagazig', state: 'EGSHR' },
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
  meta_data: [{ id: 91, key: '_order_export_status', value: 'exported' }],
};

test('normalizes Woo order money, dates, lines, and refunds deterministically', () => {
  const normalized = normalizeWooOrder(fixture);
  assert.equal(decimalToMinorUnits('123.45'), '12345');
  assert.equal(normalized.grandTotalMinor, '12345');
  assert.equal(normalized.createdAt, '2026-08-30T10:00:00.000Z');
  assert.equal(normalized.lines[0].totalMinor, '11000');
  assert.equal(normalized.refunds[0].amountMinor, '-1000');
  assert.equal(normalized.remoteExportStatus, 'exported');
  assert.equal(normalized.remoteExportStatusKey, '_order_export_status');
  assert.equal(normalized.shipping.stateCode, 'EGSHR');
  assert.equal(normalized.shipping.governorateNameAr, 'الشرقية');
  assert.equal(normalized.amounts.collectedMinor, '11345');
  assert.equal(normalized.sourceHash, normalizeWooOrder(fixture).sourceHash);
});

test('never mistakes Paymob identifiers for a Woo export status', () => {
  const normalized = normalizeWooOrder({
    ...fixture,
    meta_data: [
      { id: 1, key: 'Paymob Merchant Order ID', value: '1799875497' },
      { id: 2, key: 'paymob_transaction_id', value: '538041195' },
    ],
  });
  assert.equal(normalized.remoteExportStatus, null);
  assert.equal(normalized.remoteExportStatusKey, null);
});

test('retains allowlisted export metadata when REST exposes it without using Paymob identifiers', () => {
  const normalized = normalizeWooOrder({
    ...fixture,
    meta_data: [
      { id: 1, key: 'Paymob Merchant Order ID', value: '1799875497' },
      { id: 2, key: '_wc_customer_order_csv_export_is_exported', value: true },
    ],
  });
  assert.equal(normalized.remoteExportStatus, 'true');
  assert.equal(normalized.remoteExportStatusKey, '_wc_customer_order_csv_export_is_exported');
});

test('pulls orders read-only and resumes at a requested page', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'secret',
    new URL('https://shop.example.test'),
    { key: 'ck', secret: 'cs' },
    async (url) => {
      calls.push(String(url));
      if (new URL(String(url)).pathname.endsWith('/woo-ops/export-status'))
        return new Response('{}', { status: 404 });
      return new Response(JSON.stringify([fixture]), {
        headers: { 'x-wp-totalpages': '2' },
      });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullRemote('orders', 50, 2)) pages.push(page);
  assert.equal(pages.length, 1);
  assert.match(calls[0], /orders\?page=2&per_page=50/);
  assert.match(calls[1], /woo-ops\/export-status\?ids=42/u);
  assert.equal(connector.capabilities.orders, true);
});

test('overlays protected export status from one bounded companion read per order page', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    '',
    new URL('https://shop.example.test'),
    { key: 'ck_read_only', secret: 'cs_read_only' },
    async (url, init) => {
      const parsed = new URL(String(url));
      calls.push({ url: parsed, init });
      if (parsed.pathname.endsWith('/woo-ops/export-status'))
        return new Response(
          JSON.stringify({
            version: 1,
            bridgeVersion: '1.4.0',
            items: [
              {
                id: 42,
                key: '_wc_customer_order_csv_export_is_exported',
                status: 'exported',
                source: 'legacy_meta',
              },
            ],
          }),
        );
      return new Response(JSON.stringify([fixture]), {
        headers: { 'x-wp-totalpages': '1' },
      });
    },
    async () => [{ address: '93.184.216.34' }],
  );

  const pages = [];
  for await (const page of connector.pullOrderPages('orders')) pages.push(page);
  const normalized = normalizeWooOrder(pages[0].items[0]);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].url.searchParams.get('ids'), '42');
  assert.equal(normalized.remoteExportStatus, 'exported');
  assert.equal(normalized.remoteExportStatusKey, '_wc_customer_order_csv_export_is_exported');
  assert.equal(normalized.remoteExportStatusSource, 'legacy_meta');
  assert.equal(normalized.remoteExportBridgeVersion, '1.4.0');
});

test('missing or malformed export-status companion leaves the standard Woo payload untouched', async () => {
  for (const companionResponse of [
    new Response('{}', { status: 404 }),
    new Response(JSON.stringify({ version: 1, items: [{ id: 42, status: 'maybe' }] })),
  ]) {
    const connector = new WooCommerceConnector(
      '',
      new URL('https://shop.example.test'),
      { key: 'ck_read_only', secret: 'cs_read_only' },
      async (url) =>
        new URL(String(url)).pathname.endsWith('/woo-ops/export-status')
          ? companionResponse.clone()
          : new Response(JSON.stringify([{ ...fixture, meta_data: [] }]), {
              headers: { 'x-wp-totalpages': '1' },
            }),
      async () => [{ address: '93.184.216.34' }],
    );
    const pages = [];
    for await (const page of connector.pullOrderPages('orders')) pages.push(page);
    const normalized = normalizeWooOrder(pages[0].items[0]);
    assert.equal(normalized.remoteExportStatus, null);
    assert.equal(normalized.remoteExportStatusKey, null);
  }
});

test('credential and webhook envelopes round-trip without exposing plaintext', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const credentials = { key: 'ck_read_only', secret: 'cs_read_only' };
  const credentialEnvelope = encryptCredentialEnvelope(credentials, encryptionKey);
  const webhookEnvelope = encryptSecretEnvelope('fixture-webhook-secret', encryptionKey);

  assert.equal(credentialEnvelope.algorithm, 'aes-256-gcm');
  assert.equal(JSON.stringify(credentialEnvelope).includes(credentials.secret), false);
  assert.deepEqual(decryptCredentialEnvelope(credentialEnvelope, encryptionKey), credentials);
  assert.equal(decryptSecretEnvelope(webhookEnvelope, encryptionKey), 'fixture-webhook-secret');
  assert.throws(
    () => decryptCredentialEnvelope(credentialEnvelope, Buffer.alloc(32, 8).toString('base64')),
    /CREDENTIAL_DECRYPTION_FAILED/,
  );
});

test('health and discovery use only authenticated GET requests and expose safe capabilities', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    'fixture-webhook-secret',
    new URL('https://shop.example.test/store'),
    { key: 'ck_read_only', secret: 'cs_read_only' },
    async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(
        JSON.stringify({ version: '9.9.0', environment: { wp_version: '6.8.1' } }),
      );
    },
    async () => [{ address: '93.184.216.34' }],
  );

  const health = await connector.healthCheck();
  const discovery = await connector.discover();
  assert.equal(health.status, 'healthy');
  assert.equal(health.platformVersion, '9.9.0');
  assert.equal(health.wordpressVersion, '6.8.1');
  assert.equal(discovery.apiBaseUrl, 'https://shop.example.test/wp-json/wc/v3');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.match(call.url, /\/wp-json\/wc\/v3\/system_status$/u);
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.redirect, 'manual');
  }
  assert.equal(typeof connector.createOrder, 'undefined');
  assert.equal(typeof connector.updateOrder, 'undefined');
});

test('paged order pulls retain total-page metadata and send bounded incremental filters', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    '',
    new URL('https://shop.example.test'),
    { key: 'ck_read_only', secret: 'cs_read_only' },
    async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify([fixture]), {
        headers: { 'x-wp-totalpages': '3' },
      });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullOrderPages('orders', 100, 2, {
    modifiedAfter: '2026-08-30T10:00:00.000Z',
    orderby: 'modified',
    order: 'asc',
  })) {
    pages.push(page);
    break;
  }
  assert.equal(pages[0].page, 2);
  assert.equal(pages[0].totalPages, 3);
  assert.match(calls[0], /page=2&per_page=100/u);
  assert.match(calls[0], /modified_after=2026-08-30T10%3A00%3A00.000Z/u);
  assert.match(calls[0], /orderby=modified/u);
  assert.match(calls[0], /order=asc/u);
});

test('empty Woo order collections accept the official zero-page header', async () => {
  let calls = 0;
  const connector = new WooCommerceConnector(
    '',
    new URL('https://shop.example.test'),
    { key: 'ck_read_only', secret: 'cs_read_only' },
    async () => {
      calls += 1;
      return new Response('[]', { headers: { 'x-wp-totalpages': '0' } });
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullOrderPages('orders')) pages.push(page);
  assert.equal(calls, 1);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].totalPages, 0);
  assert.deepEqual(pages[0].items, []);
});

test('missing pagination headers stop safely at the current order response', async () => {
  let calls = 0;
  const connector = new WooCommerceConnector(
    '',
    new URL('https://shop.example.test'),
    { key: 'ck_read_only', secret: 'cs_read_only' },
    async (url) => {
      calls += 1;
      if (new URL(String(url)).pathname.endsWith('/woo-ops/export-status'))
        return new Response('{}', { status: 404 });
      return new Response(JSON.stringify([fixture]));
    },
    async () => [{ address: '93.184.216.34' }],
  );
  const pages = [];
  for await (const page of connector.pullOrderPages('orders', 100, 3)) pages.push(page);
  assert.equal(calls, 2);
  assert.equal(pages[0].totalPages, 3);
});

test('malformed and contradictory Woo pagination headers fail visibly', async () => {
  for (const header of ['not-a-number', '1.5', '-1', '1']) {
    const connector = new WooCommerceConnector(
      '',
      new URL('https://shop.example.test'),
      { key: 'ck_read_only', secret: 'cs_read_only' },
      async () =>
        new Response(JSON.stringify([fixture]), { headers: { 'x-wp-totalpages': header } }),
      async () => [{ address: '93.184.216.34' }],
    );
    await assert.rejects(async () => {
      for await (const _page of connector.pullOrderPages('orders', 100, 2)) break;
    }, /WOO_SCHEMA_INVALID:pagination/u);
  }
});
