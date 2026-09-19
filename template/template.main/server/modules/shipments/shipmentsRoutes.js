const express = require('express');
const router = express.Router();
const shipmentsService = require('./shipmentsService');
const outletsService = require('../outlets/outletsService');
const usersService = require('../users/usersService');
const invoicesService = require('../invoices/invoicesService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { getInvoiceVisibilityScope, isInvoiceVisible } = require('../invoices/invoiceAccessPolicy');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

function hasGlobalOperationalScope(userRoles) {
  return hasGlobalBusinessScope(userRoles.map(role => role.name));
}

function canViewShipmentPrices(userRoles) {
  const roleNames = userRoles.map(role => role.name);
  if (!roleNames.includes('shipping_user')) return true;
  return roleNames.some(roleName => ['super_admin', 'assistant', 'readonly_viewer', 'outlet'].includes(roleName));
}

function presentShipment(shipment, userRoles) {
  if (!shipment || canViewShipmentPrices(userRoles)) return shipment;
  return {
    ...shipment,
    items: Array.isArray(shipment.items)
      ? shipment.items.map(({ unit_price: _unitPrice, total_price: _totalPrice, ...item }) => item)
      : shipment.items
  };
}

async function canAccessOutlet(userId, userRoles, outletId) {
  if (hasGlobalOperationalScope(userRoles)) return true;

  const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
  const isOutlet = userRoles.some(role => role.name === 'outlet');
  if (isOutlet) return linkedOutlets.includes(outletId);
  return linkedOutlets.length === 0 || linkedOutlets.includes(outletId);
}

async function getVisibleInvoiceForShipment(userId, invoiceId) {
  const userRoles = await usersService.getUserRoles(userId);
  const [invoice] = await invoicesService.getInvoiceVisibilityRecords([invoiceId]);
  if (!invoice) return { status: 404, invoice: null };

  const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
  if (!isInvoiceVisible(invoice, visibilityScope)) return { status: 403, invoice };
  if (!(await canAccessOutlet(userId, userRoles, invoice.outlet_id))) {
    return { status: 403, invoice };
  }

  return { status: 200, invoice };
}

function sendInvoiceAccessError(res, status) {
  if (status === 404) {
    return res.status(404).json({ error: 'Not Found', message: 'Invoice not found.' });
  }
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Access denied. You do not have permission to ship this invoice.'
  });
}

// 1. GET /api/shipments - List and filter shipments
router.get('/', requireAuth, checkPermission('shipments.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const invoiceId = req.query.invoiceId ? parseInt(req.query.invoiceId, 10) : null;
  const status = req.query.status || null;

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isOutlet = userRoles.some(role => role.name === 'outlet');
    const isElevated = hasGlobalOperationalScope(userRoles);

    let filterOutletIds = null;
    if (isOutlet && !isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
    } else if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (linkedOutlets.length > 0) filterOutletIds = linkedOutlets;
    }

    const list = await shipmentsService.getShipments({
      limit,
      offset,
      invoiceId,
      status,
      outletIds: filterOutletIds
    });
    return res.status(200).json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/shipments/invoice/:invoiceId/remaining
// The static prefix must be registered before /:id.
router.get('/invoice/:invoiceId/remaining', requireAuth, checkPermission('shipments.view'), async (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Invoice ID is required.' });
  }

  try {
    const access = await getVisibleInvoiceForShipment(req.session.user.id, invoiceId);
    if (access.status !== 200) return sendInvoiceAccessError(res, access.status);

    const items = await shipmentsService.getRemainingShippableItems(invoiceId);
    return res.status(200).json(items);
  } catch (err) {
    if (err.message.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. GET /api/shipments/:id - Fetch specific shipment by ID
router.get('/:id', requireAuth, checkPermission('shipments.view'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Shipment ID is required.' });
  }

  try {
    const shipment = await shipmentsService.getShipmentById(id);
    if (!shipment) {
      return res.status(404).json({ error: 'Not Found', message: `Shipment with ID ${id} does not exist.` });
    }

    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    if (!hasGlobalOperationalScope(userRoles)) {
      const invoice = await invoicesService.getInvoiceById(shipment.invoice_id, { includePayments: false });
      if (!invoice || !(await canAccessOutlet(userId, userRoles, invoice.outlet_id))) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied. You do not have permission to view this shipment.'
        });
      }
    }

    return res.status(200).json(presentShipment(shipment, userRoles));
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. POST /api/shipments - Create a new shipment
router.post('/', requireAuth, checkPermission('shipments.create'), auditLog('create_shipment', 'shipments'), async (req, res) => {
  const { invoiceId, shippingCarrier = '', trackingNumber = '', items = [] } = req.body;
  const normalizedInvoiceId = Number(invoiceId);

  if (!Number.isInteger(normalizedInvoiceId) || normalizedInvoiceId <= 0 || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice ID and at least one item are required.' });
  }

  try {
    const userId = req.session.user.id;
    const access = await getVisibleInvoiceForShipment(userId, normalizedInvoiceId);
    if (access.status !== 200) return sendInvoiceAccessError(res, access.status);

    const shipment = await shipmentsService.createShipment({
      invoiceId: normalizedInvoiceId,
      shippingCarrier,
      trackingNumber,
      items,
      userId
    });

    return res.status(201).json({
      success: true,
      message: 'Shipment created successfully.',
      shipment: presentShipment(shipment, await usersService.getUserRoles(userId))
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (
      msg.includes('required') ||
      msg.includes('positive') ||
      msg.includes('exceeds') ||
      msg.includes('cannot create') ||
      msg.includes('insufficient') ||
      err.code === 'INSUFFICIENT_STOCK'
    ) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. POST /api/shipments/:id/status - Update shipment status
router.post('/:id/status', requireAuth, checkPermission('shipments.update'), auditLog('update_shipment_status', 'shipments'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status, notes = '' } = req.body;

  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Shipment ID is required.' });
  }
  if (!status) {
    return res.status(400).json({ error: 'Bad Request', message: 'Status is required.' });
  }

  try {
    const userId = req.session.user.id;
    const shipment = await shipmentsService.updateShipmentStatus(id, { status, notes, userId });
    const userRoles = await usersService.getUserRoles(userId);

    return res.status(200).json({
      success: true,
      message: 'Shipment status updated successfully.',
      shipment: presentShipment(shipment, userRoles)
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('invalid status') || msg.includes('invalid shipment status transition')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
module.exports.presentShipment = presentShipment;
