const db = require('../../db');

/**
 * Get all categories ordered by name.
 */
async function getAllCategories() {
  const sql = 'SELECT * FROM categories ORDER BY name ASC';
  return await db.all(sql);
}

/**
 * Get a single category by ID.
 */
async function getCategoryById(id) {
  const sql = 'SELECT * FROM categories WHERE id = ?';
  return await db.get(sql, [id]);
}

/**
 * Create a new category.
 */
async function createCategory({ name, description = '' }) {
  if (!name || !name.trim()) {
    throw new Error('Category name is required');
  }

  const trimmedName = name.trim();

  // Check duplicate name
  const existing = await db.get('SELECT id FROM categories WHERE name = ?', [trimmedName]);
  if (existing) {
    throw new Error('A category with this name already exists');
  }

  const sql = 'INSERT INTO categories (name, description) VALUES (?, ?)';
  const result = await db.run(sql, [trimmedName, description.trim()]);
  return { id: result.lastID, name: trimmedName, description };
}

/**
 * Update an existing category.
 */
async function updateCategory(id, { name, description = '' }) {
  if (!name || !name.trim()) {
    throw new Error('Category name is required');
  }

  const trimmedName = name.trim();

  // Check duplicate name for another category
  const existing = await db.get('SELECT id FROM categories WHERE name = ? AND id != ?', [trimmedName, id]);
  if (existing) {
    throw new Error('A category with this name already exists');
  }

  const sql = 'UPDATE categories SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
  const result = await db.run(sql, [trimmedName, description.trim(), id]);
  return result.changes > 0;
}

/**
 * Delete a category by ID.
 */
async function deleteCategory(id) {
  const sql = 'DELETE FROM categories WHERE id = ?';
  const result = await db.run(sql, [id]);
  return result.changes > 0;
}

module.exports = {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory
};
