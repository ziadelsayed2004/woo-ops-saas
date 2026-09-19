const db = require('../../db');

/**
 * Create a new author.
 */
async function createAuthor({ name, phone = '', status = 'active', userId = null }) {
  if (!name) {
    throw new Error('Author name is required');
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = await db.run(
      `INSERT INTO authors (name, phone, status)
       VALUES (?, ?, ?)`,
      [name.trim(), phone.trim(), status]
    );
    const authorId = result.lastID;

    if (userId) {
      await db.run('INSERT INTO author_users (author_id, user_id) VALUES (?, ?)', [authorId, userId]);
    }

    await db.exec('COMMIT;');
    return { id: authorId, name, phone, status, userId };
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Update an existing author.
 */
async function updateAuthor(id, { name, phone = '', status = 'active', userId }) {
  if (!name) {
    throw new Error('Author name is required');
  }
  if (!['active', 'inactive'].includes(status)) {
    throw new Error('Invalid status');
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const result = await db.run(
      `UPDATE authors
       SET name = ?, phone = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name.trim(), phone.trim(), status, id]
    );

    // Only mutate the security-sensitive account link when the caller explicitly
    // supplied it. Operational editors can therefore update author data without
    // silently detaching the existing account.
    if (userId !== undefined) {
      await db.run('DELETE FROM author_users WHERE author_id = ?', [id]);
      if (userId) {
        await db.run('INSERT INTO author_users (author_id, user_id) VALUES (?, ?)', [id, userId]);
      }
    }

    await db.exec('COMMIT;');
    return result.changes > 0;
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Find author by ID.
 */
async function findById(id) {
  const sql = `
    SELECT a.*, au.user_id, u.username AS linked_username
    FROM authors a
    LEFT JOIN author_users au ON au.author_id = a.id
    LEFT JOIN users u ON u.id = au.user_id
    WHERE a.id = ?
  `;
  const row = await db.get(sql, [id]);
  if (row) {
    row.userId = row.user_id;
    delete row.user_id;
  }
  return row;
}

/**
 * Find author by name.
 */
async function findByName(name) {
  const sql = `
    SELECT a.*, au.user_id, u.username AS linked_username
    FROM authors a
    LEFT JOIN author_users au ON au.author_id = a.id
    LEFT JOIN users u ON u.id = au.user_id
    WHERE a.name = ?
  `;
  const row = await db.get(sql, [name.trim()]);
  if (row) {
    row.userId = row.user_id;
    delete row.user_id;
  }
  return row;
}

/**
 * Retrieve all authors with filters.
 */
async function getAll({ limit = 50, offset = 0, search = '', status = '', userId = null, productId = null } = {}) {
  let sql = `
    SELECT a.*, au.user_id, u.username AS linked_username
    FROM authors a
    LEFT JOIN author_users au ON au.author_id = a.id
    LEFT JOIN users u ON u.id = au.user_id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (a.name LIKE ? OR a.phone LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term);
  }
  if (status) {
    sql += ` AND a.status = ?`;
    params.push(status);
  }
  if (userId) {
    sql += ` AND au.user_id = ?`;
    params.push(userId);
  }
  if (productId) {
    sql += ` AND a.id IN (SELECT author_id FROM product_authors WHERE product_id = ?)`;
    params.push(productId);
  }

  sql += ` ORDER BY a.name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await db.all(sql, params);
  return rows.map(r => {
    r.userId = r.user_id;
    delete r.user_id;
    return r;
  });
}

/**
 * Get all author IDs linked to a specific user.
 */
async function getLinkedAuthorsForUser(userId) {
  const rows = await db.all('SELECT author_id FROM author_users WHERE user_id = ?', [userId]);
  return rows.map(r => r.author_id);
}

/**
 * Fetch all books/products linked to an author.
 */
async function getBooksByAuthor(authorId) {
  const sql = `
    SELECT p.*
    FROM products p
    JOIN product_authors pa ON pa.product_id = p.id
    WHERE pa.author_id = ?
  `;
  return await db.all(sql, [authorId]);
}

/**
 * Link a book/product to an author.
 */
async function linkBookToAuthor(productId, authorId) {
  const sql = `INSERT OR IGNORE INTO product_authors (product_id, author_id) VALUES (?, ?)`;
  const result = await db.run(sql, [productId, authorId]);
  return result.changes > 0;
}

/**
 * Unlink a book/product from an author.
 */
async function unlinkBookFromAuthor(productId, authorId) {
  const sql = `DELETE FROM product_authors WHERE product_id = ? AND author_id = ?`;
  const result = await db.run(sql, [productId, authorId]);
  return result.changes > 0;
}

/**
 * Delete an author.
 */
async function deleteAuthor(id) {
  await db.run('DELETE FROM author_users WHERE author_id = ?', [id]);
  await db.run('DELETE FROM product_authors WHERE author_id = ?', [id]);
  const result = await db.run('DELETE FROM authors WHERE id = ?', [id]);
  return result.changes > 0;
}

module.exports = {
  createAuthor,
  updateAuthor,
  findById,
  findByName,
  getAll,
  getLinkedAuthorsForUser,
  getBooksByAuthor,
  linkBookToAuthor,
  unlinkBookFromAuthor,
  deleteAuthor
};
