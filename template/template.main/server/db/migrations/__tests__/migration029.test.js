const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const openDb = () => new Promise((resolve, reject) => {
  const database = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(database));
});
const exec = (database, sql) => new Promise((resolve, reject) => database.exec(sql, error => error ? reject(error) : resolve()));
const all = (database, sql) => new Promise((resolve, reject) => database.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
const close = database => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));

describe('029_invoice_trash.sql', () => {
  let database;

  beforeEach(async () => {
    database = await openDb();
    await exec(database, `
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE outlets (id INTEGER PRIMARY KEY);
      CREATE TABLE products (id INTEGER PRIMARY KEY);
      CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_number TEXT);
      CREATE TABLE invoice_payments (id INTEGER PRIMARY KEY, invoice_id INTEGER);
      CREATE TABLE returns (id INTEGER PRIMARY KEY, invoice_id INTEGER);
      CREATE TABLE finance_ledger_entries (
        id INTEGER PRIMARY KEY, reference_type TEXT, reference_id INTEGER, notes TEXT
      );
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT);
      CREATE TABLE role_permissions (
        role_id INTEGER,
        permission_id INTEGER,
        UNIQUE(role_id, permission_id)
      );
      INSERT INTO users VALUES (1);
      INSERT INTO outlets VALUES (2);
      INSERT INTO products VALUES (3);
      INSERT INTO roles VALUES (1, 'super_admin'), (2, 'assistant');
      INSERT INTO invoices VALUES (10, 'INV-10');
      INSERT INTO invoice_payments VALUES (20, 10);
      INSERT INTO returns VALUES (30, 10);
      INSERT INTO finance_ledger_entries VALUES
        (1, 'invoice', 10, NULL),
        (2, 'payment', 20, NULL),
        (3, 'return', 30, NULL),
        (4, 'payment', 999, 'Payment for invoice INV-10 recorded.'),
        (5, 'payment', 999, 'Payment marked as supplied.');
    `);
    const sql = fs.readFileSync(path.join(__dirname, '..', '029_invoice_trash.sql'), 'utf8');
    await exec(database, sql);
  });

  afterEach(async () => close(database));

  test('creates the trash storage and grants its permission only to super_admin', async () => {
    const tables = await all(database, `
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'invoice_trash%'
      ORDER BY name
    `);
    expect(tables.map(row => row.name)).toEqual(expect.arrayContaining([
      'invoice_trash',
      'invoice_trash_products',
      'invoice_trash_file_cleanup'
    ]));

    const grants = await all(database, `
      SELECT r.name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name = 'invoices.trash'
      ORDER BY r.name
    `);
    expect(grants).toEqual([{ name: 'super_admin' }]);
  });

  test('backfills invoice ownership for direct, payment, and return ledger entries', async () => {
    expect(await all(database, 'SELECT id, invoice_id FROM finance_ledger_entries ORDER BY id')).toEqual([
      { id: 1, invoice_id: 10 },
      { id: 2, invoice_id: 10 },
      { id: 3, invoice_id: 10 },
      { id: 4, invoice_id: 10 },
      { id: 5, invoice_id: 10 }
    ]);
  });

  test('retains outlet and product references required for restoration', async () => {
    await exec(database, `
      INSERT INTO invoice_trash (
        invoice_id, invoice_number, outlet_id, payment_status, shipping_status, snapshot_json, trashed_by
      ) VALUES (10, 'INV-10', 2, 'paid', 'shipped', '{}', 1);
      INSERT INTO invoice_trash_products (trash_id, product_id)
      VALUES ((SELECT id FROM invoice_trash WHERE invoice_id = 10), 3);
    `);

    await expect(exec(database, 'DELETE FROM outlets WHERE id = 2')).rejects.toThrow();
    await expect(exec(database, 'DELETE FROM products WHERE id = 3')).rejects.toThrow();
  });
});
