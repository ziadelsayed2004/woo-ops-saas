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

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
