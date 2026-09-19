const express = require('express');
const router = express.Router();
const outletsService = require('./outletsService');
const outletTypesService = require('../outlet-types/outletTypesService');
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

function withoutAccountLink(outlet) {
  if (!outlet) return outlet;
  const sanitized = { ...outlet };
  delete sanitized.userId;
  delete sanitized.linked_username;
  return sanitized;
}

// 1. GET /api/outlets/governorates - Fetch unique governorates
router.get('/governorates', requireAuth, checkPermission('outlets.view'), async (req, res) => {
  try {
    const db = require('../../db');
    const rows = await db.all(`
      SELECT DISTINCT governorate 
      FROM outlets 
      WHERE governorate IS NOT NULL AND governorate != '' 
      ORDER BY governorate ASC
    `);
    const governorates = rows.map(r => r.governorate);
    res.status(200).json(governorates);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/outlets - Paginated outlet list with search, governorate, and outlet type filters
router.get('/', requireAuth, checkPermission('outlets.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';
  const governorate = req.query.governorate || '';
  const outletTypeId = req.query.outletTypeId ? parseInt(req.query.outletTypeId, 10) : null;
  const status = req.query.status || '';

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    let filterUserId = null;
    if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (roleNames.includes('outlet') || linkedOutlets.length > 0) {
        filterUserId = userId;
      }
    }

    const outlets = await outletsService.getAll({ limit, offset, search, governorate, outletTypeId, status, userId: filterUserId });
    res.status(200).json(hasAccountReadPermission(req, 'outlets.account_link') ? outlets : outlets.map(withoutAccountLink));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/outlets/:id - Fetch single outlet details
router.get('/:id', requireAuth, checkPermission('outlets.view'), async (req, res) => {
  const { id } = req.params;
  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if ((roleNames.includes('outlet') || linkedOutlets.length > 0) && !linkedOutlets.includes(parseInt(id, 10))) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permission to view this outlet.'
        });
      }
    }

    const outlet = await outletsService.findById(id);
    if (!outlet) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet not found.' });
    }
    res.status(200).json(hasAccountReadPermission(req, 'outlets.account_link') ? outlet : withoutAccountLink(outlet));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2.5 GET /api/outlets/:id/details - Fetch detailed report of books, invoices, and summaries for an outlet
router.get('/:id/details', requireAuth, checkPermission('outlets.view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Outlet ID is required.' });
  }

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const roleNames = userRoles.map(role => role.name);
    const isElevated = hasGlobalBusinessScope(roleNames);

    if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if ((roleNames.includes('outlet') || linkedOutlets.length > 0) && !linkedOutlets.includes(id)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permission to view this outlet.'
        });
      }
    }

    const report = await outletsService.getOutletDetailsReport(id);
    if (!report) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet not found.' });
    }

    if (!hasAccountReadPermission(req, 'outlets.account_link') && report.outlet) {
      report.outlet = withoutAccountLink(report.outlet);
    }
    res.status(200).json(report);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/outlets - Create a new outlet
