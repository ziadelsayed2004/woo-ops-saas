const bcrypt = require('bcrypt');
const dbHelper = require('../index');
const {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  SYSTEM_ROLE_NAMES,
  PROTECTED_PERMISSION_NAMES,
  getRolePermissions
} = require('../../modules/roles/roleCatalog');

async function synchronizeRoleCatalog() {
  await dbHelper.run("DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN ('shipments.deliver', 'outlet_types.manage'))");
  await dbHelper.run("DELETE FROM permissions WHERE name IN ('shipments.deliver', 'outlet_types.manage')");

  for (const permission of PERMISSIONS) {
    await dbHelper.run(
      'INSERT OR IGNORE INTO permissions (name, description) VALUES (?, ?)',
      [permission, `Permission to access ${permission}`]
    );
  }

  for (const [name, definition] of Object.entries(ROLE_DEFINITIONS)) {
    await dbHelper.run(
      'INSERT OR IGNORE INTO roles (name, description, is_system, is_assignable, is_active) VALUES (?, ?, ?, ?, ?)',
      [
        name,
        definition.description,
        definition.isSystem ? 1 : 0,
        definition.isAssignable ? 1 : 0,
        definition.isActive ? 1 : 0
      ]
    );
    await dbHelper.run(
      `UPDATE roles
       SET description = ?, is_system = ?, is_assignable = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
       WHERE name = ?`,
      [
        definition.description,
        definition.isSystem ? 1 : 0,
        definition.isAssignable ? 1 : 0,
        definition.isActive ? 1 : 0,
        name
      ]
    );
  }

  const permissions = await dbHelper.all('SELECT id, name FROM permissions');
  const roles = await dbHelper.all('SELECT id, name FROM roles');
  const permissionMap = new Map(permissions.map(permission => [permission.name, permission.id]));
  const roleMap = new Map(roles.map(role => [role.name, role.id]));

  for (const permissionName of PROTECTED_PERMISSION_NAMES) {
    const permissionId = permissionMap.get(permissionName);
    if (!permissionId) continue;
    await dbHelper.run(
      `DELETE FROM role_permissions
       WHERE permission_id = ?
         AND role_id IN (SELECT id FROM roles WHERE is_system = 0)`,
      [permissionId]
    );
  }

  for (const roleName of SYSTEM_ROLE_NAMES) {
    const roleId = roleMap.get(roleName);
    if (!roleId) continue;

    await dbHelper.run('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    const configuredPermissions = getRolePermissions(roleName);
    const permissionNames = configuredPermissions === '*'
      ? permissions.map(permission => permission.name)
      : configuredPermissions;

    for (const permissionName of permissionNames) {
      const permissionId = permissionMap.get(permissionName);
      if (!permissionId) {
        throw new Error(`Unknown permission '${permissionName}' configured for role '${roleName}'.`);
      }
      await dbHelper.run(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
        [roleId, permissionId]
      );
    }
  }

  return { roleMap };
}

async function seed() {
  const isTest = process.env.NODE_ENV === 'test';
  console.log(`--- Seeding Database (Mode: ${isTest ? 'TEST' : 'PRODUCTION FRESH'}) ---`);

  await dbHelper.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    console.log('Synchronizing permissions and fixed system roles...');
    const { roleMap } = await synchronizeRoleCatalog();

    console.log('Seeding super admin user...');
    const adminUsername = (process.env.SUPER_ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const adminPassword = process.env.SUPER_ADMIN_PASSWORD || '912Isk912';
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const userResult = await dbHelper.run(
      'INSERT OR IGNORE INTO users (username, password_hash, full_name, status) VALUES (?, ?, ?, ?)',
      [adminUsername, hashedPassword, 'System Administrator', 'active']
    );

    let userId = userResult.changes > 0 ? userResult.lastID : null;
    if (!userId) {
      const userRow = await dbHelper.get(
        'SELECT id FROM users WHERE username = ?',
        [adminUsername]
      );
      userId = userRow && userRow.id;
    }

    const superAdminRoleId = roleMap.get('super_admin');
    if (userId && superAdminRoleId) {
      await dbHelper.run(
        'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
        [userId, superAdminRoleId]
      );
    }

    await dbHelper.exec('COMMIT;');
    console.log('Seeding completed successfully. Environment setup verified.');
  } catch (error) {
    await dbHelper.exec('ROLLBACK;');
    throw error;
  }
}

module.exports = seed;
