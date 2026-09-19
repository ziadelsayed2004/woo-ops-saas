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

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe('031_master_data_account_links.sql', () => {
  let database;
  const migrationsDirectory = path.join(__dirname, '..');

  beforeEach(async () => {
    database = await openDatabase();
    for (const migration of [
      '001_initial_schema.sql',
      '005_outlet_users.sql',
      '022_unify_roles_and_archive_users.sql',
      '023_make_super_admin_assignable.sql',
      '027_invoice_role_visibility.sql',
      '028_granular_master_data_permissions.sql',
      '030_invoice_payment_operator.sql'
    ]) {
      await exec(database, fs.readFileSync(path.join(migrationsDirectory, migration), 'utf8'));
    }
    await exec(database, fs.readFileSync(
      path.join(migrationsDirectory, '031_master_data_account_links.sql'),
      'utf8'
    ));
  });

  afterEach(async () => close(database));

  test('adds account-link permissions to the assistant baseline', async () => {
    const rows = await all(database, `
      SELECT p.name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'assistant'
        AND p.name IN ('authors.account_link', 'outlets.account_link')
      ORDER BY p.name
    `);
    expect(rows.map(row => row.name)).toEqual([
      'authors.account_link',
      'outlets.account_link'
    ]);
  });

  test('is idempotent and leaves the new permissions configurable', async () => {
    const migration = fs.readFileSync(
      path.join(migrationsDirectory, '031_master_data_account_links.sql'),
      'utf8'
    );
    await exec(database, migration);
    const duplicates = await all(database, `
      SELECT role_id, permission_id, COUNT(*) AS count
      FROM role_permissions
      GROUP BY role_id, permission_id
      HAVING count > 1
    `);
    expect(duplicates).toHaveLength(0);

    const assistant = await all(database, `
      SELECT p.name
      FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = 'assistant' AND p.name = 'authors.account_link'
    `);
    expect(assistant).toHaveLength(1);
  });
});
