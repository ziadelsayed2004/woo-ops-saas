const usersService = require('../modules/users/usersService');

function invalidateSession(req) {
  if (req.session && typeof req.session.destroy === 'function') {
    req.session.destroy(() => {});
  } else if (req.session) {
    req.session.user = null;
  }
}

function unauthorized(res, message = 'Authentication is required to access this resource.') {
  return res.status(401).json({ error: 'Unauthorized', message });
}

async function loadActiveUser(req) {
  if (!req.session || !req.session.user) return null;
  const user = await usersService.findById(req.session.user.id);
  if (!user || user.status !== 'active') {
    invalidateSession(req);
    return null;
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    status: user.status
  };
  req.authUser = user;
  return user;
}

/**
 * Express middleware to check both the session and the current database state.
 * This closes the gap where disabled/archived accounts could keep using routes
 * protected only by requireAuth.
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return unauthorized(res);
  }
  try {
    const user = await loadActiveUser(req);
    if (!user) {
      return unauthorized(res, 'Your account has been deactivated. Please login again.');
    }
    return next();
  } catch (error) {
    console.error('Error while validating the authenticated session:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'An error occurred while validating the authenticated session.'
    });
  }
}

/**
 * Express middleware to enforce a specific permission.
 */
function checkPermission(requiredPermission) {
  return async (req, res, next) => {
    // 1. Ensure authenticated
    if (!req.session || !req.session.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication is required to access this resource.'
      });
    }

    const userId = req.session.user.id;

    try {
      // requireAuth normally populated req.authUser. Keep this middleware safe
      // when it is used on its own in a route or a focused test.
      const user = req.authUser || await loadActiveUser(req);
      if (!user) {
        return unauthorized(res, 'Your account has been deactivated. Please login again.');
      }

      // 3. Compile permissions
      const permissions = req.userPermissions || await usersService.getUserPermissions(userId);
      req.userPermissions = permissions;

      // 4. Validate permission
      const hasPermission = permissions.includes(requiredPermission);

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Access denied. You do not have the required permission: '${requiredPermission}'.`,
          requiredPermission
        });
      }

      return next();
    } catch (err) {
      console.error(`Error in RBAC middleware checking '${requiredPermission}':`, err);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred while validating permissions.'
      });
    }
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.session || !req.session.user) return unauthorized(res);
  return usersService.getUserRoles(req.session.user.id, { activeOnly: true })
    .then(roles => {
      if (!roles.some(role => role.name === 'super_admin')) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'This action is restricted to the super administrator.'
        });
      }
      return next();
    })
    .catch(error => {
      console.error('Error while validating the super administrator role:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'An error occurred while validating the administrator role.'
      });
    });
}

module.exports = {
  requireAuth,
  checkPermission,
  requireSuperAdmin,
  loadActiveUser,
  invalidateSession
};
