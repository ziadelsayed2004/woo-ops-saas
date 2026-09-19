const db = require('../../db');
const notificationsService = require('../notifications/notificationsService');

/**
 * Create a new product.
 */
async function createProduct({ title, code, category = '', status = 'active', stockPolicy = 'track', authorIds = [], categoryIds = [] }) {
  if (!title || !code) {
    throw new Error('Title and product code are required');
  }

  let categoryNames = [];
  let finalCategoryIds = categoryIds || [];

  // Resolve category names from categoryIds or find/create from category string
  if (finalCategoryIds.length > 0) {
    const placeholders = finalCategoryIds.map(() => '?').join(',');
    const cats = await db.all(`SELECT id, name FROM categories WHERE id IN (${placeholders})`, finalCategoryIds);
    categoryNames = cats.map(c => c.name);
  } else if (category && category.trim()) {
    const catName = category.trim();
    let cat = await db.get('SELECT id, name FROM categories WHERE name = ?', [catName]);
    if (!cat) {
      const insRes = await db.run('INSERT INTO categories (name) VALUES (?)', [catName]);
      cat = { id: insRes.lastID, name: catName };
    }
    finalCategoryIds = [cat.id];
    categoryNames = [cat.name];
  }

  const categoryString = categoryNames.join(', ');

  const sql = `
    INSERT INTO products (title, code, category, status, stock_policy)
    VALUES (?, ?, ?, ?, ?)
  `;
  const result = await db.run(sql, [title.trim(), code.trim(), categoryString, status, stockPolicy]);
  const productId = result.lastID;

  // Insert product categories mappings
  if (finalCategoryIds.length > 0) {
    for (const catId of finalCategoryIds) {
      await db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', [productId, catId]);
    }
  }

  if (authorIds && authorIds.length > 0) {
    for (const authorId of authorIds) {
      await db.run('INSERT INTO product_authors (product_id, author_id) VALUES (?, ?)', [productId, authorId]);
    }
  }

  try {
    await notificationsService.checkProductPriceNotifications(productId);
  } catch (e) {
    console.error('Error running checkProductPriceNotifications in createProduct:', e);
  }

  return { 
    id: productId, 
    title, 
    code, 
    category: categoryString, 
    status, 
    stockPolicy, 
    authorIds, 
    categoryIds: finalCategoryIds,
    categories: categoryNames.map((name, idx) => ({ id: finalCategoryIds[idx], name }))
  };
}

/**
 * Update an existing product.
 */
async function updateProduct(id, { title, code, category = '', status = 'active', stockPolicy = 'track', authorIds = [], categoryIds = [] }) {
  if (!title || !code) {
    throw new Error('Title and product code are required');
  }
  if (!['active', 'inactive'].includes(status)) {
    throw new Error('Invalid status');
  }
  if (!['track', 'ignore'].includes(stockPolicy)) {
    throw new Error('Invalid stock policy');
  }

  let categoryNames = [];
  let finalCategoryIds = categoryIds || [];

  // Resolve category names from categoryIds or find/create from category string
  if (finalCategoryIds.length > 0) {
    const placeholders = finalCategoryIds.map(() => '?').join(',');
    const cats = await db.all(`SELECT id, name FROM categories WHERE id IN (${placeholders})`, finalCategoryIds);
    categoryNames = cats.map(c => c.name);
  } else if (category && category.trim()) {
    const catName = category.trim();
    let cat = await db.get('SELECT id, name FROM categories WHERE name = ?', [catName]);
    if (!cat) {
      const insRes = await db.run('INSERT INTO categories (name) VALUES (?)', [catName]);
      cat = { id: insRes.lastID, name: catName };
    }
    finalCategoryIds = [cat.id];
    categoryNames = [cat.name];
  }

  const categoryString = categoryNames.join(', ');

  const sql = `
    UPDATE products
    SET title = ?, code = ?, category = ?, status = ?, stock_policy = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `;
  const result = await db.run(sql, [title.trim(), code.trim(), categoryString, status, stockPolicy, id]);

  // Update product categories association
  await db.run('DELETE FROM product_categories WHERE product_id = ?', [id]);
  if (finalCategoryIds.length > 0) {
    for (const catId of finalCategoryIds) {
      await db.run('INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)', [id, catId]);
    }
  }

  // Update product authors association
  await db.run('DELETE FROM product_authors WHERE product_id = ?', [id]);
  if (authorIds && authorIds.length > 0) {
    for (const authorId of authorIds) {
      await db.run('INSERT INTO product_authors (product_id, author_id) VALUES (?, ?)', [id, authorId]);
    }
  }

  try {
    await notificationsService.checkProductPriceNotifications(id);
  } catch (e) {
    console.error('Error running checkProductPriceNotifications in updateProduct:', e);
  }

  return result.changes > 0;
}

