const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', error => error ? reject(error) : resolve(database));
  });
}

function exec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe('028_granular_master_data_permissions.sql', () => {
  let database;
  const migrationsDirectory = path.join(__dirname, '..');

  beforeEach(async () => {
    database = await openDatabase();
    for (const migration of [
      '001_initial_schema.sql',
      '005_outlet_users.sql',
      '022_unify_roles_and_archive_users.sql',
      '023_make_super_admin_assignable.sql',
      '027_invoice_role_visibility.sql'
    ]) {
      await exec(database, fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'));
    }

    await exec(database, `
      INSERT INTO roles
        (name, description, is_system, is_assignable, is_active)
      VALUES ('legacy_catalog_editor', 'Legacy catalog editor', 0, 1, 1);

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.name = 'legacy_catalog_editor'
        AND p.name IN (
          'authors.update',
          'products.view', 'products.create', 'products.update', 'products.delete',
          'outlet_types.manage', 'outlets.update'
        );

      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.name = 'assistant'
        AND p.name IN ('invoices.pay', 'payments.create', 'finance.adjust');
    `);

    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '028_granular_master_data_permissions.sql'),
      'utf8'
    ));
  });

  afterEach(async () => close(database));

  async function permissionsFor(roleName) {
    const rows = await all(database, `
      SELECT p.name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = ?
      ORDER BY p.name
    `, [roleName]);
    return rows.map(row => row.name);
  }

  test('replaces legacy aggregate grants without reducing existing role access', async () => {
    const permissions = await permissionsFor('legacy_catalog_editor');

    expect(permissions).toEqual(expect.arrayContaining([
      'authors.delete',
      'categories.view', 'categories.create', 'categories.update', 'categories.delete',
      'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
      'outlets.delete'
    ]));
    expect(await get(database, "SELECT id FROM permissions WHERE name = 'outlet_types.manage'"))
      .toBeUndefined();
  });

  test('enables the complete assistant master-data baseline', async () => {
    const permissions = await permissionsFor('assistant');

    expect(permissions).toEqual(expect.arrayContaining([
      'authors.view', 'authors.create', 'authors.update', 'authors.delete',
      'products.view', 'products.create', 'products.update', 'products.delete',
      'categories.view', 'categories.create', 'categories.update', 'categories.delete',
      'product_prices.view', 'product_prices.update',
      'outlet_types.view', 'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
      'outlets.view', 'outlets.create', 'outlets.update', 'outlets.delete', 'outlets.disable'
    ]));
  });

  test('removes financial mutations from assistant while keeping them for the owner', async () => {
    const assistantPermissions = await permissionsFor('assistant');
    const ownerPermissions = await permissionsFor('super_admin');
    const financialMutations = [
      'invoices.pay',
      'payments.create', 'payments.reverse', 'payments.receipt.upload',
      'payments.mark_supplied', 'payments.supply_batch',
      'finance.adjust'
    ];

    for (const permission of financialMutations) {
      expect(assistantPermissions).not.toContain(permission);
      expect(ownerPermissions).toContain(permission);
    }
  });
});
