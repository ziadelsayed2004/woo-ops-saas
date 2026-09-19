const db = require('../../db');
const {
  PROTECTED_PERMISSION_SET,
  ASSISTANT_FORBIDDEN_PERMISSION_SET,
  SYSTEM_ROLE_SET,
  validateRoleCombination
} = require('./roleCatalog');

class RoleServiceError extends Error {
  constructor(message, statusCode = 400, code = 'ROLE_ERROR') {
    super(message);
    this.name = 'RoleServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeRoleName(name) {
  return String(name || '').trim();
}

function mapRole(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    isSystem: Boolean(row.isSystem),
    isAssignable: Boolean(row.isAssignable),
    isActive: Boolean(row.isActive),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function getRoleById(roleId) {
  const role = await db.get(
    `SELECT id, name, description,
            is_system AS isSystem,
            is_assignable AS isAssignable,
            is_active AS isActive,
            created_at, updated_at
     FROM roles
     WHERE id = ?`,
    [roleId]
  );
  return mapRole(role);
}

async function assertMutableCustomRole(roleId) {
  const role = await getRoleById(roleId);
  if (!role) {
    throw new RoleServiceError('Role not found.', 404, 'ROLE_NOT_FOUND');
  }
  if (role.isSystem || SYSTEM_ROLE_SET.has(role.name)) {
    throw new RoleServiceError(
      'System roles are fixed and cannot be modified or deleted.',
      403,
      'SYSTEM_ROLE_IMMUTABLE'
    );
  }
  return role;
}

async function validateCustomPermissionIds(permissionIds = []) {
  if (!Array.isArray(permissionIds)) {
    throw new RoleServiceError('permissionIds must be an array.');
  }

  const uniqueIds = [...new Set(permissionIds.map(id => Number(id)))];
  if (uniqueIds.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new RoleServiceError('permissionIds contains an invalid permission id.');
  }
  if (uniqueIds.length === 0) return [];

  const placeholders = uniqueIds.map(() => '?').join(', ');
  const permissions = await db.all(
    `SELECT id, name FROM permissions WHERE id IN (${placeholders})`,
    uniqueIds
  );
  if (permissions.length !== uniqueIds.length) {
    throw new RoleServiceError('One or more permissions do not exist.');
  }

  const protectedPermissions = permissions
    .filter(permission => PROTECTED_PERMISSION_SET.has(permission.name))
    .map(permission => permission.name)
    .sort();
  if (protectedPermissions.length > 0) {
    throw new RoleServiceError(
      `These permissions are reserved for the system owner: ${protectedPermissions.join(', ')}.`,
      403,
      'PROTECTED_PERMISSION'
    );
  }

  return uniqueIds;
}

async function assertRoleNameAvailable(name, excludingRoleId = null) {
  const normalizedName = normalizeRoleName(name);
  if (!normalizedName) {
    throw new RoleServiceError('Role name is required.');
  }

  const existing = await db.get(
    `SELECT id FROM roles
     WHERE lower(name) = lower(?)
       AND (? IS NULL OR id != ?)`,
    [normalizedName, excludingRoleId, excludingRoleId]
  );
  if (existing) {
    throw new RoleServiceError('Role name is already taken.', 409, 'ROLE_NAME_CONFLICT');
  }
  return normalizedName;
}

async function insertPermissions(roleId, permissionIds) {
  for (const permissionId of permissionIds) {
    await db.run(
      'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
      [roleId, permissionId]
    );
  }
}

async function createRole(name, description = '', permissionIds = []) {
  const normalizedName = await assertRoleNameAvailable(name);
  const validatedPermissionIds = await validateCustomPermissionIds(permissionIds);

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = await db.run(
      `INSERT INTO roles
        (name, description, is_system, is_assignable, is_active)
       VALUES (?, ?, 0, 1, 1)`,
      [normalizedName, description || '']
    );
    await insertPermissions(result.lastID, validatedPermissionIds);
    await db.exec('COMMIT;');
    return await getRoleById(result.lastID);
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

async function assignPermissionToRole(roleId, permissionId) {
  await assertMutableCustomRole(roleId);
  const [validatedPermissionId] = await validateCustomPermissionIds([permissionId]);
  const result = await db.run(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
    [roleId, validatedPermissionId]
  );
  return result.changes > 0;
}

async function getAllRoles({
  includeInactive = false,
  includeInternal = false,
  assignableOnly = false
} = {}) {
  let sql = `
    SELECT id, name, description,
           is_system AS isSystem,
           is_assignable AS isAssignable,
           is_active AS isActive,
           created_at, updated_at
    FROM roles
    WHERE 1 = 1
  `;
  const params = [];
  if (!includeInactive) sql += ' AND is_active = 1';
  if (assignableOnly) sql += ' AND is_assignable = 1 AND is_active = 1';
  sql += ' ORDER BY is_system DESC, name ASC';

  const roles = await db.all(sql, params);
  return roles.map(mapRole);
}

async function getAllPermissions() {
  const permissions = await db.all('SELECT * FROM permissions ORDER BY name ASC');
  return permissions.map(permission => ({
    ...permission,
    isProtected: PROTECTED_PERMISSION_SET.has(permission.name)
  }));
}

async function getRolePermissions(roleId) {
  return await db.all(
    `SELECT p.id, p.name, p.description
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id = ?
     ORDER BY p.name ASC`,
    [roleId]
  );
}

async function updateRolePermissions(roleId, permissionIds) {
  const role = await getRoleById(roleId);
  if (!role) throw new RoleServiceError('Role not found.', 404, 'ROLE_NOT_FOUND');
  let validatedPermissionIds;
  if (role.name === 'assistant') {
    if (!Array.isArray(permissionIds)) throw new RoleServiceError('permissionIds must be an array.');
    const uniqueIds = [...new Set(permissionIds.map(Number))];
    if (uniqueIds.some(id => !Number.isInteger(id) || id <= 0)) throw new RoleServiceError('permissionIds contains an invalid permission id.');
    const placeholders = uniqueIds.map(() => '?').join(',');
    const permissions = uniqueIds.length
      ? await db.all(`SELECT id, name FROM permissions WHERE id IN (${placeholders})`, uniqueIds)
      : [];
    if (permissions.length !== uniqueIds.length) throw new RoleServiceError('One or more permissions do not exist.');
    const forbidden = permissions.filter(permission => ASSISTANT_FORBIDDEN_PERMISSION_SET.has(permission.name));
    if (forbidden.length) {
      throw new RoleServiceError(
        `Assistant accounts can never receive these permissions: ${forbidden.map(item => item.name).join(', ')}.`,
        403,
        'ASSISTANT_PERMISSION_FORBIDDEN'
      );
    }
    validatedPermissionIds = uniqueIds;
  } else {
    await assertMutableCustomRole(roleId);
    validatedPermissionIds = await validateCustomPermissionIds(permissionIds);
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await db.run('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    await insertPermissions(roleId, validatedPermissionIds);
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

async function updateRole(roleId, name, description, permissionIds) {
  await assertMutableCustomRole(roleId);
  const normalizedName = await assertRoleNameAvailable(name, Number(roleId));
  const validatedPermissionIds = permissionIds === undefined
    ? null
    : await validateCustomPermissionIds(permissionIds);

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await db.run(
      `UPDATE roles
       SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [normalizedName, description || '', roleId]
    );
    if (validatedPermissionIds) {
      await db.run('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
      await insertPermissions(roleId, validatedPermissionIds);
    }
    await db.exec('COMMIT;');
    return await getRoleById(roleId);
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

async function deleteRole(roleId) {
  await assertMutableCustomRole(roleId);
  const assignment = await db.get(
    'SELECT 1 AS assigned FROM user_roles WHERE role_id = ? LIMIT 1',
    [roleId]
  );
  if (assignment) {
    throw new RoleServiceError(
      'Cannot delete a role currently assigned to users.',
      409,
      'ROLE_IN_USE'
    );
  }
  const result = await db.run('DELETE FROM roles WHERE id = ?', [roleId]);
  return result.changes > 0;
}

async function getAssignableRolesByNames(roleNames) {
  if (!Array.isArray(roleNames) || roleNames.length === 0) {
    throw new RoleServiceError('At least one assignable role is required.');
  }

  const normalizedNames = roleNames.map(normalizeRoleName);
  const normalizedKeys = normalizedNames.map(name => name.toLowerCase());
  if (
    normalizedNames.some(name => !name) ||
    new Set(normalizedKeys).size !== roleNames.length
  ) {
    throw new RoleServiceError('Role names must be non-empty and unique.');
  }

  const placeholders = normalizedNames.map(() => '?').join(', ');
  const rows = await db.all(
    `SELECT id, name, description,
            is_system AS isSystem,
            is_assignable AS isAssignable,
            is_active AS isActive,
            created_at, updated_at
     FROM roles
     WHERE lower(name) IN (${placeholders})
       AND is_assignable = 1
       AND is_active = 1`,
    normalizedKeys
  );

  if (rows.length !== normalizedNames.length) {
    const found = new Set(rows.map(role => role.name.toLowerCase()));
    const invalid = normalizedNames.filter(name => !found.has(name.toLowerCase()));
    throw new RoleServiceError(
      `Unknown or non-assignable roles: ${invalid.join(', ')}.`,
      400,
      'ROLE_NOT_ASSIGNABLE'
    );
  }

  const combination = validateRoleCombination(rows.map(role => role.name));
  if (!combination.valid) {
    throw new RoleServiceError(
      `Role '${combination.roleName}' requires the following role(s): ${combination.requiredRoles.join(', ')}.`,
      400,
      'ROLE_COMBINATION_INVALID'
    );
  }

  return rows.map(mapRole);
}

module.exports = {
  RoleServiceError,
  createRole,
  assignPermissionToRole,
  getAllRoles,
  getRoleById,
  getAllPermissions,
  getRolePermissions,
  updateRolePermissions,
  updateRole,
  deleteRole,
  getAssignableRolesByNames,
  validateCustomPermissionIds
};
