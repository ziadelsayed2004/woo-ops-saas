import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-catalog-'));
const store = new SqliteStore(join(directory, 'catalog.sqlite'));
const accountId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Test', now, now);
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://shop.example.com', 'active', now, now);
const context = { accountId, correlationId: randomUUID() };

test('catalog pages upsert idempotently, expose safe read-only facts, and mark remote deletion', () => {
  const sourceJson = JSON.stringify({
    externalProductId: 10,
    name: 'Shoe',
    categories: [{ id: 4, name: 'Footwear' }],
    source: {
      id: 10,
      name: 'Shoe',
      price: '499.50',
      regular_price: '599.50',
      sale_price: '499.50',
      stock_status: 'instock',
      stock_quantity: 12,
      manage_stock: true,
      backorders: 'notify',
      backorders_allowed: true,
      backordered: false,
      catalog_visibility: 'visible',
      status: 'publish',
      type: 'simple',
    },
  });
  const item = {
    identity: 'product:10:variation:base',
    kind: 'product',
    externalId: '10',
    parentExternalId: null,
    name: 'Shoe',
    sku: 'S-10',
    sourceJson,
  };
  assert.deepEqual(
    store.upsertCatalogPage(context, {
      connectionId,
      cursor: 'products:2',
      items: [item],
      pages: 1,
    }),
    { insertedOrUpdated: 1 },
  );
  assert.deepEqual(
    store.upsertCatalogPage(context, {
      connectionId,
      cursor: 'products:2',
      items: [item],
      pages: 1,
    }),
    { insertedOrUpdated: 1 },
  );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM catalog_items').get().count, 1);
  assert.equal(
    store.db.prepare('SELECT catalog_cursor FROM connections WHERE id = ?').get(connectionId)
      .catalog_cursor,
    'products:2',
  );
  const listed = store.listCatalog(context, { kind: 'product', category: 'Footwear' });
  assert.equal(listed.totalCount, 1);
  assert.deepEqual(listed.items[0], {
    id: `${accountId}:${connectionId}:${item.identity}`,
    connectionId,
    kind: 'product',
    externalId: '10',
    parentExternalId: null,
    name: 'Shoe',
    sku: 'S-10',
    price: '499.50',
    regularPrice: '599.50',
    salePrice: '499.50',
    stockStatus: 'instock',
    stockQuantity: 12,
    manageStock: true,
    backorders: 'notify',
    backordersAllowed: true,
    backordered: false,
    catalogVisibility: 'visible',
    productStatus: 'publish',
    productType: 'simple',
    categories: [{ id: '4', name: 'Footwear' }],
  });
  assert.equal(store.listCatalog(context, { stockStatus: 'instock' }).totalCount, 1);
  assert.equal(store.listCatalog(context, { stockStatus: 'outofstock' }).totalCount, 0);
  assert.equal(store.listCatalog(context, { backorders: 'notify' }).totalCount, 1);
  assert.equal(store.listCatalog(context, { visibility: 'visible' }).totalCount, 1);
  assert.equal(
    store.markCatalogDeleted(context, connectionId, [
      `${accountId}:${connectionId}:${item.identity}`,
    ]),
    1,
  );
  assert.notEqual(
    store.db.prepare('SELECT remote_deleted_at FROM catalog_items').get().remote_deleted_at,
    null,
  );
  assert.equal(createHash('sha256').update(sourceJson).digest('hex').length, 64);
});

test('catalog category IDs intersect across product and inherited variation categories with scoped cursor pages', () => {
  const product = (externalId, name, categoryIds) => ({
    identity: `product:${externalId}:variation:base`,
    kind: 'product',
    externalId,
    parentExternalId: null,
    name,
    sku: null,
    sourceJson: JSON.stringify({
      categories: categoryIds.map((id) => ({ id: Number(id), name: `Category ${id}` })),
      source: { stock_status: 'instock' },
    }),
  });
  store.upsertCatalogPage(context, {
    connectionId,
    cursor: 'products:3',
    pages: 1,
    items: [
      product('20', 'Alpha', ['4', '5']),
      product('21', 'Beta', ['4']),
      product('22', 'Gamma', ['40', '5']),
      {
        identity: 'product:20:variation:23',
        kind: 'variation',
        externalId: '23',
        parentExternalId: '20',
        name: 'Alpha variation',
        sku: null,
        sourceJson: JSON.stringify({ id: 23, categories: [] }),
      },
    ],
  });
  const filter = { categoryIds: ['4', '5'], limit: 1 };
  const first = store.listCatalog(context, filter);
  assert.equal(first.totalCount, 2);
  assert.equal(first.items[0].name, 'Alpha');
  assert.equal(first.hasMore, true);
  const second = store.listCatalog(context, { ...filter, cursor: first.nextCursor });
  assert.equal(second.totalCount, 2);
  assert.equal(second.items[0].name, 'Alpha variation');
  assert.deepEqual(
    second.items[0].categories.map((item) => item.id),
    ['4', '5'],
  );
  assert.equal(second.hasMore, false);
  assert.deepEqual(
    store
      .listCatalog(context, { categoryIds: ['4'], kind: 'product' })
      .items.map((item) => item.name),
    ['Alpha', 'Beta'],
  );
  assert.equal(store.listCatalog(context, { categoryIds: ['4', '40'] }).totalCount, 0);
  assert.equal(
    store.listCatalog(context, { categoryIds: ['4', '5'], stockStatus: 'instock' }).totalCount,
    1,
  );
  assert.equal(
    store.listCatalog(context, { categoryIds: ['4', '5'], search: 'Beta' }).totalCount,
    0,
  );
  assert.equal(store.listCatalog(context, { categoryIds: [] }).totalCount, 4);
  assert.throws(
    () => store.listCatalog(context, { categoryIds: ['bad'] }),
    /CATALOG_CATEGORY_IDS_INVALID/u,
  );
  assert.throws(
    () => store.listCatalog(context, { categoryIds: Array.from({ length: 21 }, () => '4') }),
    /CATALOG_CATEGORY_IDS_INVALID/u,
  );

  const otherAccountId = randomUUID();
  const otherConnectionId = randomUUID();
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(otherAccountId, 'Other', now, now);
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      otherConnectionId,
      otherAccountId,
      'woocommerce',
      'https://other.example.com',
      'active',
      now,
      now,
    );
  const otherContext = { accountId: otherAccountId, correlationId: randomUUID() };
  store.upsertCatalogPage(otherContext, {
    connectionId: otherConnectionId,
    cursor: 'products:1',
    pages: 1,
    items: [product('20', 'Other Alpha', ['4', '5'])],
  });
  assert.equal(store.listCatalog(context, { categoryIds: ['4', '5'] }).totalCount, 2);
  assert.equal(store.listCatalog(otherContext, { categoryIds: ['4', '5'] }).totalCount, 1);
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
