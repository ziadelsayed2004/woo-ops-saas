const bcrypt = require('bcrypt');
const crypto = require('crypto');
const db = require('../../db');

const ARCHIVED_USERNAME_PREFIX = '__archived__';

class UserServiceError extends Error {
  constructor(message, statusCode = 400, code = 'USER_ERROR') {
    super(message);
    this.name = 'UserServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!normalized) {
    throw new UserServiceError('Username is required.');
  }
  if (normalized.startsWith(ARCHIVED_USERNAME_PREFIX)) {
    throw new UserServiceError('This username prefix is reserved by the system.');
  }
  return normalized;
}

function isUniqueConstraintError(error) {
  return Boolean(
    error && (
      error.code === 'SQLITE_CONSTRAINT' ||
      String(error.message || '').includes('UNIQUE constraint failed: users.username')
    )
  );
}

async function rollbackAndRethrow(error) {
  try {
    await db.exec('ROLLBACK;');
  } catch {
    // Preserve the original failure; the connection reports the useful cause.
  }
  if (isUniqueConstraintError(error)) {
    throw new UserServiceError('Username is already taken.', 409, 'USERNAME_CONFLICT');
  }
  throw error;
}

async function insertRoleAssignments(userId, roleIds) {
  for (const roleId of [...new Set(roleIds.map(Number))]) {
    await db.run(
      'INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)',
      [userId, roleId]
    );
  }
}

async function createUser({ username, password, fullName, status = 'active', roleIds = [] }) {
  if (!password || !fullName) {
    throw new UserServiceError('Username, password, and full name are required.');
  }
  if (!['active', 'disabled'].includes(status)) {
    throw new UserServiceError('New users must be active or disabled.');
  }
  const normalizedUsername = normalizeUsername(username);
  const passwordHash = await bcrypt.hash(password, 10);

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = await db.run(
      `INSERT INTO users (username, password_hash, full_name, status)
       VALUES (?, ?, ?, ?)`,
      [normalizedUsername, passwordHash, fullName.trim(), status]
    );
    await insertRoleAssignments(result.lastID, roleIds);
    await db.exec('COMMIT;');
    return {
      id: result.lastID,
      username: normalizedUsername,
      fullName: fullName.trim(),
      status
    };
  } catch (error) {
    return await rollbackAndRethrow(error);
  }
}

async function findById(id) {
  return await db.get(
    `SELECT id, username, full_name, status, archived_username, archived_at,
            created_at, updated_at
     FROM users
     WHERE id = ?`,
    [id]
  );
}

async function findByUsername(username) {
  const normalizedUsername = normalizeUsername(username);
  return await db.get('SELECT * FROM users WHERE username = ?', [normalizedUsername]);
}

async function userHasRole(userId, roleName) {
  return Boolean(await db.get(
    `SELECT 1 AS found
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = ?
     LIMIT 1`,
    [userId, roleName]
  ));
}

async function assertCanDeactivateUser(targetUserId, actorUserId) {
  if (String(targetUserId) === String(actorUserId)) {
    throw new UserServiceError(
      'You cannot deactivate or archive your own account.',
      403,
      'SELF_DEACTIVATION_FORBIDDEN'
    );
  }

  if (await userHasRole(targetUserId, 'super_admin')) {
    const otherActiveOwner = await db.get(
      `SELECT 1 AS found
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'super_admin'
         AND u.status = 'active'
         AND u.id != ?
       LIMIT 1`,
      [targetUserId]
    );
    if (!otherActiveOwner) {
      throw new UserServiceError(
        'The last active system owner cannot be deactivated or archived.',
        409,
        'LAST_ACTIVE_OWNER'
      );
    }
  }
}

async function updateStatus(id, status, { actorUserId } = {}) {
  if (!['active', 'disabled'].includes(status)) {
    throw new UserServiceError('Archived accounts use the terminal archive operation.');
  }

  const user = await findById(id);
  if (!user) {
    throw new UserServiceError('User not found.', 404, 'USER_NOT_FOUND');
  }
  if (user.status === 'archived') {
    throw new UserServiceError(
      'Archived accounts cannot be reactivated or modified.',
      409,
      'ARCHIVE_IS_TERMINAL'
    );
  }
  if (status === 'disabled' && user.status !== 'disabled') {
    await assertCanDeactivateUser(id, actorUserId);
  }

  const result = await db.run(
    'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != ?',
    [status, id, 'archived']
  );
  return result.changes > 0;
}

