import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateDailyFacts,
  calculateOrderMetrics,
  METRIC_DEFINITIONS,
  totalsFromFacts,
} from '../dist/index.js';

const rules = [
  {
    id: 'product-p1',
    scope: 'product',
    key: 'p1',
    currency: 'EGP',
    amountMinor: '500',
    source: 'supplier',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    version: 1,
    active: true,
  },
  {
    id: 'shipping-flat',
    scope: 'shipping',
    key: 'flat_rate',
    currency: 'EGP',
    amountMinor: '150',
    source: 'carrier-rate',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    version: 1,
    active: true,
  },
  {
    id: 'payment-cod',
    scope: 'payment',
    key: 'cod',
    currency: 'EGP',
    amountMinor: '40',
    source: 'payment-fee',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    version: 1,
    active: true,
  },
  {
    id: 'return-default',
    scope: 'return',
    key: '*',
    currency: 'EGP',
    amountMinor: '200',
    source: 'return-policy',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    version: 1,
    active: true,
  },
];
const order = {
  id: 'order-1',
  origin: 'woo',
  currency: 'EGP',
  remoteStatus: 'processing',
  createdAt: '2026-08-29T22:30:00.000Z',
  amounts: {
    merchandiseSubtotalMinor: '3000',
    discountMinor: '200',
    merchandiseNetMinor: '2800',
    shippingCollectedMinor: '300',
    taxMinor: '420',
    grandTotalMinor: '3520',
    collectedMinor: '3520',
  },
  lines: [{ lineId: 'line-1', productId: 'p1', quantity: 2, subtotalMinor: '3000' }],
  shippingMethod: { methodId: 'flat_rate' },
  payment: { methodId: 'cod' },
  shipping: { state: 'Cairo' },
  refunds: [{ amountMinor: '-500' }],
};

test('calculates explainable minor-unit metrics and immutable line costs', () => {
  const result = calculateOrderMetrics(order, rules);
  assert.equal(result.included, true);
  assert.deepEqual(result.totals, {
    grossSalesMinor: '3000',
    discountMinor: '200',
    netMerchandiseMinor: '2800',
    shippingCollectedMinor: '300',
    taxMinor: '420',
    refundsMinor: '500',
    collectedRevenueMinor: '3020',
    cogsMinor: '1000',
    actualShippingCostMinor: '150',
    paymentFeesMinor: '40',
    returnCostMinor: '200',
    contributionProfitMinor: '1210',
  });
  assert.deepEqual(result.lineSnapshots, [
    {
      lineId: 'line-1',
      ruleId: 'product-p1',
      source: 'supplier',
      effectiveAt: '2026-01-01T00:00:00.000Z',
      quantity: 2,
      unitCostMinor: '500',
      totalCostMinor: '1000',
    },
  ]);
  assert.equal(result.dimensions.remoteStatus, 'processing');
  assert.equal(result.dimensions.exportState, null);
  assert.equal(result.dimensions.governorate, 'Cairo');
  assert.equal(
    calculateOrderMetrics({ ...order, amounts: { ...order.amounts, collectedMinor: '0' } }, rules)
      .totals.collectedRevenueMinor,
    '3020',
  );
  assert.equal(
    calculateOrderMetrics({ ...order, remoteStatus: 'pending' }, rules).totals
      .collectedRevenueMinor,
    '0',
  );
});

test('excludes cancelled orders and keeps currencies in separate daily facts', () => {
  const cancelled = { ...order, id: 'cancelled', remoteStatus: 'cancelled' };
  const usd = { ...order, id: 'usd', currency: 'USD', amounts: { ...order.amounts } };
  const first = aggregateDailyFacts([order, usd, cancelled], rules, { timezone: 'Africa/Cairo' });
  const second = aggregateDailyFacts([cancelled, usd, order], rules, { timezone: 'Africa/Cairo' });
  assert.equal(first.excluded, 1);
  assert.equal(first.facts.length, 2);
  assert.deepEqual(first.facts, second.facts);
  assert.deepEqual(
    [...first.facts].map((fact) => [fact.currency, fact.date]),
    [
      ['EGP', '2026-08-30'],
      ['USD', '2026-08-30'],
    ],
  );
  assert.equal(totalsFromFacts(first.facts).cogsMinor, '1000');
});

test('reports formulas and does not apply a rule from another currency', () => {
  const result = calculateOrderMetrics(
    { ...order, currency: 'USD', amounts: { ...order.amounts } },
    rules,
  );
  assert.equal(result.totals.cogsMinor, '0');
  assert.equal(result.totals.actualShippingCostMinor, '0');
  assert.ok(METRIC_DEFINITIONS.every((definition) => definition.formula.length > 0));
});
