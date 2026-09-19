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

describe('024_remove_delivered_shipping_status.sql', () => {
  let db;

  beforeEach(async () => {
    db = await openDb();
    await exec(db, `
      PRAGMA foreign_keys = OFF;
      CREATE TABLE outlets (id INTEGER PRIMARY KEY);
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT UNIQUE NOT NULL,
        outlet_id INTEGER NOT NULL, subtotal REAL NOT NULL DEFAULT 0, discount REAL NOT NULL DEFAULT 0,
        shipping_cost REAL NOT NULL DEFAULT 0, total_price REAL NOT NULL DEFAULT 0,
        payment_status TEXT NOT NULL DEFAULT 'unpaid', shipping_status TEXT NOT NULL DEFAULT 'pending',
        payment_type TEXT NOT NULL DEFAULT 'cash', notes TEXT, created_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE shipments (
        id INTEGER PRIMARY KEY AUTOINCREMENT, shipment_number TEXT UNIQUE NOT NULL,
        invoice_id INTEGER NOT NULL, shipping_carrier TEXT, tracking_number TEXT,
        status TEXT NOT NULL DEFAULT 'pending', shipped_at DATETIME, delivered_at DATETIME,
        created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE invoice_status_history (
        id INTEGER PRIMARY KEY, invoice_id INTEGER, status_type TEXT, old_status TEXT, new_status TEXT
      );
      CREATE TABLE shipment_status_history (
        id INTEGER PRIMARY KEY, shipment_id INTEGER, old_status TEXT, new_status TEXT
      );
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER, UNIQUE(role_id, permission_id));
      INSERT INTO outlets VALUES (1);
      INSERT INTO users VALUES (1);
      INSERT INTO invoices (id, invoice_number, outlet_id, shipping_status) VALUES (10, 'INV-10', 1, 'delivered');
      INSERT INTO shipments (id, shipment_number, invoice_id, status, delivered_at) VALUES (20, 'SHP-20', 10, 'delivered', '2026-01-02');
      INSERT INTO invoice_status_history VALUES (1, 10, 'shipping', 'shipped', 'delivered');
      INSERT INTO shipment_status_history VALUES (1, 20, 'shipped', 'delivered');
      INSERT INTO roles VALUES (1, 'shipping_user');
      INSERT INTO permissions VALUES (1, 'invoices.ship'), (2, 'shipments.deliver');
      INSERT INTO role_permissions VALUES (1, 2);
    `);
  });

  afterEach(async () => close(db));

  test('migrates data, constraints and permissions to the three-state model', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '024_remove_delivered_shipping_status.sql'), 'utf8');
    await exec(db, sql);

    expect(await all(db, 'SELECT shipping_status FROM invoices')).toEqual([{ shipping_status: 'shipped' }]);
    expect(await all(db, 'SELECT status, shipped_at FROM shipments')).toEqual([{ status: 'shipped', shipped_at: '2026-01-02' }]);
    expect((await all(db, 'PRAGMA table_info(shipments)')).some(column => column.name === 'delivered_at')).toBe(false);
    await expect(exec(db, "UPDATE invoices SET shipping_status = 'delivered' WHERE id = 10")).rejects.toThrow();
    await expect(exec(db, "UPDATE shipments SET status = 'delivered' WHERE id = 20")).rejects.toThrow();

    const grants = await all(db, `
      SELECT p.name FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = 1 ORDER BY p.name
    `);
    expect(grants).toEqual([{ name: 'invoices.ship' }]);
    expect(await all(db, "SELECT name FROM permissions WHERE name = 'shipments.deliver'" )).toEqual([]);
  });
});
