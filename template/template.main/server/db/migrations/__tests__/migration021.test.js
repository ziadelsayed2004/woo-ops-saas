const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openMemoryDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', error => {
      if (error) reject(error);
      else resolve(db);
    });
  });
}

function exec(db, sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function all(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, (error, rows) => {
      if (error) reject(error);
      else resolve(rows);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close(error => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('021_grant_invoice_view_to_inventory_and_shipping.sql', () => {
  let db;

  beforeEach(async () => {
    db = await openMemoryDatabase();
    await exec(db, `
      CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE permissions (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
      CREATE TABLE role_permissions (
        role_id INTEGER NOT NULL,
        permission_id INTEGER NOT NULL,
        UNIQUE(role_id, permission_id)
      );
      INSERT INTO roles (id, name) VALUES
        (1, 'inventory_manager'),
        (2, 'shipping_user'),
        (3, 'author');
      INSERT INTO permissions (id, name) VALUES
        (10, 'invoices.view'),
        (11, 'invoices.export');
      INSERT INTO role_permissions (role_id, permission_id) VALUES (1, 10);
    `);
  });

  afterEach(async () => {
    await close(db);
  });

  test('is idempotent and grants only invoices.view to the two intended roles', async () => {
    const migrationSql = fs.readFileSync(
      path.join(__dirname, '..', '021_grant_invoice_view_to_inventory_and_shipping.sql'),
      'utf8'
    );

    await exec(db, migrationSql);
    await exec(db, migrationSql);

    const grants = await all(db, `
      SELECT r.name AS role_name, p.name AS permission_name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.name, p.name
    `);

    expect(grants).toEqual([
      { role_name: 'inventory_manager', permission_name: 'invoices.view' },
      { role_name: 'shipping_user', permission_name: 'invoices.view' }
    ]);
  });
});
