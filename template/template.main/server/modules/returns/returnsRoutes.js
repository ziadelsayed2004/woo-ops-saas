const express = require('express');
const router = express.Router();
const returnsService = require('./returnsService');
const outletsService = require('../outlets/outletsService');
const usersService = require('../users/usersService');
const { getInvoiceVisibilityScope } = require('../invoices/invoiceAccessPolicy');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

function sendRestrictedInvoiceRoleForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Access denied. This role is limited to incomplete invoices.'
  });
}

// 1. GET /api/returns - List and filter returns
router.get('/', requireAuth, checkPermission('returns.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const invoiceId = req.query.invoiceId ? parseInt(req.query.invoiceId, 10) : null;
  const outletId = req.query.outletId ? parseInt(req.query.outletId, 10) : null;

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    if (visibilityScope.restricted) {
      return sendRestrictedInvoiceRoleForbidden(res);
    }

    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = userRoles.some(r => ['super_admin', 'assistant', 'readonly_viewer'].includes(r.name));

    let filterOutletIds = null;
    if (isOutlet && !isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
    } else if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (linkedOutlets.length > 0) {
        filterOutletIds = linkedOutlets;
      }
    }

    const list = await returnsService.getReturns({ limit, offset, invoiceId, outletId, outletIds: filterOutletIds });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/returns/:id - Fetch specific return by ID
router.get('/:id', requireAuth, checkPermission('returns.view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Return ID is required.' });
  }

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    if (visibilityScope.restricted) {
      return sendRestrictedInvoiceRoleForbidden(res);
    }

    const ret = await returnsService.getReturnById(id);
    if (!ret) {
      return res.status(404).json({ error: 'Not Found', message: `Return with ID ${id} does not exist.` });
    }

    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = userRoles.some(r => ['super_admin', 'assistant', 'readonly_viewer'].includes(r.name));

    if (!isElevated) {
      if (isOutlet) {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (!linkedOutlets.includes(ret.outlet_id)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this return.'
          });
        }
      } else {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (linkedOutlets.length > 0 && !linkedOutlets.includes(ret.outlet_id)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this return.'
          });
        }
      }
    }

    res.status(200).json(ret);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/returns - Create a new return
router.post('/', requireAuth, checkPermission('returns.create'), auditLog('create_return', 'returns'), async (req, res) => {
  const { invoiceId, reason = '', items = [] } = req.body;

  if (!invoiceId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice ID and at least one item are required.' });
  }

  try {
    const userId = req.session.user.id;
    const ret = await returnsService.createReturn({
      invoiceId,
      reason,
      items,
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Return created successfully.',
      return: ret
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('required') || msg.includes('positive') || msg.includes('exceeds') || msg.includes('cannot return')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
