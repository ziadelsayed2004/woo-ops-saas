const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const openDb = () => new Promise((resolve, reject) => {
  const database = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(database));
});
const exec = (database, sql) => new Promise((resolve, reject) => database.exec(sql, error => error ? reject(error) : resolve()));
const all = (database, sql) => new Promise((resolve, reject) => database.all(sql, (error, rows) => error ? reject(error) : resolve(rows)));
const close = database => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));

describe('026_invoice_archive.sql', () => {
  let database;

  beforeEach(async () => {
    database = await openDb();
    await exec(database, `
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE invoices (id INTEGER PRIMARY KEY, updated_at DATETIME);
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE);
      CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT);
      CREATE TABLE role_permissions (role_id INTEGER, permission_id INTEGER, UNIQUE(role_id, permission_id));
      INSERT INTO users VALUES (1);
      INSERT INTO invoices VALUES (10, NULL);
      INSERT INTO roles VALUES (1, 'super_admin'), (2, 'assistant'), (3, 'shipping_user');
    `);
  });

  afterEach(async () => close(database));

  test('adds archive metadata and grants the permission only to administrative roles', async () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '026_invoice_archive.sql'), 'utf8');
    await exec(database, sql);

    const columns = await all(database, 'PRAGMA table_info(invoices)');
    expect(columns.map(column => column.name)).toEqual(expect.arrayContaining(['archived_at', 'archived_by']));
    expect(await all(database, `
      SELECT r.name FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE p.name = 'invoices.archive' ORDER BY r.name
    `)).toEqual([{ name: 'assistant' }, { name: 'super_admin' }]);
  });
});
