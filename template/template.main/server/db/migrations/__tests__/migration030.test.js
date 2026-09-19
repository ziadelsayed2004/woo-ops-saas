const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const openDatabase = () => new Promise((resolve, reject) => {
  const database = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(database));
});
const exec = (database, sql) => new Promise((resolve, reject) => database.exec(sql, error => error ? reject(error) : resolve()));
const all = (database, sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const close = database => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve()));

describe('030_invoice_payment_operator.sql', () => {
  let database;
  const migrationsDirectory = path.join(__dirname, '..');

  beforeEach(async () => {
    database = await openDatabase();
    for (const migration of [
      '001_initial_schema.sql',
      '003_finance_ledger.sql',
      '005_outlet_users.sql',
      '011_returns_schema.sql',
      '022_unify_roles_and_archive_users.sql',
      '023_make_super_admin_assignable.sql',
      '027_invoice_role_visibility.sql',
      '028_granular_master_data_permissions.sql',
      '029_invoice_trash.sql'
    ]) {
      await exec(database, fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'));
    }
    await exec(database, fs.readFileSync(path.join(migrationsDirectory, '030_invoice_payment_operator.sql'), 'utf8'));
  });

  afterEach(async () => close(database));

  test('creates the fixed role with collection-only permissions', async () => {
    const role = await all(database, `
      SELECT name, is_system, is_assignable, is_active
      FROM roles WHERE name = 'invoice_payment_operator'
    `);
    expect(role).toEqual([{
      name: 'invoice_payment_operator',
      is_system: 1,
      is_assignable: 1,
      is_active: 1
    }]);

    const permissions = await all(database, `
      SELECT p.name
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      JOIN roles r ON r.id = rp.role_id
      WHERE r.name = 'invoice_payment_operator'
      ORDER BY p.name
    `);
    expect(permissions.map(row => row.name)).toEqual([
      'invoices.pay',
      'payments.create',
      'payments.receipt.upload',
      'payments.receipt.view',
      'payments.reverse',
      'payments.view'
    ]);
  });

  test('keeps receipt review and supply reversal owner-only', async () => {
    const grants = await all(database, `
      SELECT p.name, r.name AS role_name
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      JOIN roles r ON r.id = rp.role_id
      WHERE p.name IN ('payments.receipt.review', 'payments.supply.reverse')
      ORDER BY p.name, r.name
    `);
    expect(grants).toEqual([
      { name: 'payments.receipt.review', role_name: 'super_admin' },
      { name: 'payments.supply.reverse', role_name: 'super_admin' }
    ]);
  });
});
