const express = require('express');
const router = express.Router();
const invoicesService = require('./invoicesService');
const invoiceTrashService = require('./invoiceTrashService');
const paymentsService = require('../payments/paymentsService');
const pdfService = require('./pdfService');
const usersService = require('../users/usersService');
const authorsService = require('../authors/authorsService');
const outletsService = require('../outlets/outletsService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { getInvoiceVisibilityScope, isInvoiceVisible } = require('./invoiceAccessPolicy');
const { presentInvoice, presentInvoices, roleMode } = require('./invoicePresenter');
const { requireAuth, checkPermission, requireSuperAdmin } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

const CREATE_PAYMENT_FIELDS = Object.freeze([
  'paymentType',
  'paymentMethod',
  'paymentAmount',
  'paymentSupplyStatus',
  'paymentNotes',
  'paymentReceiptName',
  'paymentReceiptData'
]);

function requestContainsPaymentFields(body) {
  return CREATE_PAYMENT_FIELDS.some(field => Object.prototype.hasOwnProperty.call(body, field));
}

function sendPaymentPermissionForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: "Access denied. You do not have the required permission: 'invoices.pay'.",
    requiredPermission: 'invoices.pay'
  });
}

function sendSupplyPermissionForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: "Access denied. You do not have the required permission: 'payments.mark_supplied'.",
    requiredPermission: 'payments.mark_supplied'
  });
}

function redactInvoicePaymentDetails(invoice) {
  if (!invoice) return invoice;
  delete invoice.payments;
  if (Array.isArray(invoice.history)) {
    invoice.history = invoice.history.filter(entry => entry.status_type !== 'payment');
  }
  return invoice;
}

async function getLinkedInvoiceScope(userId, userRoles) {
  const roleNames = userRoles.map(role => role.name);
  if (hasGlobalBusinessScope(roleNames)) return { global: true };

  const [linkedAuthorIds, linkedOutletIds] = await Promise.all([
    authorsService.getLinkedAuthorsForUser(userId),
    outletsService.getLinkedOutletsForUser(userId)
  ]);
  return {
    global: false,
    isAuthor: roleNames.includes('author'),
    isOutlet: roleNames.includes('outlet'),
    linkedAuthorIds,
    linkedOutletIds
  };
}

function isInvoiceWithinLinkedScope(invoice, scope) {
  if (!scope || scope.global) return true;

  if (scope.isOutlet) {
    if (!scope.linkedOutletIds.includes(invoice.outlet_id)) return false;
  } else if (scope.linkedOutletIds.length > 0 && !scope.linkedOutletIds.includes(invoice.outlet_id)) {
    return false;
  }

  const invoiceAuthorIds = Array.isArray(invoice.author_ids) ? invoice.author_ids : [];
  if (scope.isAuthor) {
    if (scope.linkedAuthorIds.length === 0) return false;
    if (!invoiceAuthorIds.some(authorId => scope.linkedAuthorIds.includes(authorId))) return false;
  } else if (
    scope.linkedAuthorIds.length > 0 &&
    !invoiceAuthorIds.some(authorId => scope.linkedAuthorIds.includes(authorId))
  ) {
    return false;
  }

  return true;
}

function sendInvoiceVisibilityForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'Access denied. You do not have permission to view this invoice.'
  });
}

function requestIp(req) {
  return req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;
}

function sendInvoiceTrashError(res, error) {
  const status = error.status || 500;
  return res.status(status).json({
    error: status === 404 ? 'Not Found' : status === 409 ? 'Conflict' : status === 403 ? 'Forbidden' : status === 400 ? 'Bad Request' : 'Internal Server Error',
    message: error.message,
    code: error.code
  });
}