/**
 * Delete an existing product.
 */
async function deleteProduct(id) {
  const sql = `DELETE FROM products WHERE id = ?`;
  const result = await db.run(sql, [id]);
  return result.changes > 0;
}

/**
 * Find a product by ID (attaching its authors and categories).
 */
async function findById(id) {
  const sql = `SELECT * FROM products WHERE id = ?`;
  const row = await db.get(sql, [id]);
  if (row) {
    row.stockPolicy = row.stock_policy;
    delete row.stock_policy;

    // Fetch associated categories
    row.categories = await db.all(`
      SELECT c.id, c.name
      FROM categories c
      JOIN product_categories pc ON pc.category_id = c.id
      WHERE pc.product_id = ?
    `, [id]);

    // Fetch associated authors
    const authors = await db.all(`
      SELECT a.id, a.name, a.phone, a.status
      FROM authors a
      JOIN product_authors pa ON pa.author_id = a.id
      WHERE pa.product_id = ?
    `, [id]);
    row.authors = authors;
  }
  return row;
}

/**
 * Find a product by code (useful for duplicate validation).
 */
async function findByCode(code) {
  const sql = `SELECT * FROM products WHERE code = ?`;
  const row = await db.get(sql, [code.trim()]);
  if (row) {
    row.stockPolicy = row.stock_policy;
    delete row.stock_policy;
  }
  return row;
}

/**
 * Retrieve all products with filters.
 */
async function getAll({ limit = 50, offset = 0, search = '', category = '', status = '', authorIds = null } = {}) {
  let sql = `
    SELECT DISTINCT p.*
    FROM products p
    LEFT JOIN product_authors pa ON pa.product_id = p.id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (p.title LIKE ? OR p.code LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term);
  }
  if (category) {
    if (Number.isInteger(Number(category)) && String(category).trim() !== '') {
      sql += ` AND p.id IN (SELECT product_id FROM product_categories WHERE category_id = ?)`;
      params.push(Number(category));
    } else {
      sql += ` AND p.id IN (SELECT pc.product_id FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE c.name = ?)`;
      params.push(category);
    }
  }
  if (status) {
    sql += ` AND p.status = ?`;
    params.push(status);
  }
  if (authorIds && authorIds.length > 0) {
    const placeholders = authorIds.map(() => '?').join(',');
    sql += ` AND pa.author_id IN (${placeholders})`;
    params.push(...authorIds);
  } else if (authorIds) {
    sql += ` AND 0=1`;
  }

  sql += ` ORDER BY p.title ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await db.all(sql, params);

  // Load full author and category details for each product
  for (const p of rows) {
    p.stockPolicy = p.stock_policy;
    delete p.stock_policy;

    p.categories = await db.all(`
      SELECT c.id, c.name
      FROM categories c
      JOIN product_categories pc ON pc.category_id = c.id
      WHERE pc.product_id = ?
    `, [p.id]);

    p.authors = await db.all(`
      SELECT a.id, a.name
      FROM authors a
      JOIN product_authors pa ON pa.author_id = a.id
      WHERE pa.product_id = ?
    `, [p.id]);
  }

  return rows;
}

module.exports = {
  createProduct,
  updateProduct,
  deleteProduct,
  findById,
  findByCode,
  getAll
};
