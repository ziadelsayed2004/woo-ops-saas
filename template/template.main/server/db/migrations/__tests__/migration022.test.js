const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const {
  getRolePermissions,
  ASSIGNABLE_SYSTEM_ROLE_NAMES,
  LEGACY_ROLE_NAMES
} = require('../../../modules/roles/roleCatalog');

function openMemoryDatabase() {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', error => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function exec(database, sql) {
  return new Promise((resolve, reject) => {
    database.exec(sql, error => error ? reject(error) : resolve());
  });
}

function run(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

function all(database, sql, params = []) {
  return new Promise((resolve, reject) => {
    database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
  });
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe('022_unify_roles_and_archive_users.sql', () => {
  let database;

  beforeEach(async () => {
    database = await openMemoryDatabase();
    const migrationsDirectory = path.join(__dirname, '..');
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '001_initial_schema.sql'),
      'utf8'
    ));
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '005_outlet_users.sql'),
      'utf8'
    ));

    await exec(database, `
      INSERT INTO roles (id, name, description) VALUES
        (1, 'inventory_manager', 'old inventory'),
        (2, 'shipping_user', 'old shipping'),
        (3, 'admin', 'old admin'),
        (4, 'custom_ops', 'custom role');
      INSERT INTO permissions (id, name) VALUES
        (1, 'products.update'),
        (2, 'invoices.view'),
        (3, 'users.create');
      INSERT INTO role_permissions (role_id, permission_id) VALUES
        (1, 1),
        (2, 2),
        (3, 1),
        (4, 2),
        (4, 3);

      INSERT INTO users (id, username, password_hash, full_name, status) VALUES
        (10, 'reusable', 'hash', 'Archived User', 'archived'),
        (11, 'legacy-only', 'hash', 'Legacy User', 'active'),
        (12, 'mixed-user', 'hash', 'Mixed User', 'active');
      INSERT INTO user_roles (user_id, role_id) VALUES
        (10, 1),
        (11, 3),
        (12, 3),
        (12, 4);

      INSERT INTO authors (id, name) VALUES (20, 'Linked Author');
      INSERT INTO author_users (author_id, user_id) VALUES (20, 10);
      INSERT INTO outlet_types (id, name) VALUES (30, 'Retail');
      INSERT INTO outlets (id, name, outlet_type_id, governorate) VALUES
        (40, 'Linked Outlet', 30, 'Cairo');
      INSERT INTO outlet_users (outlet_id, user_id) VALUES (40, 10);
    `);

    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '022_unify_roles_and_archive_users.sql'),
      'utf8'
    ));
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '027_invoice_role_visibility.sql'),
      'utf8'
    ));
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '028_granular_master_data_permissions.sql'),
      'utf8'
    ));
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '031_master_data_account_links.sql'),
      'utf8'
    ));
  });

  afterEach(async () => {
    await close(database);
  });

  test('adds role metadata and synchronizes each fixed role matrix', async () => {
    const roles = await all(database, `
      SELECT name, is_system, is_assignable, is_active
      FROM roles
      WHERE is_system = 1
      ORDER BY name ASC
    `);
    const byName = new Map(roles.map(role => [role.name, role]));

    // The invoice-payment capability role is introduced by migration 030,
    // after this migration's fixed-role synchronization contract.
    const expectedAssignable = ASSIGNABLE_SYSTEM_ROLE_NAMES
      .filter(name => !['super_admin', 'invoice_payment_operator'].includes(name));
    for (const roleName of expectedAssignable) {
      expect(byName.get(roleName)).toMatchObject({
        is_system: 1,
        is_assignable: 1,
        is_active: 1
      });
    }
    expect(byName.get('super_admin')).toMatchObject({
      is_system: 1,
      is_assignable: 0,
      is_active: 1
    });
    for (const roleName of LEGACY_ROLE_NAMES) {
      expect(byName.get(roleName)).toMatchObject({
        is_system: 1,
        is_assignable: 0,
        is_active: 0
      });
    }

    for (const roleName of ['assistant', 'readonly_viewer', 'shipping_user', 'inventory_manager', 'author', 'outlet']) {
      const grants = await all(database, `
        SELECT p.name
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        JOIN permissions p ON p.id = rp.permission_id
        WHERE r.name = ?
        ORDER BY p.name ASC
      `, [roleName]);
      expect(grants.map(grant => grant.name)).toEqual(
        [...getRolePermissions(roleName)].sort()
      );
    }

    for (const roleName of LEGACY_ROLE_NAMES) {
      const grant = await get(database, `
        SELECT COUNT(*) AS count
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        WHERE r.name = ?
      `, [roleName]);
      expect(grant.count).toBe(0);
    }
  });

  test('disables legacy-only accounts but preserves active custom-role users', async () => {
    expect((await get(database, 'SELECT status FROM users WHERE id = 11')).status).toBe('disabled');
    expect((await get(database, 'SELECT status FROM users WHERE id = 12')).status).toBe('active');
    expect(await get(database, `
      SELECT is_system, is_assignable, is_active
      FROM roles WHERE name = 'custom_ops'
    `)).toEqual({ is_system: 0, is_assignable: 1, is_active: 1 });
    expect(await all(database, `
      SELECT p.name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'custom_ops'
      ORDER BY p.name
    `)).toEqual([{ name: 'invoices.view' }]);
  });

  test('backfills terminal archive metadata, detaches links, and releases username', async () => {
    const archived = await get(database, `
      SELECT username, archived_username, archived_at, status
      FROM users WHERE id = 10
    `);
    expect(archived).toMatchObject({
      archived_username: 'reusable',
      status: 'archived'
    });
    expect(archived.username).toMatch(/^__archived__10__[a-f0-9]{32}$/);
    expect(archived.archived_at).toBeTruthy();

    for (const table of ['user_roles', 'author_users', 'outlet_users']) {
      const row = await get(database, `SELECT COUNT(*) AS count FROM ${table} WHERE user_id = 10`);
      expect(row.count).toBe(0);
    }

    const snapshot = await get(database, `
      SELECT details FROM audit_logs
      WHERE action = 'archive_user_migration_snapshot' AND target_id = '10'
    `);
    expect(JSON.parse(snapshot.details)).toMatchObject({
      originalUsername: 'reusable',
      roles: 'inventory_manager',
      authorIds: '20',
      outletIds: '40'
    });

    await expect(run(
      database,
      `INSERT INTO users (username, password_hash, full_name, status)
       VALUES ('reusable', 'new-hash', 'New User', 'active')`
    )).resolves.toMatchObject({ changes: 1 });
  });
});
