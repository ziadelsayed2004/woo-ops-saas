const express = require('express');
const router = express.Router();
const authorsService = require('./authorsService');
const usersService = require('../users/usersService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');
const {
  hasAccountReadPermission,
  normalizeUserId,
  validateActiveUser,
  requireAccountLinkPermission,
  sendError
} = require('../users/accountLink');

function withoutAccountLink(author) {
  if (!author) return author;
  const sanitized = { ...author };
  delete sanitized.userId;
  delete sanitized.linked_username;
  return sanitized;
}

// 1. GET /api/authors - Fetch authors (supports pagination, search, status, book filter, and scoped user checking)
router.get('/', requireAuth, checkPermission('authors.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';
  const status = req.query.status || '';
  const productId = req.query.productId ? parseInt(req.query.productId, 10) : null;

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    let filterUserId = null;
    if (!isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if (roleNames.includes('author') || linkedAuthors.length > 0) {
        filterUserId = userId;
      }
    }

    const list = await authorsService.getAll({ limit, offset, search, status, userId: filterUserId, productId });
    res.status(200).json(hasAccountReadPermission(req, 'authors.account_link') ? list : list.map(withoutAccountLink));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/authors/:id - Fetch details of a single author
router.get('/:id', requireAuth, checkPermission('authors.view'), async (req, res) => {
  const authorId = parseInt(req.params.id, 10);

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    if (!isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if ((roleNames.includes('author') || linkedAuthors.length > 0) && !linkedAuthors.includes(authorId)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permission to view other author profiles.'
        });
      }
    }

    const author = await authorsService.findById(authorId);
    if (!author) {
      return res.status(404).json({ error: 'Not Found', message: 'Author not found.' });
    }
    res.status(200).json(hasAccountReadPermission(req, 'authors.account_link') ? author : withoutAccountLink(author));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/authors - Create a new author
router.post('/', requireAuth, checkPermission('authors.create'), requireAccountLinkPermission('authors.account_link', 'an author'), auditLog('create_author', 'authors'), async (req, res) => {
  const { name, phone = '', status = 'active' } = req.body;
  let userId;

  if (!name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Author name is required.' });
  }
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid author status.' });
  }

  try {
    userId = normalizeUserId(req.body.userId);
    await validateActiveUser(userId, usersService);

    const newAuthor = await authorsService.createAuthor({ name, phone, status, userId });
    res.status(201).json({
      success: true,
      message: 'Author created successfully.',
      author: hasAccountReadPermission(req, 'authors.account_link')
        ? newAuthor
        : withoutAccountLink(newAuthor)
    });
  } catch (err) {
    if (sendError(res, err)) return;
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/authors/:id - Update an existing author
router.put('/:id', requireAuth, checkPermission('authors.update'), requireAccountLinkPermission('authors.account_link', 'an author'), auditLog('update_author', 'authors'), async (req, res) => {
  const authorId = parseInt(req.params.id, 10);
  const { name, phone = '', status = 'active' } = req.body;
  let userId;

  if (!name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Author name is required.' });
  }
  if (!['active', 'inactive'].includes(status)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid author status.' });
  }

  try {
    const existingAuthor = await authorsService.findById(authorId);
    if (!existingAuthor) {
      return res.status(404).json({ error: 'Not Found', message: 'Author not found.' });
    }

    userId = normalizeUserId(req.body.userId);
    await validateActiveUser(userId, usersService);

    await authorsService.updateAuthor(authorId, { name, phone, status, userId });
    const updatedAuthor = await authorsService.findById(authorId);

    res.status(200).json({
      success: true,
      message: 'Author updated successfully.',
      author: hasAccountReadPermission(req, 'authors.account_link') ? updatedAuthor : withoutAccountLink(updatedAuthor)
    });
  } catch (err) {
    if (sendError(res, err)) return;
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. GET /api/authors/:id/books - Fetch books associated with this author
router.get('/:id/books', requireAuth, checkPermission('authors.view'), async (req, res) => {
  const authorId = parseInt(req.params.id, 10);

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    if (!isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if ((roleNames.includes('author') || linkedAuthors.length > 0) && !linkedAuthors.includes(authorId)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permission to view other authors books.'
        });
      }
    }

    const books = await authorsService.getBooksByAuthor(authorId);
    res.status(200).json(books);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 6. DELETE /api/authors/:id - Delete an author
router.delete('/:id', requireAuth, checkPermission('authors.delete'), auditLog('delete_author', 'authors'), async (req, res) => {
  const authorId = parseInt(req.params.id, 10);
  try {
    const existingAuthor = await authorsService.findById(authorId);
    if (!existingAuthor) {
      return res.status(404).json({ error: 'Not Found', message: 'Author not found.' });
    }

    const db = require('../../db');
    const bookCheck = await db.get('SELECT COUNT(*) as count FROM product_authors WHERE author_id = ?', [authorId]);
    if (bookCheck && bookCheck.count > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'لا يمكن حذف هذا المؤلف لوجود كتب مرتبطة به. يرجى إزالة الارتباط بالكتب أولاً.'
      });
    }

    await authorsService.deleteAuthor(authorId);
    res.status(200).json({
      success: true,
      message: 'Author deleted successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
