class AccountLinkError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.name = 'AccountLinkError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function hasPermission(req, permission) {
  return Array.isArray(req.userPermissions) && req.userPermissions.includes(permission);
}

function hasAccountReadPermission(req, resourcePermission) {
  return hasPermission(req, 'users.view')
    || hasPermission(req, 'users.update')
    || hasPermission(req, resourcePermission);
}

function normalizeUserId(value) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new AccountLinkError('A valid user account ID is required.', 400, 'INVALID_ACCOUNT_ID');
  }
  return userId;
}

async function validateActiveUser(userId, usersService) {
  if (userId === undefined || userId === null) return;
  const user = await usersService.findById(userId);
  if (!user) {
    throw new AccountLinkError('The specified user account does not exist.', 404, 'LINKABLE_USER_NOT_FOUND');
  }
  if (user.status !== 'active') {
    throw new AccountLinkError('Only active user accounts can be linked.', 409, 'LINKABLE_USER_INACTIVE');
  }
}

function requireAccountLinkPermission(resourcePermission, resourceLabel) {
  return async (req, res, next) => {
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'userId')) return next();

    try {
      const usersService = require('./usersService');
      const permissions = req.userPermissions || await usersService.getUserPermissions(req.session.user.id);
      if (!permissions.includes(resourcePermission) && !permissions.includes('users.update')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Access denied. Linking ${resourceLabel} to an account requires '${resourcePermission}'.`,
          requiredPermission: resourcePermission
        });
      }
      req.userPermissions = permissions;
      return next();
    } catch (err) {
      return res.status(500).json({ error: 'Internal Server Error', message: err.message });
    }
  };
}

function sendError(res, error) {
  if (error instanceof AccountLinkError) {
    return res.status(error.statusCode).json({
      error: error.statusCode === 404 ? 'Not Found' : error.statusCode === 409 ? 'Conflict' : 'Bad Request',
      message: error.message,
      code: error.code
    });
  }
  return null;
}

module.exports = {
  AccountLinkError,
  hasPermission,
  hasAccountReadPermission,
  normalizeUserId,
  validateActiveUser,
  requireAccountLinkPermission,
  sendError
};
