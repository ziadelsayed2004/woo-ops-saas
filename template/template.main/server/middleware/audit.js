const auditService = require('../modules/audit/auditService');

/**
 * Express middleware to automatically log actions.
 * Logs when res finishes with a successful status (2xx).
 */
function auditLog(action, targetType) {
  return (req, res, next) => {
    // Intercept response finish
    res.on('finish', async () => {
      // Only log successful operations
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const userId = req.session && req.session.user ? req.session.user.id : null;
        
        // Skip logging if there is no authenticated user (except for login action)
        if (!userId && action !== 'login') {
          return;
        }

        // Try to identify targetId from request params
        let targetId = null;
        if (req.params.id) {
          targetId = req.params.id;
        } else if (req.body && req.body.id) {
          targetId = req.body.id.toString();
        }

        // Compile details of request
        const details = {
          method: req.method,
          url: req.originalUrl,
          params: req.params,
          query: req.query
        };

        // Don't log sensitive password fields
        if (req.body) {
          const bodyCopy = { ...req.body };
          if (bodyCopy.password) delete bodyCopy.password;
          if (bodyCopy.passwordConfirm) delete bodyCopy.passwordConfirm;
          details.body = bodyCopy;
        }

        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

        try {
          await auditService.log({
            userId,
            action,
            targetType,
            targetId,
            details,
            ipAddress
          });
        } catch (err) {
          console.error('Failed to write audit log in middleware:', err);
        }
      }
    });

    next();
  };
}

module.exports = {
  auditLog
};