router.post('/', requireAuth, checkPermission('outlets.create'), requireAccountLinkPermission('outlets.account_link', 'an outlet'), auditLog('create_outlet', 'outlets'), async (req, res) => {
  const { name, outletTypeId, governorate, addressDetails = '', phone = '', creditLimit = 0, status = 'active', notes = '', code = '' } = req.body;
  let userId;

  if (!name || !outletTypeId || !governorate) {
    return res.status(400).json({ error: 'Bad Request', message: 'Name, outlet type ID, and governorate are required.' });
  }

  try {
    // Validate that outlet type exists and is active
    const ot = await outletTypesService.findById(outletTypeId);
    if (!ot) {
      return res.status(400).json({ error: 'Bad Request', message: 'The specified outlet type does not exist.' });
    }
    if (ot.status !== 'active') {
      return res.status(400).json({ error: 'Bad Request', message: 'The specified outlet type is inactive.' });
    }

    userId = normalizeUserId(req.body.userId);
    await validateActiveUser(userId, usersService);

    const newOutlet = await outletsService.createOutlet({
      name,
      outletTypeId,
      governorate,
      addressDetails,
      phone,
      creditLimit,
      status,
      notes,
      userId,
      code
    });

    res.status(201).json({
      success: true,
      message: 'Outlet created successfully.',
      outlet: hasAccountReadPermission(req, 'outlets.account_link')
        ? newOutlet
        : withoutAccountLink(newOutlet)
    });
  } catch (err) {
    if (sendError(res, err)) return;
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/outlets/:id - Edit an outlet
router.put('/:id', requireAuth, checkPermission('outlets.update'), requireAccountLinkPermission('outlets.account_link', 'an outlet'), auditLog('update_outlet', 'outlets'), async (req, res) => {
  const { id } = req.params;
  const { name, outletTypeId, governorate, addressDetails = '', phone = '', creditLimit = 0, status = 'active', notes = '', code = '' } = req.body;
  let userId;

  if (!name || !outletTypeId || !governorate) {
    return res.status(400).json({ error: 'Bad Request', message: 'Name, outlet type ID, and governorate are required.' });
  }

  try {
    const existingOutlet = await outletsService.findById(id);
    if (!existingOutlet) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet not found.' });
    }

    // Validate outlet type
    const ot = await outletTypesService.findById(outletTypeId);
    if (!ot) {
      return res.status(400).json({ error: 'Bad Request', message: 'The specified outlet type does not exist.' });
    }

    userId = normalizeUserId(req.body.userId);
    await validateActiveUser(userId, usersService);

    await outletsService.updateOutlet(id, {
      name,
      outletTypeId,
      governorate,
      addressDetails,
      phone,
      creditLimit,
      status,
      notes,
      userId,
      code
    });

    const updated = await outletsService.findById(id);
    res.status(200).json({
      success: true,
      message: 'Outlet updated successfully.',
      outlet: hasAccountReadPermission(req, 'outlets.account_link') ? updated : withoutAccountLink(updated)
    });
  } catch (err) {
    if (sendError(res, err)) return;
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. PUT /api/outlets/:id/status - Explicitly enable or disable outlet
router.put('/:id/status', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['active', 'disabled'].includes(status)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid status value.' });
  }

  try {
    const outlet = await outletsService.findById(id);
    if (!outlet) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet not found.' });
    }

    // Evaluate permissions check dynamically
    let requiredPerm = 'outlets.update';
    if (status === 'disabled') requiredPerm = 'outlets.disable';

    const usersService = require('../users/usersService');
    const currentUserPermissions = await usersService.getUserPermissions(req.session.user.id);
    const superAdminCheck = await usersService.getUserRoles(req.session.user.id);
    const isSuperAdmin = superAdminCheck.map(r => r.name).includes('super_admin');

    if (!currentUserPermissions.includes(requiredPerm) && !isSuperAdmin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. You do not have the required permission: '${requiredPerm}' to perform this status update.`
      });
    }

    await outletsService.updateStatus(id, status);

    // Audit log the status update
    const auditService = require('../audit/auditService');
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    await auditService.log({
      userId: req.session.user.id,
      action: status === 'disabled' ? 'disable_outlet' : 'enable_outlet',
      targetType: 'outlets',
      targetId: id,
      details: { status },
      ipAddress
    });

    res.status(200).json({
      success: true,
      message: `Outlet status updated to '${status}' successfully.`
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 6. DELETE /api/outlets/:id - Delete an outlet
router.delete('/:id', requireAuth, checkPermission('outlets.delete'), auditLog('delete_outlet', 'outlets'), async (req, res) => {
  const { id } = req.params;
  try {
    const existingOutlet = await outletsService.findById(id);
    if (!existingOutlet) {
      return res.status(404).json({ error: 'Not Found', message: 'Outlet not found.' });
    }

    const db = require('../../db');
    const invoiceCheck = await db.get(`
      SELECT (
        (SELECT COUNT(*) FROM invoices WHERE outlet_id = ?) +
        (SELECT COUNT(*) FROM invoice_trash WHERE outlet_id = ?)
      ) AS count
    `, [id, id]);
    if (invoiceCheck && invoiceCheck.count > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'لا يمكن حذف هذا المنفذ لوجود فواتير مسجلة عليه.'
      });
    }

    await outletsService.deleteOutlet(id);
    res.status(200).json({
      success: true,
      message: 'Outlet deleted successfully.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