// 1. GET /api/invoices - List and filter invoices
router.get('/', requireAuth, checkPermission('invoices.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';
  const productId = req.query.productId ? parseInt(req.query.productId, 10) : null;
  const authorId = req.query.authorId ? parseInt(req.query.authorId, 10) : null;
  const outletId = req.query.outletId ? parseInt(req.query.outletId, 10) : null;
  const outletTypeId = req.query.outletTypeId ? parseInt(req.query.outletTypeId, 10) : null;
  const governorate = req.query.governorate || '';
  const paymentStatus = req.query.paymentStatus || '';
  const shippingStatus = req.query.shippingStatus || '';
  const startDate = req.query.startDate || '';
  const endDate = req.query.endDate || '';
  const hasRemaining = req.query.hasRemaining || '';
  const minRemaining = req.query.minRemaining !== undefined ? parseFloat(req.query.minRemaining) : null;
  const maxRemaining = req.query.maxRemaining !== undefined ? parseFloat(req.query.maxRemaining) : null;
  const archived = req.query.archived === 'true';

  try {
    const userId = req.session.user.id;
    const permissions = await usersService.getUserPermissions(userId);
    const requestedFinancialFilter = paymentStatus || hasRemaining || minRemaining !== null || maxRemaining !== null;
    if (requestedFinancialFilter && !permissions.includes('payments.view')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Payment visibility permission is required to filter invoices by financial fields.'
      });
    }
    if (archived && !permissions.includes('invoices.archive.view') && !permissions.includes('invoices.archive')) {
      return res.status(403).json({ error: 'Forbidden', message: 'Archive permission is required.' });
    }
    const userRoles = await usersService.getUserRoles(userId);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    const isAuthor = userRoles.some(r => r.name === 'author');
    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    let filterAuthorIds = null;
    let filterOutletIds = null;

    if (!isElevated) {
      if (isAuthor) {
        filterAuthorIds = await authorsService.getLinkedAuthorsForUser(userId);
      } else {
        const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
        if (linkedAuthors.length > 0) {
          filterAuthorIds = linkedAuthors;
        }
      }

      if (isOutlet) {
        filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
      } else {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (linkedOutlets.length > 0) {
          filterOutletIds = linkedOutlets;
        }
      }
    }

    const list = await invoicesService.getInvoices({
      limit,
      offset,
      search,
      productId,
      authorId,
      outletId,
      outletTypeId,
      governorate,
      paymentStatus,
      shippingStatus,
      startDate,
      endDate,
      hasRemaining,
      minRemaining,
      maxRemaining,
      authorIds: filterAuthorIds,
      outletIds: filterOutletIds,
      allowedShippingStatuses: visibilityScope.allowedShippingStatuses,
      excludeCancelled: visibilityScope.excludeCancelled,
      archived
    });
    res.status(200).json(await presentInvoices(list, {
      roleNames: userRoles.map(role => role.name),
      userId
    }));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

router.get('/trash', requireAuth, requireSuperAdmin, checkPermission('invoices.trash'), async (req, res) => {
  try {
    const result = await invoiceTrashService.getTrashedInvoices({
      limit: req.query.limit,
      offset: req.query.offset,
      search: req.query.search || ''
    });
    return res.status(200).json(result);
  } catch (error) {
    return sendInvoiceTrashError(res, error);
  }
});

router.get('/trash/:id', requireAuth, requireSuperAdmin, checkPermission('invoices.trash'), async (req, res) => {
  try {
    const invoice = await invoiceTrashService.getTrashedInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Not Found', message: 'Trashed invoice was not found.' });
    return res.status(200).json(invoice);
  } catch (error) {
    return sendInvoiceTrashError(res, error);
  }
});

// 2. GET /api/invoices/:id - Retrieve invoice details by ID
router.get('/:id', requireAuth, checkPermission('invoices.view'), async (req, res) => {
  const invoiceId = parseInt(req.params.id, 10);

  try {
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      return res.status(400).json({ error: 'Bad Request', message: 'Valid Invoice ID is required.' });
    }

    const userId = req.session.user.id;
    const permissions = await usersService.getUserPermissions(userId);
    const canViewPayments = permissions.includes('payments.view');
    const invoice = await invoicesService.getInvoiceById(invoiceId, { includePayments: canViewPayments });
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'Invoice not found.' });
    }

    if (invoice.archived_at && !permissions.includes('invoices.archive.view') && !permissions.includes('invoices.archive')) {
      return sendInvoiceVisibilityForbidden(res);
    }

    const userRoles = await usersService.getUserRoles(userId);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    if (!isInvoiceVisible(invoice, visibilityScope)) {
      return sendInvoiceVisibilityForbidden(res);
    }

    const isAuthor = userRoles.some(r => r.name === 'author');
    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    if (!isElevated) {
      if (isOutlet) {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (!linkedOutlets.includes(invoice.outlet_id)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this invoice.'
          });
        }
      } else {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (linkedOutlets.length > 0 && !linkedOutlets.includes(invoice.outlet_id)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this invoice.'
          });
        }
      }

      if (isAuthor) {
        const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
        if (linkedAuthors.length === 0) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this invoice.'
          });
        }
        const invoiceItems = invoice.items || [];
        const db = require('../../db');
        const authorBooks = await db.all(`
          SELECT product_id FROM product_authors WHERE author_id IN (${linkedAuthors.map(() => '?').join(',')})
        `, linkedAuthors);
        const authorBookIds = authorBooks.map(b => b.product_id);
        const hasAuthorBook = invoiceItems.some(item => authorBookIds.includes(item.product_id));
        if (!hasAuthorBook) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this invoice.'
          });
        }
        // Filter items containing own products
        invoice.items = invoiceItems.filter(item => authorBookIds.includes(item.product_id));
      } else {
        const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
        if (linkedAuthors.length > 0) {
          const invoiceItems = invoice.items || [];
          const db = require('../../db');
          const authorBooks = await db.all(`
            SELECT product_id FROM product_authors WHERE author_id IN (${linkedAuthors.map(() => '?').join(',')})
          `, linkedAuthors);
          const authorBookIds = authorBooks.map(b => b.product_id);
          const hasAuthorBook = invoiceItems.some(item => authorBookIds.includes(item.product_id));
          if (!hasAuthorBook) {
            return res.status(403).json({
              error: 'Forbidden',
              message: 'Access denied. You do not have permission to view this invoice.'
            });
          }
          // Filter items containing own products
          invoice.items = invoiceItems.filter(item => authorBookIds.includes(item.product_id));
        }
      }
    }

    if (!canViewPayments) redactInvoicePaymentDetails(invoice);
    res.status(200).json(await presentInvoice(invoice, {
      roleNames: userRoles.map(role => role.name),
      userId
    }));
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/invoices - Create a new invoice
router.post('/', requireAuth, checkPermission('invoices.create'), auditLog('create_invoice', 'invoices'), async (req, res) => {
  const {
    invoiceNumber = '',
    outletId,
    discount = 0,
    shippingCost = 0,
    paymentType = 'cash',
    paymentMethod = 'cash',
    notes = '',
    items = [],
    paymentAmount = 0,
    paymentSupplyStatus = 'not_supplied',
    paymentNotes = '',
    paymentReceiptName = '',
    paymentReceiptData = ''
  } = req.body;

  if (!outletId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Outlet ID and items are required.' });
  }

  try {
    const userId = req.session.user.id;
    const permissions = await usersService.getUserPermissions(userId);
    const canPayInvoices = permissions.includes('invoices.pay');
    const canViewPayments = permissions.includes('payments.view');
    if (requestContainsPaymentFields(req.body) && !canPayInvoices) {
      return sendPaymentPermissionForbidden(res);
    }
    if (paymentSupplyStatus === 'supplied' && !permissions.includes('payments.mark_supplied')) {
      return sendSupplyPermissionForbidden(res);
    }

    const invoice = await invoicesService.createInvoice({
      invoiceNumber,
      outletId,
      discount,
      shippingCost,
      paymentType,
      notes,
      items,
      userId,
      paymentAmount,
      paymentMethod,
      paymentSupplyStatus,
      paymentNotes,
      paymentReceiptName,
      paymentReceiptData
    });

    if (!canViewPayments) redactInvoicePaymentDetails(invoice);

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully.',
      invoice
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('inactive')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    if (msg.includes('required') || msg.includes('insufficient') || msg.includes('غير كافٍ') || msg.includes('not exist') || msg.includes('not active') || msg.includes('negative') || msg.includes('no price') || msg.includes('exceeds') || msg.includes('reserved')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

async function validateBulkInvoiceAccess(req, res, invoiceIds, { requireArchived = null } = {}) {
  const userId = req.session.user.id;
  const userRoles = await usersService.getUserRoles(userId);
  const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
  const linkedScope = await getLinkedInvoiceScope(userId, userRoles);
  const invoices = await invoicesService.getInvoiceVisibilityRecords(invoiceIds);
  const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));

  for (const invoiceId of invoiceIds) {
    const invoice = invoiceMap.get(invoiceId);
    if (!invoice) {
      res.status(404).json({ error: 'Not Found', message: `Invoice with ID ${invoiceId} does not exist.` });
      return null;
    }
    if (!isInvoiceVisible(invoice, visibilityScope) || !isInvoiceWithinLinkedScope(invoice, linkedScope)) {
      sendInvoiceVisibilityForbidden(res);
      return null;
    }
    if (requireArchived === true && !invoice.archived_at) {
      res.status(400).json({ error: 'Bad Request', message: `Invoice with ID ${invoiceId} is not archived.` });
      return null;
    }
    if (requireArchived === false && invoice.archived_at) {
      res.status(400).json({ error: 'Bad Request', message: `Invoice with ID ${invoiceId} is archived.` });
      return null;
    }
  }
  return invoices;
}

function normalizeInvoiceIdsInput(req, res) {
  const { invoiceIds } = req.body;
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must be a non-empty array.' });
    return null;
  }
  const normalized = invoiceIds.map(Number);
  if (normalized.some(id => !Number.isInteger(id) || id <= 0) || new Set(normalized).size !== normalized.length) {
    res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must be unique positive integers.' });
    return null;
  }
  return normalized;
}

router.put('/bulk/undo-latest-shipment', requireAuth, checkPermission('invoices.ship'), auditLog('bulk_undo_latest_shipment', 'invoices'), async (req, res) => {
  const invoiceIds = normalizeInvoiceIdsInput(req, res);
  if (!invoiceIds) return;
  try {
    if (!await validateBulkInvoiceAccess(req, res, invoiceIds, { requireArchived: false })) return;
    await invoicesService.bulkUndoLatestShipment({ invoiceIds, userId: req.session.user.id });
    return res.status(200).json({ success: true, message: 'Latest shipment was undone for selected invoices.' });
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }
});

router.put('/bulk/archive', requireAuth, checkPermission('invoices.archive'), auditLog('bulk_archive_invoices', 'invoices'), async (req, res) => {
  const invoiceIds = normalizeInvoiceIdsInput(req, res);
  if (!invoiceIds) return;
  try {
    if (!await validateBulkInvoiceAccess(req, res, invoiceIds, { requireArchived: false })) return;
    await invoicesService.bulkSetArchiveStatus({ invoiceIds, archived: true, userId: req.session.user.id });
    return res.status(200).json({ success: true, message: 'Selected invoices were archived.' });
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }
});

router.put('/bulk/restore', requireAuth, checkPermission('invoices.archive'), auditLog('bulk_restore_invoices', 'invoices'), async (req, res) => {
  const invoiceIds = normalizeInvoiceIdsInput(req, res);
  if (!invoiceIds) return;
  try {
    if (!await validateBulkInvoiceAccess(req, res, invoiceIds, { requireArchived: true })) return;
    await invoicesService.bulkSetArchiveStatus({ invoiceIds, archived: false, userId: req.session.user.id });
    return res.status(200).json({ success: true, message: 'Selected invoices were restored.' });
  } catch (error) {
    return res.status(400).json({ error: 'Bad Request', message: error.message });
  }
});

router.put('/bulk/trash', requireAuth, requireSuperAdmin, checkPermission('invoices.trash'), async (req, res) => {
  try {
    const invoiceIds = invoiceTrashService.normalizeInvoiceIds(req.body.invoiceIds);
    await invoiceTrashService.trashInvoices({
      invoiceIds,
      userId: req.session.user.id,
      ipAddress: requestIp(req)
    });
    return res.status(200).json({ success: true, message: 'Selected invoices were moved to trash.' });
  } catch (error) {
    return sendInvoiceTrashError(res, error);
  }
});

router.put('/bulk/restore-from-trash', requireAuth, requireSuperAdmin, checkPermission('invoices.trash'), async (req, res) => {
  try {
    const invoiceIds = invoiceTrashService.normalizeInvoiceIds(req.body.invoiceIds);
    await invoiceTrashService.restoreTrashedInvoices({
      invoiceIds,
      userId: req.session.user.id,
      ipAddress: requestIp(req)
    });
    return res.status(200).json({ success: true, message: 'Selected invoices were restored from trash.' });
  } catch (error) {
    return sendInvoiceTrashError(res, error);
  }
});

router.post('/trash/permanent-delete', requireAuth, requireSuperAdmin, checkPermission('invoices.trash'), async (req, res) => {
  if (req.body.confirmation !== 'حذف نهائي') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Type "حذف نهائي" to confirm permanent deletion.'
    });
  }
  try {
    const invoiceIds = invoiceTrashService.normalizeInvoiceIds(req.body.invoiceIds);
    await invoiceTrashService.permanentlyDeleteTrashedInvoices({
      invoiceIds,
      userId: req.session.user.id,
      ipAddress: requestIp(req)
    });
    return res.status(200).json({ success: true, message: 'Selected invoices were permanently deleted.' });
  } catch (error) {
    return sendInvoiceTrashError(res, error);
  }
});

