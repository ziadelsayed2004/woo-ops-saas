const express = require('express');
const router = express.Router();
const authService = require('./authService');
const usersService = require('../users/usersService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. POST /api/auth/login
router.post('/login', auditLog('login', 'users'), async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await authService.authenticate(username, password);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid username or password.'
      });
    }

    const permissions = await usersService.getUserPermissions(user.id);
    const roles = await usersService.getUserRoles(user.id);

    const userProfile = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      status: user.status,
      roles: roles.map(r => r.name),
      permissions
    };

    // Save to session
    req.session.user = {
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      status: user.status
    };

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      user: userProfile
    });
  } catch (err) {
    res.status(401).json({
      error: 'Unauthorized',
      message: err.message
    });
  }
});

// 2. POST /api/auth/logout
router.post('/logout', requireAuth, auditLog('logout', 'users'), (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Could not log out. Please try again.'
      });
    }
    res.clearCookie('connect.sid'); // default express session cookie name
    res.status(200).json({
      success: true,
      message: 'Logged out successfully.'
    });
  });
});

// 3. GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const userId = req.session.user.id;
  try {
    const user = await usersService.findById(userId);
    if (!user || user.status !== 'active') {
      if (req.session.destroy) {
        req.session.destroy();
      } else {
        req.session.user = null;
      }
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Your account has been deactivated.'
      });
    }

    const permissions = await usersService.getUserPermissions(userId);
    const roles = await usersService.getUserRoles(userId);

    res.status(200).json({
      id: user.id,
      username: user.username,
      fullName: user.full_name,
      status: user.status,
      roles: roles.map(r => r.name),
      permissions
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message
    });
  }
});

// 4. POST /api/auth/change-password
router.post('/change-password', requireAuth, auditLog('change_password', 'users'), async (req, res) => {
  const userId = req.session.user.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Current password and new password are required.'
    });
  }

  try {
    // Authenticate with current credentials first to verify identity
    const username = req.session.user.username;
    const isAuthentic = await authService.authenticate(username, currentPassword);
    if (!isAuthentic) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Incorrect current password.'
      });
    }

    await usersService.updatePassword(userId, newPassword);
    res.status(200).json({
      success: true,
      message: 'Password changed successfully.'
    });
  } catch (err) {
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message
    });
  }
});

// 5. POST /api/auth/reset-password/:userId
router.post('/reset-password/:userId', requireAuth, checkPermission('users.update'), auditLog('reset_password_by_admin', 'users'), async (req, res) => {
  const { userId } = req.params;
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'New password is required.'
    });
  }

  try {
    const targetUser = await usersService.findById(userId);
    if (!targetUser) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found.'
      });
    }
    if (targetUser.status === 'archived') {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Archived accounts cannot have their password reset.'
      });
    }

    await usersService.updatePassword(userId, newPassword);
    res.status(200).json({
      success: true,
      message: `Password for user '${targetUser.username}' has been reset successfully.`
    });
  } catch (err) {
    if (Number.isInteger(err.statusCode)) {
      return res.status(err.statusCode).json({
        error: err.statusCode === 409 ? 'Conflict' : 'Request Failed',
        message: err.message,
        code: err.code
      });
    }
    res.status(500).json({
      error: 'Internal Server Error',
      message: err.message
    });
  }
});

module.exports = router;
