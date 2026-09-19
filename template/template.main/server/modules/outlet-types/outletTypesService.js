const db = require('../../db');

/**
 * Create a new outlet type.
 */
async function createOutletType({ name, description = '', status = 'active' }) {
  if (!name) {
    throw new Error('Outlet type name is required');
  }
  const sql = `
    INSERT INTO outlet_types (name, description, status)
    VALUES (?, ?, ?)
  `;
  const result = await db.run(sql, [name.trim(), description, status]);
  return { id: result.lastID, name, description, status };
}

/**
 * Update an outlet type.
 */
async function updateOutletType(id, { name, description, status }) {
  if (!name) {
    throw new Error('Outlet type name is required');
  }
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('Invalid status');
  }
  const sql = `
    UPDATE outlet_types
    SET name = ?, description = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  const result = await db.run(sql, [name.trim(), description, status, id]);
  return result.changes > 0;
}

/**
 * Find outlet type by ID.
 */
async function findById(id) {
  const sql = `SELECT * FROM outlet_types WHERE id = ?`;
  return await db.get(sql, [id]);
}

/**
 * Find outlet type by name.
 */
async function findByName(name) {
  const sql = `SELECT * FROM outlet_types WHERE name = ?`;
  return await db.get(sql, [name.trim()]);
}

/**
 * Retrieve all outlet types.
 */
async function getAll({ limit = 50, offset = 0, includeDisabled = true } = {}) {
  let sql = `SELECT * FROM outlet_types WHERE 1=1`;
  const params = [];
  
  if (!includeDisabled) {
    sql += ` AND status = 'active'`;
  }
  
  sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);
  
  return await db.all(sql, params);
}

async function deleteOutletType(id) {
  const result = await db.run('DELETE FROM outlet_types WHERE id = ?', [id]);
  return result.changes > 0;
}

module.exports = {
  createOutletType,
  updateOutletType,
  findById,
  findByName,
  getAll,
  deleteOutletType
};