// 9. PUT /api/invoices/bulk/shipping-status - Bulk update shipping status
router.put('/bulk/shipping-status', requireAuth, checkPermission('invoices.ship'), auditLog('bulk_update_shipping_status', 'invoices'), async (req, res) => {
  const { invoiceIds, shippingStatus = 'shipped' } = req.body;
  if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must be a non-empty array.' });
  }
  const normalizedInvoiceIds = invoiceIds.map(Number);
  if (normalizedInvoiceIds.some(id => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must contain positive integers only.' });
  }
  if (new Set(normalizedInvoiceIds).size !== normalizedInvoiceIds.length) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must not contain duplicates.' });
  }
  if (shippingStatus !== 'shipped') {
    return res.status(400).json({ error: 'Bad Request', message: 'Bulk shipping only supports the shipped status.' });
  }

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    const linkedScope = await getLinkedInvoiceScope(userId, userRoles);
    const invoices = await invoicesService.getInvoiceVisibilityRecords(normalizedInvoiceIds);
    const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));

    for (const invoiceId of normalizedInvoiceIds) {
      const invoice = invoiceMap.get(invoiceId);
      if (!invoice) {
        return res.status(404).json({ error: 'Not Found', message: `Invoice with ID ${invoiceId} does not exist.` });
      }
      if (!isInvoiceVisible(invoice, visibilityScope) || !isInvoiceWithinLinkedScope(invoice, linkedScope)) {
        return sendInvoiceVisibilityForbidden(res);
      }
    }

    await invoicesService.bulkUpdateShippingStatus({
      invoiceIds: normalizedInvoiceIds,
      shippingStatus,
      userId
    });
    res.status(200).json({
      success: true,
      message: 'Shipping status updated successfully for selected invoices.'
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (
      msg.includes('invalid shipping status') ||
      msg.includes('positive integers') ||
      msg.includes('duplicates') ||
      msg.includes('cannot update shipping') ||
      msg.includes('unable to derive shipping status') ||
      msg.includes('المخزون') ||
      msg.includes('كاف') ||
      msg.includes('exceeds') ||
      msg.includes('insufficient') ||
      msg.includes('available shipping quantity') ||
      err.code === 'INSUFFICIENT_STOCK'
    ) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PUT /api/invoices/:id - Update an existing invoice
router.put('/:id', requireAuth, checkPermission('invoices.update'), auditLog('update_invoice', 'invoices'), async (req, res) => {
  const invoiceId = parseInt(req.params.id, 10);
  const { outletId, discount = 0, shippingCost = 0, notes = '', items = [] } = req.body;

  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Valid Invoice ID is required.' });
  }
  if (!outletId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Outlet ID and items are required.' });
  }

  try {
    const userId = req.session.user.id;
    const permissions = await usersService.getUserPermissions(userId);
    const canPayInvoices = permissions.includes('invoices.pay');
    const canViewPayments = permissions.includes('payments.view');
    const existingInvoice = await invoicesService.getInvoiceById(invoiceId, { includePayments: false });
    if (!existingInvoice) {
      return res.status(404).json({ error: 'Not Found', message: `Invoice with ID ${invoiceId} does not exist` });
    }

    const paymentTypeWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'paymentType');
    const paymentType = paymentTypeWasProvided ? req.body.paymentType : existingInvoice.payment_type;
    if (paymentTypeWasProvided && paymentType !== existingInvoice.payment_type && !canPayInvoices) {
      return sendPaymentPermissionForbidden(res);
    }

    const invoice = await invoicesService.updateInvoice(invoiceId, {
      outletId,
      discount,
      shippingCost,
      paymentType,
      notes,
      items,
      userId
    });

    if (!canViewPayments) redactInvoicePaymentDetails(invoice);

    res.status(200).json({
      success: true,
      message: 'Invoice updated successfully.',
      invoice
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('required') || msg.includes('insufficient') || msg.includes('غير كافٍ') || msg.includes('not active') || msg.includes('negative') || msg.includes('no price')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. GET /api/invoices/:id/payments - Get payments list for a specific invoice
router.get('/:id/payments', requireAuth, checkPermission('payments.view'), async (req, res) => {
  const invoiceId = Number(req.params.id);

  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invoice ID must be a positive integer.'
    });
  }

  try {
    const userRoles = await usersService.getUserRoles(req.session.user.id);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    const [invoice] = await invoicesService.getInvoiceVisibilityRecords([invoiceId]);
    if (!invoice) {
      return res.status(404).json({ error: 'Not Found', message: 'Invoice not found.' });
    }
    if (roleMode(userRoles.map(role => role.name)) === 'author' || roleMode(userRoles.map(role => role.name)) === 'shipping') {
      return sendInvoiceVisibilityForbidden(res);
    }
    if (!isInvoiceVisible(invoice, visibilityScope)) {
      return sendInvoiceVisibilityForbidden(res);
    }
    const linkedScope = await getLinkedInvoiceScope(req.session.user.id, userRoles);
    if (!isInvoiceWithinLinkedScope(invoice, linkedScope)) {
      return sendInvoiceVisibilityForbidden(res);
    }

    const list = await paymentsService.getPayments({ invoiceId });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 7. POST /api/invoices/export/pdf - Export selected invoices to a unified PDF report
router.post('/export/pdf', requireAuth, checkPermission('invoices.export'), async (req, res) => {
  const { invoiceIds } = req.body;
  if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice IDs must be a non-empty array.' });
  }

  const normalizedInvoiceIds = invoiceIds.map(invoiceId => Number(invoiceId));
  if (normalizedInvoiceIds.some(invoiceId => !Number.isInteger(invoiceId) || invoiceId <= 0)) {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invoice IDs must contain positive integers only.'
    });
  }

  const uniqueInvoiceIds = [...new Set(normalizedInvoiceIds)];

  try {
    const permissions = await usersService.getUserPermissions(req.session.user.id);
    const userRoles = await usersService.getUserRoles(req.session.user.id);
    const visibilityScope = getInvoiceVisibilityScope(userRoles.map(role => role.name));
    const invoices = await invoicesService.getInvoiceVisibilityRecords(uniqueInvoiceIds);

    if (invoices.some(invoice => invoice.archived_at) && !permissions.includes('invoices.archive.view') && !permissions.includes('invoices.archive')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Archive permission is required to export archived invoices.'
      });
    }

    if (
      visibilityScope.restricted &&
      (invoices.length !== uniqueInvoiceIds.length ||
        invoices.some(invoice => !isInvoiceVisible(invoice, visibilityScope)))
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. One or more selected invoices cannot be exported.'
      });
    }

    const linkedScope = await getLinkedInvoiceScope(req.session.user.id, userRoles);
    if (
      !linkedScope.global &&
      (invoices.length !== uniqueInvoiceIds.length ||
        invoices.some(invoice => !isInvoiceWithinLinkedScope(invoice, linkedScope)))
    ) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied. One or more selected invoices cannot be exported.'
      });
    }

    if (invoices.length !== uniqueInvoiceIds.length) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'One or more selected invoices were not found.'
      });
    }

    const pdfBuffer = await pdfService.generateInvoicesPdf(uniqueInvoiceIds, {
      mode: roleMode(userRoles.map(role => role.name)),
      userId: req.session.user.id
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices_report.pdf"');
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    if (err.message.includes('No invoices found') || err.message.includes('non-empty array')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    console.error('PDF Generation Error:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 8. POST /api/invoices/:id/cancel - Cancel an invoice
router.post('/:id/cancel', requireAuth, checkPermission('invoices.cancel'), auditLog('cancel_invoice', 'invoices'), async (req, res) => {
  const invoiceId = parseInt(req.params.id, 10);

  try {
    const userId = req.session.user.id;
    const invoice = await invoicesService.cancelInvoice(invoiceId, userId);
    res.status(200).json({
      success: true,
      message: 'Invoice cancelled successfully.',
      invoice
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('already cancelled')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
