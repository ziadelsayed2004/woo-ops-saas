import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const store = new SqliteStore(':memory:');
const accountId = randomUUID();
const actorId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
const context = { accountId, actorId, role: 'owner', correlationId: randomUUID() };
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Tax fixture', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'tax@example.test', 'fixture', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'owner', now);
store.db
  .prepare(
    "INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, 'woocommerce', 'https://tax.example.test', 'active', ?, ?)",
  )
  .run(connectionId, accountId, now, now);
const policy = {
  version: 1,
  enabled: true,
  currency: 'EGP',
  pricesIncludeTax: false,
  roundAtSubtotal: false,
  basedOn: 'shipping',
  shippingTaxClass: 'inherit',
  taxClasses: [],
  base: { country: 'EG', state: 'C', city: '', postcode: '' },
  rates: [
    {
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
    },
  ],
};
store.upsertCatalogPage(context, {
  connectionId,
  cursor: 'complete',
  pages: 1,
  items: [
    {
      identity: 'product:10',
      kind: 'product',
      externalId: '10',
      name: 'Tax product',
      sku: 'P10',
      parentExternalId: null,
      sourceJson: JSON.stringify({
        source: {
          id: 10,
          name: 'Tax product',
          price: '100.00',
          tax_status: 'taxable',
          tax_class: '',
        },
      }),
    },
  ],
});
store.replaceWooShippingRates(context, connectionId, [
  {
    zoneId: '1',
    methodId: '5',
    title: 'Shipping',
    stateCode: 'EGC',
    amountMinor: '1000',
    currency: 'EGP',
    taxStatus: 'taxable',
  },
]);
const input = {
  currency: 'EGP',
  taxMode: 'store',
  shipping: { country: 'EG', state: 'EGC' },
  billing: { country: 'EG', state: 'EGC' },
  shippingMethod: { methodId: '5' },
  shippingCollectedMinor: '1000',
  taxMinor: '99999',
  lines: [
    {
      productId: '10',
      name: 'Tax product',
      unitPriceMinor: '10000',
      quantity: 1,
      taxMinor: '99999',
    },
  ],
};

test('manual tax preview and creation recalculate from account snapshots and reject forged totals', () => {
  assert.throws(() => store.previewManualOrderTaxes(context, input), /STORE_TAX_NOT_SYNCED/);
  store.replaceWooTaxPolicy(context, connectionId, policy);
  const preview = store.previewManualOrderTaxes(context, input);
  assert.equal(preview.amounts.taxMinor, '1540');
  assert.equal(preview.amounts.grandTotalMinor, '12540');
  const order = store.createManualOrder(context, {
    ...input,
    taxPolicyHash: preview.taxSnapshot.policyHash,
  });
  assert.equal(order.grandTotalMinor, '12540');
  assert.equal(order.amounts.taxMinor, '1540');
  assert.equal(order.lines[0].totalMinor, '10000');
  assert.equal(order.lines[0].taxMinor, '1400');
  assert.equal(order.taxSnapshot.policy.rates[0].rate, '14.0000');
  assert.equal(order.syncPolicy, 'never');
  assert.equal(order.inventoryPolicy, 'ignore');
  assert.throws(
    () => store.createManualOrder(context, { ...input, taxPolicyHash: '0'.repeat(64) }),
    /STORE_TAX_SETTINGS_CHANGED/,
  );
});

test('status updates preserve tax snapshots and previous totals after rates change', () => {
  const before = store.createManualOrder(context, input);
  store.replaceWooTaxPolicy(context, connectionId, {
    ...policy,
    rates: [{ ...policy.rates[0], rate: '20' }],
  });
  const after = store.updateManualOrder(context, before.id, {
    version: 1,
    localStatus: 'confirmed',
  });
  assert.deepEqual(after.amounts, before.amounts);
  assert.deepEqual(after.taxSnapshot, before.taxSnapshot);
  assert.deepEqual(after.lines, before.lines);
  const changed = store.updateManualOrder(context, before.id, {
    version: 2,
    lines: [{ ...input.lines[0], quantity: 2 }],
  });
  assert.equal(changed.amounts.taxMinor, '4200');
  assert.equal(changed.grandTotalMinor, '25200');
});

