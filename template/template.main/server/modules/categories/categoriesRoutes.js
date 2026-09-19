const express = require('express');
const router = express.Router();
const categoriesService = require('./categoriesService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/categories - List all categories
router.get('/', requireAuth, checkPermission('categories.view'), async (req, res) => {
  try {
    const list = await categoriesService.getAllCategories();
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/categories/:id - Get a category by ID
router.get('/:id', requireAuth, checkPermission('categories.view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const category = await categoriesService.getCategoryById(id);
    if (!category) {
      return res.status(404).json({ error: 'Not Found', message: 'Category not found.' });
    }
    res.status(200).json(category);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/categories - Create a category
router.post('/', requireAuth, checkPermission('categories.create'), auditLog('create_category', 'categories'), async (req, res) => {
  const { name, description = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bad Request', message: 'Category name is required.' });
  }

  try {
    const newCategory = await categoriesService.createCategory({ name, description });
    res.status(201).json({
      success: true,
      message: 'Category created successfully.',
      category: newCategory
    });
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      return res.status(409).json({ error: 'Conflict', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/categories/:id - Update a category
router.put('/:id', requireAuth, checkPermission('categories.update'), auditLog('update_category', 'categories'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, description = '' } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Bad Request', message: 'Category name is required.' });
  }

  try {
    const updated = await categoriesService.updateCategory(id, { name, description });
    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: 'Category not found.' });
    }
    const category = await categoriesService.getCategoryById(id);
    res.status(200).json({
      success: true,
      message: 'Category updated successfully.',
      category
    });
  } catch (err) {
    if (err.message && err.message.includes('already exists')) {
      return res.status(409).json({ error: 'Conflict', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. DELETE /api/categories/:id - Delete a category
router.delete('/:id', requireAuth, checkPermission('categories.delete'), auditLog('delete_category', 'categories'), async (req, res) => {
  const id = parseInt(req.params.id, 10);

  try {
    const deleted = await categoriesService.deleteCategory(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: 'Category not found.' });
    }
    res.status(200).json({
      success: true,
      message: 'Category deleted successfully.'
    });
  } catch (err) {
    if (err.message && err.message.includes('FOREIGN KEY')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'This category cannot be deleted because it is linked to books.'
      });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
