import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { schemaVersion, SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-analytics-facts-'));
const store = new SqliteStore(join(directory, 'analytics.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const actorId = randomUUID();
const otherActorId = randomUUID();
const now = new Date().toISOString();
for (const [id, name] of [
  [accountId, 'Analytics account'],
  [otherAccountId, 'Other analytics account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account] of [
  [actorId, 'analytics@example.test', accountId],
  [otherActorId, 'other-analytics@example.test', otherAccountId],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'test-hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(account, id, 'admin', now);
}
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const otherContext = {
  accountId: otherAccountId,
  actorId: otherActorId,
  role: 'admin',
  correlationId: randomUUID(),
};

test('cost rules are effective-dated and analytics facts rebuild deterministically', () => {
  assert.equal(schemaVersion, 17);
  store.createCostRule(context, {
    scope: 'product',
    key: 'p1',
    currency: 'EGP',
    amountMinor: '500',
    source: 'supplier-a',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: '2026-07-01T00:00:00.000Z',
  });
  const currentRule = store.createCostRule(context, {
    scope: 'product',
    key: 'p1',
    currency: 'EGP',
    amountMinor: '700',
    source: 'supplier-b',
    effectiveFrom: '2026-07-01T00:00:00.000Z',
  });
  store.createCostRule(context, {
    scope: 'shipping',
    key: 'courier',
    currency: 'EGP',
    amountMinor: '150',
    source: 'carrier',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  store.createCostRule(context, {
    scope: 'payment',
    key: 'cod',
    currency: 'EGP',
    amountMinor: '40',
    source: 'gateway',
    effectiveFrom: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(currentRule.version, 2);
  assert.throws(
    () =>
      store.createCostRule(context, {
        scope: 'product',
        key: 'p1',
        currency: 'EGP',
        amountMinor: '900',
        source: 'overlap',
        effectiveFrom: '2026-08-01T00:00:00.000Z',
      }),
    /COST_RULE_DATE_OVERLAP/,
  );
  assert.equal(store.listCostRules(otherContext).length, 0);

  const order = store.createManualOrder(context, {
    currency: 'EGP',
    payment: { methodId: 'cod' },
    shippingMethod: { methodId: 'courier' },
    lines: [{ productId: 'p1', name: 'Tracked product', quantity: 2, unitPriceMinor: '1500' }],
    shippingCollectedMinor: '300',
    discountMinor: '100',
    taxMinor: '250',
  });
  const first = store.rebuildAnalyticsFacts(context, { source: 'manual' });
  assert.equal(first.ordersIncluded, 1);
  assert.equal(first.factsWritten, 1);
  assert.equal(first.snapshotsWritten, 1);
  const snapshots = store.listOrderCostSnapshots(context, String(order.id));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].ruleId, currentRule.id);
  assert.equal(snapshots[0].unitCostMinor, '700');
  const summary = store.getAnalyticsSummary(context, { source: 'manual' });
  assert.equal(summary.currencies.length, 1);
  assert.equal(summary.currencies[0].currency, 'EGP');
  assert.equal(summary.currencies[0].totals.cogsMinor, '1400');
  assert.equal(summary.currencies[0].totals.contributionProfitMinor, '1610');
  assert.equal(
    store.getAnalyticsSummary(context, { shippingMethod: 'courier' }).currencies.length,
    1,
  );
  assert.equal(store.getAnalyticsSummary(context, { product: 'p1' }).currencies.length, 1);
  assert.equal(store.getAnalyticsSummary(context, { status: 'new' }).currencies.length, 1);
  assert.equal(store.getAnalyticsBreakdown(context, { dimension: 'product' }).items[0].key, 'p1');
  assert.equal(store.getAnalyticsTimeseries(context, { source: 'manual' }).items.length, 1);
  assert.equal(
    store.getAnalyticsBreakdown(context, { source: 'manual', dimension: 'source' }).items[0].key,
    'manual',
  );
  const beforeSecond = store
    .listAnalyticsFacts(context, { source: 'manual' })
    .map(({ rebuiltAt, ...fact }) => fact);
  const second = store.rebuildAnalyticsFacts(context, { source: 'manual' });
  assert.equal(second.snapshotsWritten, 0);
  assert.deepEqual(
    beforeSecond,
    store.listAnalyticsFacts(context, { source: 'manual' }).map(({ rebuiltAt, ...fact }) => fact),
  );
  store.createManualOrder(context, {
    currency: 'USD',
    lines: [{ productId: 'p1', name: 'USD product', quantity: 1, unitPriceMinor: '2000' }],
  });
  store.rebuildAnalyticsFacts(context);
  const combined = store.getAnalyticsSummary(context);
  assert.deepEqual(
    combined.currencies.map(({ currency }) => currency),
    ['EGP', 'USD'],
  );
  assert.equal(store.getAnalyticsBreakdown(context, { dimension: 'source' }).items.length, 2);
  assert.equal(store.listAnalyticsFacts(otherContext).length, 0);
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