test('missing product or shipping facts, stale settings and tax sync failures are explicit', () => {
  assert.throws(
    () => store.createManualOrder(context, { ...input, shippingMethod: { methodId: 'other' } }),
    /STORE_TAX_SHIPPING_UNAVAILABLE/,
  );
  assert.throws(
    () =>
      store.previewManualOrderTaxes(context, {
        ...input,
        lines: [{ ...input.lines[0], productId: 'missing' }],
      }),
    /MANUAL_ORDER_CATALOG_ITEM_INVALID/,
  );
  store.db
    .prepare('UPDATE woo_tax_policies SET synced_at = ? WHERE account_id = ?')
    .run('2020-01-01T00:00:00Z', accountId);
  assert.throws(() => store.createManualOrder(context, input), /STORE_TAX_SETTINGS_STALE/);
  store.replaceWooTaxPolicy(context, connectionId, policy);
  store.recordWooTaxPolicyFailure(context, connectionId, 'WOO_HTTP_403');
  assert.equal(store.getWooTaxPolicy(context).error, 'WOO_HTTP_403');
  assert.throws(() => store.createManualOrder(context, input), /STORE_TAX_NOT_SYNCED/);
  assert.equal(
    store.getWooTaxPolicy({ accountId: randomUUID(), correlationId: 'other' }).policy,
    null,
  );
  assert.throws(
    () =>
      store.replaceWooTaxPolicy(
        { accountId: randomUUID(), correlationId: 'other' },
        connectionId,
        policy,
      ),
    /CONNECTION_NOT_FOUND/,
  );
});

test('variations inherit parent tax settings and exempt products do not get taxed', () => {
  store.replaceWooTaxPolicy(context, connectionId, policy);
  store.upsertCatalogPage(context, {
    connectionId,
    cursor: 'complete',
    pages: 1,
    items: [
      {
        identity: 'variation:11',
        kind: 'variation',
        externalId: '11',
        parentExternalId: '10',
        name: 'Variation',
        sourceJson: JSON.stringify({ source: { id: 11, price: '100.00', tax_class: 'parent' } }),
      },
      {
        identity: 'product:12',
        kind: 'product',
        externalId: '12',
        parentExternalId: null,
        name: 'Exempt',
        sourceJson: JSON.stringify({
          source: { id: 12, price: '100.00', tax_status: 'none', tax_class: '' },
        }),
      },
    ],
  });
  const inherited = store.previewManualOrderTaxes(context, {
    ...input,
    lines: [{ ...input.lines[0], variationId: '11' }],
  });
  assert.equal(inherited.lines[0].taxMinor, '1400');
  const exempt = store.previewManualOrderTaxes(context, {
    ...input,
    shippingCollectedMinor: '0',
    lines: [{ ...input.lines[0], productId: '12' }],
  });
  assert.equal(exempt.amounts.taxMinor, '0');
  assert.equal(exempt.amounts.grandTotalMinor, '10000');
});

test('inclusive catalog prices are stored net for invoices with the original pricing snapshot retained', () => {
  store.replaceWooTaxPolicy(context, connectionId, { ...policy, pricesIncludeTax: true });
  const order = store.createManualOrder(context, input);
  assert.equal(order.lines[0].unitPriceMinor, '8772');
  assert.equal(order.lines[0].totalMinor, '8772');
  assert.equal(order.amounts.taxMinor, '1368');
  assert.equal(order.grandTotalMinor, '11140');
  assert.equal(order.taxSnapshot.pricingInput.lines[0].unitPriceMinor, '10000');
  const confirmed = store.updateManualOrder(context, order.id, {
    version: 1,
    localStatus: 'confirmed',
  });
  assert.equal(confirmed.grandTotalMinor, '11140');
});

test('migration 23 upgrades a schema-22 database without changing existing orders', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-tax-migration-'));
  const path = join(directory, 'fixture.sqlite');
  let database = new SqliteStore(path);
  try {
    database.db
      .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(accountId, 'Legacy tax fixture', now, now);
    database.db
      .prepare(
        'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(actorId, 'legacy-tax@example.test', 'fixture', now, now);
    database.db
      .prepare(
        'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(accountId, actorId, 'owner', now);
    const legacy = database.createManualOrder(context, {
      currency: 'EGP',
      lines: [{ name: 'Historical product', quantity: 1, unitPriceMinor: '10000' }],
      taxMinor: '1234',
    });
    database.db.exec(
      'DROP TABLE woo_tax_policies; ALTER TABLE woo_shipping_rates DROP COLUMN tax_status; DELETE FROM schema_migrations WHERE version = 23;',
    );
    database.db.close();
    database = new SqliteStore(path);
    assert.equal(
      database.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version,
      23,
    );
    assert.ok(
      database.db
        .prepare('PRAGMA table_info(woo_shipping_rates)')
        .all()
        .some((column) => column.name === 'tax_status'),
    );
    assert.equal(database.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
    assert.equal(database.getOrder(context, legacy.id).grandTotalMinor, '11234');
    assert.deepEqual(database.getOrder(context, legacy.id).amounts, legacy.amounts);
  } finally {
    database.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('owner reset removes tax configuration and keeps the connection and previous order snapshots isolated', () => {
  store.resetAccountOperationalData(context);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM woo_tax_policies').get().count, 0);
  assert.equal(store.getWooTaxPolicy(context).policy, null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM connections').get().count, 1);
});

test.after(() => store.db.close());
