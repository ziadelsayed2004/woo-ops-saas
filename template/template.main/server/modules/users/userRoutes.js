const express = require('express');
const router = express.Router();
const usersService = require('./usersService');
const rolesService = require('../roles/rolesService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

function sendServiceError(res, error) {
  if (error && Number.isInteger(error.statusCode)) {
    const labels = {
      400: 'Bad Request',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict'
    };
    return res.status(error.statusCode).json({
      error: labels[error.statusCode] || 'Request Failed',
      message: error.message,
      code: error.code
    });
  }
  if (error && error.code === 'SQLITE_CONSTRAINT') {
    return res.status(409).json({
      error: 'Conflict',
      message: 'The requested value conflicts with an existing record.'
    });
  }
  return res.status(500).json({
    error: 'Internal Server Error',
    message: error.message
  });
}

function requestIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

async function assertSuperAdminRoleChangeAllowed(req, requestedRoleNames, targetUserId = null) {
  const roleNames = Array.isArray(requestedRoleNames)
    ? [...new Set(requestedRoleNames.map(name => String(name).trim()))]
    : [];
  if (roleNames.includes('super_admin') && roleNames.length !== 1) {
    throw new usersService.UserServiceError(
      'The super_admin role must be assigned on its own.',
      400,
      'SUPER_ADMIN_ROLE_EXCLUSIVE'
    );
  }

  const actorRoles = await usersService.getUserRoles(req.session.user.id, { activeOnly: true });
  const actorIsSuperAdmin = actorRoles.some(role => role.name === 'super_admin');
  let targetIsSuperAdmin = false;
  if (targetUserId !== null) {
    const targetRoles = await usersService.getUserRoles(targetUserId);
    targetIsSuperAdmin = targetRoles.some(role => role.name === 'super_admin');
  }

  if ((roleNames.includes('super_admin') || targetIsSuperAdmin) && !actorIsSuperAdmin) {
    throw new usersService.UserServiceError(
      'Only a Super Admin can grant or remove the super_admin role.',
      403,
      'SUPER_ADMIN_REQUIRED'
    );
  }
}

// Read access is separate from role mutation so the general monitor can inspect
// the role catalog without becoming a role administrator.
router.get('/permissions', requireAuth, checkPermission('roles.view'), async (_req, res) => {
  try {
    res.status(200).json(await rolesService.getAllPermissions());
  } catch (error) {
    sendServiceError(res, error);
  }
});

router.get('/roles', requireAuth, checkPermission('roles.view'), async (req, res) => {
  try {
    const canManageRoles = req.userPermissions.includes('roles.manage');
    const roles = await rolesService.getAllRoles({
      includeInactive: canManageRoles && req.query.includeInactive === 'true',
      includeInternal: canManageRoles && req.query.includeInternal === 'true',
      assignableOnly: req.query.assignableOnly === 'true'
    });
    for (const role of roles) {
      const permissions = await rolesService.getRolePermissions(role.id);
      role.permissions = permissions.map(permission => permission.name);
    }
    res.status(200).json(roles);
  } catch (error) {
    sendServiceError(res, error);
  }
});

router.post(
  '/roles/:roleId/permissions',
  requireAuth,
  checkPermission('roles.manage'),
  auditLog('update_role_permissions', 'roles'),
  async (req, res) => {
    try {
      await rolesService.updateRolePermissions(req.params.roleId, req.body.permissionIds);
      res.status(200).json({
        success: true,
        message: 'Role permissions updated successfully.'
      });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.post(
  '/roles',
  requireAuth,
  checkPermission('roles.manage'),
  auditLog('create_role', 'roles'),
  async (req, res) => {
    const { name, description, permissionIds = [] } = req.body;
    try {
      const role = await rolesService.createRole(name, description, permissionIds);
      res.status(201).json({
        success: true,
        message: 'Role created successfully.',
        role
      });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.put(
  '/roles/:roleId',
  requireAuth,
  checkPermission('roles.manage'),
  auditLog('update_role', 'roles'),
  async (req, res) => {
    const { name, description, permissionIds } = req.body;
    try {
      const role = await rolesService.updateRole(
        req.params.roleId,
        name,
        description,
        permissionIds
      );
      res.status(200).json({
        success: true,
        message: 'Role updated successfully.',
        role
      });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.delete(
  '/roles/:roleId',
  requireAuth,
  checkPermission('roles.manage'),
  auditLog('delete_role', 'roles'),
  async (req, res) => {
    try {
      await rolesService.deleteRole(req.params.roleId);
      res.status(200).json({ success: true, message: 'Role deleted successfully.' });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.get('/audit-logs', requireAuth, checkPermission('audit.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const action = req.query.action || null;
  const targetType = req.query.targetType || null;
  try {
    const auditService = require('../audit/auditService');
    res.status(200).json(await auditService.getLogs({ limit, offset, action, targetType }));
  } catch (error) {
    sendServiceError(res, error);
  }
});

router.get('/', requireAuth, checkPermission('users.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';
  try {
    res.status(200).json(await usersService.getUsers({ limit, offset, search }));
  } catch (error) {
    sendServiceError(res, error);
  }
});

// Return the minimal active-account list used by author/outlet account-link
// selectors. This is intentionally separate from the general users endpoint.
router.get('/linkable', requireAuth, async (req, res) => {
  const target = String(req.query.target || '').trim().toLowerCase();
  const requiredPermission = {
    author: 'authors.account_link',
    outlet: 'outlets.account_link'
  }[target];

  if (!requiredPermission) {
    return res.status(400).json({
      error: 'Bad Request',
      message: "The target must be either 'author' or 'outlet'."
    });
  }

  try {
    const permissions = req.userPermissions || await usersService.getUserPermissions(req.session.user.id);
    if (!permissions.includes(requiredPermission)
      && !permissions.includes('users.view')
      && !permissions.includes('users.update')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. You do not have the required permission: '${requiredPermission}'.`,
        requiredPermission
      });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit || '200', 10), 1), 500);
    const offset = Math.max(parseInt(req.query.offset || '0', 10), 0);
    const search = req.query.search || '';
    const users = await usersService.getLinkableUsers({ limit, offset, search });
    return res.status(200).json(users.map(user => ({
      id: user.id,
      username: user.username,
      fullName: user.full_name
    })));
  } catch (error) {
    return sendServiceError(res, error);
  }
});

router.get('/:id', requireAuth, checkPermission('users.view'), async (req, res) => {
  try {
    const user = await usersService.findById(req.params.id);
    if (!user || user.status === 'archived') {
      return res.status(404).json({ error: 'Not Found', message: 'User not found.' });
    }
    const roles = await usersService.getUserRoles(req.params.id);
    user.roles = roles.map(role => role.name);
    res.status(200).json(user);
  } catch (error) {
    sendServiceError(res, error);
  }
});

router.post(
  '/',
  requireAuth,
  checkPermission('users.create'),
  auditLog('create_user', 'users'),
  async (req, res) => {
    const { username, password, fullName, status = 'active', roles } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Username, password, and full name are required.'
      });
    }

    try {
      await assertSuperAdminRoleChangeAllowed(req, roles);
      const assignableRoles = await rolesService.getAssignableRolesByNames(roles);
      const user = await usersService.createUser({
        username,
        password,
        fullName,
        status,
        roleIds: assignableRoles.map(role => role.id)
      });
      user.roles = assignableRoles.map(role => role.name);
      res.status(201).json({ success: true, message: 'User created successfully.', user });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.put(
  '/:id',
  requireAuth,
  checkPermission('users.update'),
  auditLog('update_user', 'users'),
  async (req, res) => {
    const { fullName } = req.body;
    if (!fullName) {
      return res.status(400).json({ error: 'Bad Request', message: 'Full name is required.' });
    }

    try {
      const hasRolesField = Object.prototype.hasOwnProperty.call(req.body, 'roles');
      if (hasRolesField) {
        await assertSuperAdminRoleChangeAllowed(req, req.body.roles, req.params.id);
      }
      const requestedRoles = hasRolesField && Array.isArray(req.body.roles)
        && !req.body.roles.includes('assistant')
        ? req.body.roles.filter(role => role !== 'invoice_payment_operator')
        : req.body.roles;
      const assignableRoles = hasRolesField
        ? await rolesService.getAssignableRolesByNames(requestedRoles)
        : null;
      await usersService.updateUser(req.params.id, {
        fullName,
        roleIds: assignableRoles ? assignableRoles.map(role => role.id) : undefined
      });

      const user = await usersService.findById(req.params.id);
      const roles = await usersService.getUserRoles(req.params.id);
      user.roles = roles.map(role => role.name);
      res.status(200).json({ success: true, message: 'User updated successfully.', user });
    } catch (error) {
      sendServiceError(res, error);
    }
  }
);

router.put('/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['active', 'disabled', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid user status.' });
  }

  try {
    const permissions = await usersService.getUserPermissions(req.session.user.id);
    const requiredPermission = status === 'archived'
      ? 'users.archive'
      : status === 'disabled' ? 'users.disable' : 'users.update';
    if (!permissions.includes(requiredPermission)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. You do not have the required permission: '${requiredPermission}'.`,
        requiredPermission
      });
    }

    if (status === 'archived') {
      await usersService.archiveUser({
        targetUserId: req.params.id,
        actorUserId: req.session.user.id,
        ipAddress: requestIp(req)
      });
    } else {
      await usersService.updateStatus(req.params.id, status, {
        actorUserId: req.session.user.id
      });
      const auditService = require('../audit/auditService');
      await auditService.log({
        userId: req.session.user.id,
        action: status === 'disabled' ? 'disable_user' : 'enable_user',
        targetType: 'users',
        targetId: req.params.id,
        details: { status },
        ipAddress: requestIp(req)
      });
    }

    res.status(200).json({
      success: true,
      message: `User account status updated to '${status}' successfully.`
    });
  } catch (error) {
    sendServiceError(res, error);
  }
});

router.delete('/:id', requireAuth, checkPermission('users.archive'), async (req, res) => {
  try {
    await usersService.archiveUser({
      targetUserId: req.params.id,
      actorUserId: req.session.user.id,
      ipAddress: requestIp(req)
    });
    res.status(200).json({
      success: true,
      message: 'User archived successfully. The original username is available for reuse.'
    });
  } catch (error) {
    sendServiceError(res, error);
  }
});

module.exports = router;
