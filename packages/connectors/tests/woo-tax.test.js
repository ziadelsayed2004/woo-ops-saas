import assert from 'node:assert/strict';
import test from 'node:test';
import { WooCommerceConnector } from '../dist/index.js';
const general = [
  ['woocommerce_calc_taxes', 'yes'],
  ['woocommerce_currency', 'EGP'],
  ['woocommerce_price_num_decimals', '2'],
  ['woocommerce_default_country', 'EG:C'],
  ['woocommerce_store_city', 'Cairo'],
  ['woocommerce_store_postcode', '11511'],
].map(([id, value]) => ({ id, value }));
const tax = [
  ['woocommerce_prices_include_tax', 'yes'],
  ['woocommerce_tax_round_at_subtotal', 'no'],
  ['woocommerce_tax_based_on', 'shipping'],
  ['woocommerce_shipping_tax_class', 'inherit'],
].map(([id, value]) => ({ id, value }));
const resolver = async () => [{ address: '8.8.8.8' }];
test('tax settings and classes are imported using bounded same-origin GET reads', async () => {
  const calls = [];
  const connector = new WooCommerceConnector(
    '',
    new URL('https://tax.example.test'),
    { key: 'read', secret: 'fixture' },
    async (url, init) => {
      assert.equal(init.method, 'GET');
      calls.push(String(url));
      const path = new URL(url).pathname;
      return Response.json(
        path.endsWith('/general')
          ? general
          : path.endsWith('/tax')
            ? tax
            : path.endsWith('/classes')
              ? [{ slug: 'zero-rate' }]
              : [
                  {
                    id: new URL(url).searchParams.get('class') === 'standard' ? 1 : 2,
                    country: 'EG',
                    state: '',
                    postcode: '115*;116*',
                    city: '',
                    rate: '14.0000',
                    name: 'VAT',
                    priority: 1,
                    order: 0,
                    compound: false,
                    shipping: true,
                    class: new URL(url).searchParams.get('class'),
                  },
                ],
      );
    },
    resolver,
  );
  const policy = await connector.readTaxPolicy();
  assert.equal(policy.pricesIncludeTax, true);
  assert.equal(policy.rates.length, 2);
  assert.deepEqual(policy.rates[0].postcodes, ['115*', '116*']);
  assert.equal(policy.rates[0].taxClass, '');
  assert.ok(calls.every((url) => url.startsWith('https://tax.example.test/wp-json/wc/v3/')));
});
test('tax-disabled settings are explicit and inaccessible or malformed settings fail visibly', async () => {
  const connector = (response) =>
    new WooCommerceConnector(
      '',
      new URL('https://tax.example.test'),
      { key: 'read', secret: 'fixture' },
      response,
      resolver,
    );
  assert.equal(
    (
      await connector(async () =>
        Response.json(
          general.map((item) =>
            item.id === 'woocommerce_calc_taxes' ? { ...item, value: 'no' } : item,
          ),
        ),
      ).readTaxPolicy()
    ).enabled,
    false,
  );
  await assert.rejects(
    () => connector(async () => Response.json({}, { status: 403 })).readTaxPolicy(),
    /WOO_HTTP_403/,
  );
  await assert.rejects(
    () => connector(async () => Response.json([])).readTaxPolicy(),
    /WOO_SCHEMA_INVALID:tax_enabled/,
  );
});