async function updatePassword(id, newPassword) {
  const user = await findById(id);
  if (!user) {
    throw new UserServiceError('User not found.', 404, 'USER_NOT_FOUND');
  }
  if (user.status === 'archived') {
    throw new UserServiceError(
      'Archived accounts cannot have their password reset.',
      409,
      'ARCHIVE_IS_TERMINAL'
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const result = await db.run(
    `UPDATE users
     SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status != 'archived'`,
    [passwordHash, id]
  );
  return result.changes > 0;
}

async function assignRole(userId, roleId) {
  const result = await db.run(
    'INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)',
    [userId, roleId]
  );
  return result.changes > 0;
}

async function getUserRoles(userId, { activeOnly = false } = {}) {
  let sql = `
    SELECT r.id, r.name, r.description,
           r.is_system AS isSystem,
           r.is_assignable AS isAssignable,
           r.is_active AS isActive
    FROM roles r
    JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `;
  if (activeOnly) sql += ' AND r.is_active = 1';
  sql += ' ORDER BY r.name ASC';
  return await db.all(sql, [userId]);
}

async function getUserPermissions(userId) {
  const roles = await getUserRoles(userId, { activeOnly: true });
  if (roles.some(role => role.name === 'super_admin')) {
    const allPermissions = await db.all('SELECT name FROM permissions ORDER BY name ASC');
    return allPermissions.map(permission => permission.name);
  }

  const rows = await db.all(
    `SELECT DISTINCT p.name
     FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN roles r ON r.id = rp.role_id AND r.is_active = 1
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ?
     ORDER BY p.name ASC`,
    [userId]
  );
  return rows.map(row => row.name);
}

async function updateUser(id, { fullName, roleIds }) {
  const user = await findById(id);
  if (!user) {
    throw new UserServiceError('User not found.', 404, 'USER_NOT_FOUND');
  }
  if (user.status === 'archived') {
    throw new UserServiceError(
      'Archived accounts cannot be modified.',
      409,
      'ARCHIVE_IS_TERMINAL'
    );
  }
  if (roleIds !== undefined && await userHasRole(id, 'super_admin')) {
    const superAdminRole = await db.get("SELECT id FROM roles WHERE name = 'super_admin'");
    if (superAdminRole && !roleIds.map(Number).includes(superAdminRole.id)) {
      const otherActiveOwner = await db.get(
        `SELECT 1 AS found
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE r.name = 'super_admin'
           AND u.status = 'active'
           AND u.id != ?
         LIMIT 1`,
        [id]
      );
      if (!otherActiveOwner) {
        throw new UserServiceError(
          'The last active system owner cannot be reassigned to a different role.',
          409,
          'LAST_ACTIVE_OWNER'
        );
      }
    }
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    await db.run(
      'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [fullName.trim(), id]
    );
    if (roleIds !== undefined) {
      await db.run('DELETE FROM user_roles WHERE user_id = ?', [id]);
      await insertRoleAssignments(id, roleIds);
    }
    await db.exec('COMMIT;');
    return true;
  } catch (error) {
    return await rollbackAndRethrow(error);
  }
}

async function clearRoles(userId) {
  await db.run('DELETE FROM user_roles WHERE user_id = ?', [userId]);
}

async function getUsers({ limit = 50, offset = 0, search = '' } = {}) {
  let sql = `
    SELECT id, username, full_name, status, created_at, updated_at
    FROM users
    WHERE status != 'archived'
  `;
  const params = [];
  if (search) {
    sql += ' AND (username LIKE ? OR full_name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }
  sql += ' ORDER BY username ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const users = await db.all(sql, params);
  for (const user of users) {
    const roles = await getUserRoles(user.id);
    user.roles = roles.map(role => role.name);
  }
  return users;
}

async function getLinkableUsers({ limit = 200, offset = 0, search = '' } = {}) {
  let sql = `
    SELECT id, username, full_name, status
    FROM users
    WHERE status = 'active'
  `;
  const params = [];
  if (search) {
    sql += ' AND (username LIKE ? OR full_name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }
  sql += ' ORDER BY full_name ASC, username ASC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.all(sql, params);
}

async function archiveUser({ targetUserId, actorUserId, ipAddress = null }) {
  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const user = await findById(targetUserId);
    if (!user) {
      throw new UserServiceError('User not found.', 404, 'USER_NOT_FOUND');
    }
    if (user.status === 'archived') {
      throw new UserServiceError(
        'This account is already archived and cannot be changed.',
        409,
        'ARCHIVE_IS_TERMINAL'
      );
    }

    await assertCanDeactivateUser(targetUserId, actorUserId);
    const roles = await getUserRoles(targetUserId);
    const authorLinks = await db.all(
      'SELECT author_id FROM author_users WHERE user_id = ? ORDER BY author_id ASC',
      [targetUserId]
    );
    const outletLinks = await db.all(
      'SELECT outlet_id FROM outlet_users WHERE user_id = ? ORDER BY outlet_id ASC',
      [targetUserId]
    );

    const details = JSON.stringify({
      originalUsername: user.username,
      fullName: user.full_name,
      statusBefore: user.status,
      roles: roles.map(role => role.name),
      authorIds: authorLinks.map(link => link.author_id),
      outletIds: outletLinks.map(link => link.outlet_id)
    });
    await db.run(
      `INSERT INTO audit_logs
        (user_id, action, target_type, target_id, details, ip_address)
       VALUES (?, 'archive_user', 'users', ?, ?, ?)`,
      [actorUserId, String(targetUserId), details, ipAddress]
    );

    const tombstone = `${ARCHIVED_USERNAME_PREFIX}${targetUserId}__${crypto.randomUUID().replace(/-/g, '')}`;
    await db.run(
      `UPDATE users
       SET archived_username = username,
           username = ?,
           status = 'archived',
           archived_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status != 'archived'`,
      [tombstone, targetUserId]
    );
    await db.run('DELETE FROM user_roles WHERE user_id = ?', [targetUserId]);
    await db.run('DELETE FROM author_users WHERE user_id = ?', [targetUserId]);
    await db.run('DELETE FROM outlet_users WHERE user_id = ?', [targetUserId]);
    await db.exec('COMMIT;');

    return {
      id: Number(targetUserId),
      archivedUsername: user.username,
      archivedAt: new Date().toISOString()
    };
  } catch (error) {
    return await rollbackAndRethrow(error);
  }
}

module.exports = {
  ARCHIVED_USERNAME_PREFIX,
  UserServiceError,
  normalizeUsername,
  createUser,
  findById,
  findByUsername,
  updateStatus,
  updatePassword,
  assignRole,
  getUserRoles,
  getUserPermissions,
  updateUser,
  clearRoles,
  getUsers,
  getLinkableUsers,
  archiveUser,
  assertCanDeactivateUser
};
