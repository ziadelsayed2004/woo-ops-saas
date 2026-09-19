const express = require('express');
const router = express.Router();
const productsService = require('./productsService');
const authorsService = require('../authors/authorsService');
const usersService = require('../users/usersService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/products/categories - Fetch unique categories
router.get('/categories', requireAuth, checkPermission('products.view'), async (req, res) => {
  try {
    const db = require('../../db');
    const rows = await db.all(`
      SELECT name 
      FROM categories 
      ORDER BY name ASC
    `);
    const categories = rows.map(r => r.name);
    res.status(200).json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/products - List all products (with pagination, search, category, status, and author scoping)
router.get('/', requireAuth, checkPermission('products.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';
  const category = req.query.category || '';
  const status = req.query.status || '';
  const authorId = req.query.authorId ? parseInt(req.query.authorId, 10) : null;

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isAuthor = userRoles.some(r => r.name === 'author');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    let filterAuthorIds = null;
    if (isAuthor && !isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if (authorId !== null) {
        if (linkedAuthors.includes(authorId)) {
          filterAuthorIds = [authorId];
        } else {
          filterAuthorIds = [];
        }
      } else {
        filterAuthorIds = linkedAuthors;
      }
    } else if (!isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if (linkedAuthors.length > 0) {
        if (authorId !== null) {
          if (linkedAuthors.includes(authorId)) {
            filterAuthorIds = [authorId];
          } else {
            filterAuthorIds = [];
          }
        } else {
          filterAuthorIds = linkedAuthors;
        }
      } else {
        if (authorId !== null) {
          filterAuthorIds = [authorId];
        }
      }
    } else {
      if (authorId !== null) {
        filterAuthorIds = [authorId];
      }
    }

    const list = await productsService.getAll({
      limit,
      offset,
      search,
      category,
      status,
      authorIds: filterAuthorIds
    });

    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/products/:id - Fetch details of a single product
router.get('/:id', requireAuth, checkPermission('products.view'), async (req, res) => {
  const productId = parseInt(req.params.id, 10);

  try {
    const product = await productsService.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found.' });
    }

    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isAuthor = userRoles.some(r => r.name === 'author');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    if (!isElevated) {
      if (isAuthor) {
        const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
        const productAuthorIds = product.authors.map(a => a.id);
        const hasOwnership = productAuthorIds.some(aid => linkedAuthors.includes(aid));
        if (!hasOwnership) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this product.'
          });
        }
      } else {
        const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
        if (linkedAuthors.length > 0) {
          const productAuthorIds = product.authors.map(a => a.id);
          const hasOwnership = productAuthorIds.some(aid => linkedAuthors.includes(aid));
          if (!hasOwnership) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'Access denied. You do not have permission to view other authors books.'
            });
          }
        }
      }
    }

    res.status(200).json(product);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/products - Create a new product (with SKU validation)
router.post('/', requireAuth, checkPermission('products.create'), auditLog('create_product', 'products'), async (req, res) => {
  const { title, code, category = '', status = 'active', stockPolicy = 'track', authorIds = [], categoryIds = [] } = req.body;

  if (!title || !code) {
    return res.status(400).json({ error: 'Bad Request', message: 'Title and code are required.' });
  }

  try {
    const existing = await productsService.findByCode(code);
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'A product with this SKU/code already exists.' });
    }

    const newProduct = await productsService.createProduct({
      title,
      code,
      category,
      status,
      stockPolicy,
      authorIds,
      categoryIds
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: newProduct
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/products/:id - Edit a product
router.put('/:id', requireAuth, checkPermission('products.update'), auditLog('update_product', 'products'), async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  const { title, code, category = '', status = 'active', stockPolicy = 'track', authorIds = [], categoryIds = [] } = req.body;

  if (!title || !code) {
    return res.status(400).json({ error: 'Bad Request', message: 'Title and code are required.' });
  }

  try {
    const existingProduct = await productsService.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found.' });
    }

    // SKU conflict check
    const existingCode = await productsService.findByCode(code);
    if (existingCode && existingCode.id !== productId) {
      return res.status(409).json({ error: 'Conflict', message: 'A product with this SKU/code already exists.' });
    }

    await productsService.updateProduct(productId, {
      title,
      code,
      category,
      status,
      stockPolicy,
      authorIds,
      categoryIds
    });

    const updatedProduct = await productsService.findById(productId);

    res.status(200).json({
      success: true,
      message: 'Product updated successfully.',
      product: updatedProduct
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. DELETE /api/products/:id - Delete a product
router.delete('/:id', requireAuth, checkPermission('products.delete'), auditLog('delete_product', 'products'), async (req, res) => {
  const productId = parseInt(req.params.id, 10);

  try {
    const existingProduct = await productsService.findById(productId);
    if (!existingProduct) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found.' });
    }

    const deleted = await productsService.deleteProduct(productId);
    if (!deleted) {
      return res.status(400).json({ error: 'Bad Request', message: 'Failed to delete product.' });
    }

    res.status(200).json({
      success: true,
      message: 'Product deleted successfully.'
    });
  } catch (err) {
    // If SQLITE_CONSTRAINT foreign key error, return a clean bad request error
    if (err.message && err.message.includes('FOREIGN KEY')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'This product cannot be deleted because it is referenced in transactions or invoices.'
      });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
