const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const openDb = () => new Promise((resolve, reject) => {
  const db = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(db));
});
const exec = (db, sql) => new Promise((resolve, reject) => {
  db.exec(sql, error => error ? reject(error) : resolve());
});
const all = (db, sql) => new Promise((resolve, reject) => {
  db.all(sql, (error, rows) => error ? reject(error) : resolve(rows));
});
const close = db => new Promise((resolve, reject) => {
  db.close(error => error ? reject(error) : resolve());
});

describe('025_confirm_existing_pending_shipments.sql', () => {
  let db;

  beforeEach(async () => {
    db = await openDb();
    await exec(db, `
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY, payment_status TEXT, shipping_status TEXT,
        updated_at DATETIME
      );
      CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, quantity INTEGER);
      CREATE TABLE shipments (
        id INTEGER PRIMARY KEY, status TEXT, shipped_at DATETIME, created_at DATETIME,
        updated_at DATETIME, created_by INTEGER
      );
      CREATE TABLE shipment_items (shipment_id INTEGER, invoice_item_id INTEGER, quantity INTEGER);
      CREATE TABLE shipment_status_history (
        shipment_id INTEGER, old_status TEXT, new_status TEXT, changed_by INTEGER, notes TEXT
      );
      INSERT INTO invoices VALUES
        (1, 'unpaid', 'pending', NULL),
        (2, 'unpaid', 'pending', NULL),
        (3, 'unpaid', 'pending', NULL);
      INSERT INTO invoice_items VALUES (11, 1, 5), (21, 2, 5), (31, 3, 5);
      INSERT INTO shipments VALUES
        (101, 'pending', NULL, '2026-07-01', NULL, 7),
        (102, 'pending', NULL, '2026-07-02', NULL, 7);
      INSERT INTO shipment_items VALUES (101, 11, 2), (102, 21, 5);
    `);
  });

  afterEach(async () => close(db));

  test('confirms old item-bearing shipments and derives pending, partial and complete invoices', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '025_confirm_existing_pending_shipments.sql'), 'utf8');
    await exec(db, sql);

    expect(await all(db, 'SELECT id, status, shipped_at FROM shipments ORDER BY id')).toEqual([
      { id: 101, status: 'shipped', shipped_at: '2026-07-01' },
      { id: 102, status: 'shipped', shipped_at: '2026-07-02' }
    ]);
    expect(await all(db, 'SELECT id, shipping_status FROM invoices ORDER BY id')).toEqual([
      { id: 1, shipping_status: 'partially_shipped' },
      { id: 2, shipping_status: 'shipped' },
      { id: 3, shipping_status: 'pending' }
    ]);
    expect(await all(db, 'SELECT old_status, new_status FROM shipment_status_history ORDER BY shipment_id')).toEqual([
      { old_status: 'pending', new_status: 'shipped' },
      { old_status: 'pending', new_status: 'shipped' }
    ]);
  });
});
