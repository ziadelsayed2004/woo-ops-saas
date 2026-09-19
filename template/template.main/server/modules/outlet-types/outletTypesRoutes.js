const express = require('express');
const router = express.Router();
const outletTypesService = require('./outletTypesService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/outlet-types - Fetch all outlet types
router.get('/', requireAuth, checkPermission('outlet_types.view'), async (req, res) => {
  const includeDisabled = req.query.includeDisabled !== 'false';
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  
  try {
    const list = await outletTypesService.getAll({ limit, offset, includeDisabled });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/outlet-types/:id - Fetch single outlet type details
router.get('/:id', requireAuth, checkPermission('outlet_types.view'), async (req, res) => {
  const { id } = req.params;
  try {
    const item = await outletTypesService.findById(id);
    if (!item) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet type not found.' });
    }
    res.status(200).json(item);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/outlet-types - Create a new outlet type
router.post('/', requireAuth, checkPermission('outlet_types.create'), auditLog('create_outlet_type', 'outlet_types'), async (req, res) => {
  const { name, description = '', status = 'active' } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Outlet type name is required.' });
  }

  try {
    // Check if name is taken
    const existing = await outletTypesService.findByName(name);
    if (existing) {
      return res.status(409).json({ error: 'Conflict', message: 'An outlet type with this name already exists.' });
    }

    const newItem = await outletTypesService.createOutletType({ name, description, status });
    res.status(201).json({
      success: true,
      message: 'Outlet type created successfully.',
      outletType: newItem
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/outlet-types/:id - Edit an outlet type
router.put('/:id', requireAuth, checkPermission('outlet_types.update'), auditLog('update_outlet_type', 'outlet_types'), async (req, res) => {
  const { id } = req.params;
  const { name, description = '', status = 'active' } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Bad Request', message: 'Outlet type name is required.' });
  }

  try {
    const item = await outletTypesService.findById(id);
    if (!item) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet type not found.' });
    }

    // Check conflict with other records
    const existing = await outletTypesService.findByName(name);
    if (existing && existing.id !== parseInt(id, 10)) {
      return res.status(409).json({ error: 'Conflict', message: 'An outlet type with this name already exists.' });
    }

    await outletTypesService.updateOutletType(id, { name, description, status });
    const updated = await outletTypesService.findById(id);

    res.status(200).json({
      success: true,
      message: 'Outlet type updated successfully.',
      outletType: updated
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. DELETE /api/outlet-types/:id - Delete an outlet type
router.delete('/:id', requireAuth, checkPermission('outlet_types.delete'), auditLog('delete_outlet_type', 'outlet_types'), async (req, res) => {
  const { id } = req.params;
  try {
    const existingType = await outletTypesService.findById(id);
    if (!existingType) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet type not found.' });
    }

    const db = require('../../db');
    const outletCheck = await db.get('SELECT COUNT(*) as count FROM outlets WHERE outlet_type_id = ?', [id]);
    if (outletCheck && outletCheck.count > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'لا يمكن حذف فئة المنفذ لوجود منافذ توزيع مسجلة تحتها.'
      });
    }

    await outletTypesService.deleteOutletType(id);
    res.status(200).json({
      success: true,
      message: 'Outlet type deleted successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
