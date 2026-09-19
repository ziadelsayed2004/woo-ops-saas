const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openMemoryDatabase() {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', error => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function createDbHelper(database) {
  return {
    exec(sql) {
      return new Promise((resolve, reject) => {
        database.exec(sql, error => error ? reject(error) : resolve());
      });
    },
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function onRun(error) {
          if (error) reject(error);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
      });
    }
  };
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe('rolesService fixed and assignable roles', () => {
  let database;
  let db;
  let rolesService;

  beforeEach(async () => {
    database = await openMemoryDatabase();
    db = createDbHelper(database);
    const migrations = path.join(__dirname, '..', '..', '..', 'db', 'migrations');
    await db.exec(fs.readFileSync(path.join(migrations, '001_initial_schema.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(migrations, '003_finance_ledger.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(migrations, '005_outlet_users.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(migrations, '011_returns_schema.sql'), 'utf8'));
    await db.exec(fs.readFileSync(
      path.join(migrations, '022_unify_roles_and_archive_users.sql'),
      'utf8'
    ));
    await db.exec(fs.readFileSync(
      path.join(migrations, '023_make_super_admin_assignable.sql'),
      'utf8'
    ));
    await db.exec(fs.readFileSync(
      path.join(migrations, '027_invoice_role_visibility.sql'),
      'utf8'
    ));
    await db.exec(fs.readFileSync(
      path.join(migrations, '028_granular_master_data_permissions.sql'),
      'utf8'
    ));
    await db.exec(fs.readFileSync(
      path.join(migrations, '029_invoice_trash.sql'),
      'utf8'
    ));
    await db.exec(fs.readFileSync(
      path.join(migrations, '030_invoice_payment_operator.sql'),
      'utf8'
    ));

    jest.resetModules();
    jest.doMock('../../../db', () => db);
    rolesService = require('../rolesService');
  });

  afterEach(async () => {
    jest.dontMock('../../../db');
    await close(database);
  });

  test('hides the internal owner and deprecated roles from the default list', async () => {
    const roles = await rolesService.getAllRoles();
    const names = roles.map(role => role.name);

    expect(names).toEqual(expect.arrayContaining([
      'super_admin', 'assistant', 'readonly_viewer', 'shipping_user',
      'inventory_manager', 'author', 'outlet'
    ]));
    expect(names).not.toContain('admin');
    expect(roles.every(role => typeof role.isSystem === 'boolean')).toBe(true);
  });

  test('rejects assignment of internal and deprecated roles', async () => {
    await expect(rolesService.getAssignableRolesByNames(['admin']))
      .rejects.toMatchObject({ statusCode: 400, code: 'ROLE_NOT_ASSIGNABLE' });

    const roles = await rolesService.getAssignableRolesByNames([
      'super_admin',
      'shipping_user',
      'inventory_manager'
    ]);
    expect(roles.map(role => role.name).sort()).toEqual([
      'inventory_manager',
      'shipping_user',
      'super_admin'
    ]);
  });

  test('requires the invoice payment operator role to be paired with assistant', async () => {
    await expect(rolesService.getAssignableRolesByNames(['invoice_payment_operator']))
      .rejects.toMatchObject({ statusCode: 400, code: 'ROLE_COMBINATION_INVALID' });

    const roles = await rolesService.getAssignableRolesByNames([
      'assistant',
      'invoice_payment_operator'
    ]);
    expect(roles.map(role => role.name).sort()).toEqual([
      'assistant',
      'invoice_payment_operator'
    ]);
  });

  test('keeps fixed system role matrices immutable', async () => {
    const shipping = await db.get("SELECT id FROM roles WHERE name = 'shipping_user'");
    const productsView = await db.get("SELECT id FROM permissions WHERE name = 'products.view'");

    await expect(rolesService.updateRolePermissions(shipping.id, [productsView.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'SYSTEM_ROLE_IMMUTABLE' });
    await expect(rolesService.updateRole(shipping.id, 'renamed', 'changed', []))
      .rejects.toMatchObject({ statusCode: 403, code: 'SYSTEM_ROLE_IMMUTABLE' });
    await expect(rolesService.deleteRole(shipping.id))
      .rejects.toMatchObject({ statusCode: 403, code: 'SYSTEM_ROLE_IMMUTABLE' });
  });

  test('allows granular master-data grants for assistant but blocks financial mutations', async () => {
    const assistant = await db.get("SELECT id FROM roles WHERE name = 'assistant'");
    const authorsDelete = await db.get("SELECT id FROM permissions WHERE name = 'authors.delete'");
    const invoicesPay = await db.get("SELECT id FROM permissions WHERE name = 'invoices.pay'");
    const paymentsCreate = await db.get("SELECT id FROM permissions WHERE name = 'payments.create'");
    const financeAdjust = await db.get("SELECT id FROM permissions WHERE name = 'finance.adjust'");

    await expect(rolesService.updateRolePermissions(assistant.id, [authorsDelete.id]))
      .resolves.toBeUndefined();
    await expect(rolesService.updateRolePermissions(assistant.id, [authorsDelete.id, invoicesPay.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'ASSISTANT_PERMISSION_FORBIDDEN' });
    await expect(rolesService.updateRolePermissions(assistant.id, [paymentsCreate.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'ASSISTANT_PERMISSION_FORBIDDEN' });
    await expect(rolesService.updateRolePermissions(assistant.id, [financeAdjust.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'ASSISTANT_PERMISSION_FORBIDDEN' });
  });

  test('allows safe custom roles but rejects owner-only mutation permissions', async () => {
    const productsView = await db.get("SELECT id FROM permissions WHERE name = 'products.view'");
    const usersCreate = await db.get("SELECT id FROM permissions WHERE name = 'users.create'");

    const custom = await rolesService.createRole('catalog_reader', 'Catalog reader', [productsView.id]);
    expect(custom).toMatchObject({
      name: 'catalog_reader',
      isSystem: false,
      isAssignable: true,
      isActive: true
    });
    await expect(rolesService.getAssignableRolesByNames(['catalog_reader']))
      .resolves.toHaveLength(1);

    await expect(rolesService.updateRolePermissions(custom.id, [usersCreate.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'PROTECTED_PERMISSION' });
    await expect(rolesService.createRole('unsafe_role', 'Unsafe', [usersCreate.id]))
      .rejects.toMatchObject({ statusCode: 403, code: 'PROTECTED_PERMISSION' });
  });
});
