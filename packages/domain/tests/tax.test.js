import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateStoreTaxes,
  matchingTaxRates,
  taxAddress,
  validateStoreTaxPolicy,
} from '../dist/index.js';

const address = taxAddress({ country: 'EG', state: 'EGC', city: 'Cairo', postcode: '11511' });
const rate = (overrides = {}) => ({
  id: '1',
  country: 'EG',
  state: '',
  postcodes: [],
  cities: [],
  rate: '14.0000',
  name: 'VAT',
  priority: 1,
  order: 0,
  compound: false,
  shipping: true,
  taxClass: '',
  ...overrides,
});
const policy = (overrides = {}) => ({
  version: 1,
  enabled: true,
  currency: 'EGP',
  pricesIncludeTax: false,
  roundAtSubtotal: false,
  basedOn: 'shipping',
  shippingTaxClass: 'inherit',
  taxClasses: ['zero-rate'],
  base: address,
  rates: [rate()],
  ...overrides,
});
const input = (overrides = {}) => ({
  lines: [{ unitPriceMinor: '10000', quantity: 2, taxStatus: 'taxable', taxClass: '' }],
  billing: address,
  shipping: address,
  shippingMinor: '1000',
  shippingTaxable: true,
  discountMinor: '0',
  feesMinor: '0',
  ...overrides,
});

test('exclusive product and shipping taxes use integer minor units and net discounts', () => {
  const result = calculateStoreTaxes(policy(), input({ discountMinor: '1000' }));
  assert.equal(result.amounts.taxMinor, '2800');
  assert.equal(result.amounts.shippingTaxMinor, '140');
  assert.equal(result.amounts.grandTotalMinor, '22800');
  assert.equal(result.lines[0].totalMinor, '19000');
  assert.equal(result.taxLines[0].taxTotalMinor, '2660');
});

test('inclusive prices extract base tax and add shipping tax once', () => {
  const result = calculateStoreTaxes(
    policy({ pricesIncludeTax: true }),
    input({
      lines: [{ unitPriceMinor: '11400', quantity: 1, taxStatus: 'taxable', taxClass: '' }],
    }),
  );
  assert.equal(result.amounts.merchandiseSubtotalMinor, '10000');
  assert.equal(result.lines[0].unitPriceMinor, '10000');
  assert.equal(result.amounts.taxMinor, '1540');
  assert.equal(result.amounts.grandTotalMinor, '12540');
  const exemptDestination = calculateStoreTaxes(
    policy({ pricesIncludeTax: true, rates: [rate({ state: 'C' })] }),
    input({ shipping: { ...address, state: 'GZ' }, shippingMinor: '0' }),
  );
  assert.equal(exemptDestination.amounts.taxMinor, '0');
  assert.equal(exemptDestination.amounts.grandTotalMinor, '17544');
});

test('exempt, zero-rated, disabled taxes and nontaxable shipping remain zero', () => {
  const mixed = input({
    lines: [
      { unitPriceMinor: '10000', quantity: 1, taxStatus: 'none', taxClass: '' },
      { unitPriceMinor: '10000', quantity: 1, taxStatus: 'taxable', taxClass: 'zero-rate' },
    ],
    shippingTaxable: false,
  });
  assert.equal(
    calculateStoreTaxes(
      policy({ rates: [rate(), rate({ id: '2', taxClass: 'zero-rate', rate: '0' })] }),
      mixed,
    ).amounts.taxMinor,
    '0',
  );
  assert.equal(
    calculateStoreTaxes(policy({ enabled: false }), input()).amounts.grandTotalMinor,
    '21000',
  );
});

