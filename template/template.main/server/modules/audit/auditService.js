const db = require('../../db');

/**
 * Log an audit action.
 */
async function log({ userId, action, targetType = null, targetId = null, details = null, ipAddress = null }) {
  const detailsStr = details ? JSON.stringify(details) : null;
  const sql = `
    INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const result = await db.run(sql, [userId, action, targetType, targetId, detailsStr, ipAddress]);
  return result.lastID;
}

/**
 * Retrieve audit logs with pagination and filters.
 */
async function getLogs({ limit = 50, offset = 0, userId = null, action = null, targetType = null } = {}) {
  let sql = `
    SELECT al.*,
           CASE
             WHEN u.status = 'archived' THEN COALESCE(u.archived_username, u.username)
             ELSE u.username
           END AS username,
           u.full_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE 1=1
  `;
  const params = [];

  if (userId) {
    sql += ` AND al.user_id = ?`;
    params.push(userId);
  }
  if (action) {
    sql += ` AND al.action = ?`;
    params.push(action);
  }
  if (targetType) {
    sql += ` AND al.target_type = ?`;
    params.push(targetType);
  }

  sql += ` ORDER BY al.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const logs = await db.all(sql, params);
  return logs.map(log => {
    try {
      log.details = log.details ? JSON.parse(log.details) : null;
    } catch {
      // Keep it as string if JSON parsing fails
    }
    return log;
  });
}

module.exports = {
  log,
  getLogs
};