test('compound rates, rate priorities and subtotal rounding match Woo core examples', () => {
  const compound = policy({
    rates: [rate({ rate: '10' }), rate({ id: '2', rate: '5', priority: 2, compound: true })],
  });
  const price = input({
    shippingMinor: '0',
    lines: [{ unitPriceMinor: '10000', quantity: 1, taxStatus: 'taxable', taxClass: '' }],
  });
  assert.equal(calculateStoreTaxes(compound, price).amounts.grandTotalMinor, '11550');
  assert.equal(
    calculateStoreTaxes(
      { ...compound, pricesIncludeTax: true },
      { ...price, lines: [{ ...price.lines[0], unitPriceMinor: '11550' }] },
    ).amounts.grandTotalMinor,
    '11550',
  );
  const small = {
    ...price,
    lines: [
      { ...price.lines[0], unitPriceMinor: '5' },
      { ...price.lines[0], unitPriceMinor: '5' },
    ],
  };
  assert.equal(
    calculateStoreTaxes(policy({ rates: [rate({ rate: '10' })] }), small).amounts.taxMinor,
    '2',
  );
  assert.equal(
    calculateStoreTaxes(policy({ roundAtSubtotal: true, rates: [rate({ rate: '10' })] }), small)
      .amounts.taxMinor,
    '1',
  );
});

test('location, wildcard postcode, numeric range and one rate per priority are exact', () => {
  const configured = policy({
    rates: [
      rate({ id: '1', country: 'US' }),
      rate({ id: '2', state: 'C', postcodes: ['115*'], cities: ['CAIRO'] }),
      rate({ id: '3', priority: 2, postcodes: ['11000...12000'] }),
      rate({ id: '4', priority: 2, order: 1 }),
      rate({ id: '5', taxClass: 'zero-rate' }),
    ],
  });
  assert.deepEqual(
    matchingTaxRates(configured, address, '').map((item) => item.id),
    ['2', '3'],
  );
  assert.deepEqual(
    matchingTaxRates(configured, { ...address, state: 'GZ' }, '').map((item) => item.id),
    ['3'],
  );
  assert.throws(
    () => validateStoreTaxPolicy({ ...configured, rates: [rate({ rate: 'garbage' })] }),
    /STORE_TAX_POLICY_INVALID/,
  );
  assert.throws(
    () => calculateStoreTaxes(configured, input({ discountMinor: '999999' })),
    /MANUAL_ORDER_DISCOUNT_INVALID/,
  );
});

test('inclusive prices retain their gross total and a full discount never yields negative tax', () => {
  for (const unitPriceMinor of ['1', '5', '50', '99', '101', '335', '10001']) {
    const single = input({
      shippingMinor: '0',
      lines: [{ unitPriceMinor, quantity: 1, taxStatus: 'taxable', taxClass: '' }],
    });
    const included = policy({ pricesIncludeTax: true });
    const result = calculateStoreTaxes(included, single);
    assert.equal(result.amounts.grandTotalMinor, unitPriceMinor);
    const free = calculateStoreTaxes(included, {
      ...single,
      discountMinor: result.amounts.merchandiseSubtotalMinor,
    });
    assert.equal(free.amounts.grandTotalMinor, '0');
    assert.equal(free.amounts.taxMinor, '0');
  }
});

test('specific locations beat catch-all rates and shipping inherits the standard class first', () => {
  const configured = policy({
    rates: [
      rate({ id: '1', country: '', rate: '5' }),
      rate({ id: '2', state: 'C' }),
      rate({ id: '3', taxClass: 'zero-rate', rate: '0' }),
    ],
  });
  assert.deepEqual(
    matchingTaxRates(configured, address, '').map((item) => item.id),
    ['2'],
  );
  const mixed = calculateStoreTaxes(
    configured,
    input({
      lines: [
        { unitPriceMinor: '10000', quantity: 1, taxStatus: 'taxable', taxClass: 'zero-rate' },
        { unitPriceMinor: '10000', quantity: 1, taxStatus: 'shipping', taxClass: '' },
      ],
    }),
  );
  assert.equal(mixed.amounts.shippingTaxMinor, '140');
  assert.equal(mixed.amounts.taxMinor, '140');
});
