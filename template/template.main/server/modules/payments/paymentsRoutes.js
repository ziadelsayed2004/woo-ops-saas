const express = require('express');
const router = express.Router();
const paymentsService = require('./paymentsService');
const paymentMethodsService = require('./paymentMethodsService');
const db = require('../../db');
const outletsService = require('../outlets/outletsService');
const authorsService = require('../authors/authorsService');
const usersService = require('../users/usersService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { getInvoiceVisibilityScope, isInvoiceVisible } = require('../invoices/invoiceAccessPolicy');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

async function requireReceiptUploadPermission(req, res, next) {
  if (!req.body.receiptData && !req.body.receiptName) return next();

  try {
    const permissions = await usersService.getUserPermissions(req.session.user.id);
    if (!permissions.includes('payments.receipt.upload')) {
      return res.status(403).json({
        error: 'Forbidden',
        message: "Access denied. You do not have the required permission: 'payments.receipt.upload'.",
        requiredPermission: 'payments.receipt.upload'
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

async function requirePermission(permission, req, res) {
  const permissions = await usersService.getUserPermissions(req.session.user.id);
  if (permissions.includes(permission)) return true;
  res.status(403).json({
    error: 'Forbidden',
    message: `Access denied. You do not have the required permission: '${permission}'.`,
    requiredPermission: permission
  });
  return false;
}

async function requireSuppliedPaymentReversePermission(req, res, next) {
  try {
    const payment = await paymentsService.getPaymentById(parseInt(req.params.id, 10));
    if (!payment || payment.supply_status !== 'supplied') return next();
    if (await requirePermission('payments.supply.reverse', req, res)) return next();
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
}

async function canViewPaymentInvoice(req, invoiceId) {
  const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return false;
  const userId = req.session.user.id;
  const roles = await usersService.getUserRoles(userId);
  const roleNames = roles.map(role => role.name);
  if (!isInvoiceVisible(invoice, getInvoiceVisibilityScope(roleNames))) return false;

  if (!hasGlobalBusinessScope(roleNames)) {
    const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
    if (linkedOutlets.length > 0 && !linkedOutlets.includes(invoice.outlet_id)) return false;
    const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
    if (linkedAuthors.length > 0) {
      const match = await db.get(`
        SELECT 1 FROM invoice_items ii
        JOIN product_authors pa ON pa.product_id = ii.product_id
        WHERE ii.invoice_id = ? AND pa.author_id IN (${linkedAuthors.map(() => '?').join(',')}) LIMIT 1
      `, [invoiceId, ...linkedAuthors]);
      if (!match) return false;
    }
  }
  return true;
}

// 1. GET /api/payments - List and filter payments
router.get('/', requireAuth, checkPermission('payments.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const invoiceId = req.query.invoiceId ? parseInt(req.query.invoiceId, 10) : null;
  const supplyStatus = req.query.supplyStatus || '';
  const paymentMethod = req.query.paymentMethod || '';
  const startDate = req.query.startDate || '';
  const endDate = req.query.endDate || '';

  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    let filterOutletIds = null;
    const queryOutletId = req.query.outletId ? parseInt(req.query.outletId, 10) : null;
    if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (queryOutletId) {
        filterOutletIds = linkedOutlets.includes(queryOutletId) ? [queryOutletId] : [0];
      } else {
        filterOutletIds = linkedOutlets.length > 0 ? linkedOutlets : null;
      }
    } else if (queryOutletId) {
      filterOutletIds = [queryOutletId];
    }

    const list = await paymentsService.getPayments({ limit, offset, invoiceId, outletIds: filterOutletIds, supplyStatus, paymentMethod, startDate, endDate });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. POST /api/payments - Record a payment
router.post('/', requireAuth, checkPermission('payments.create'), requireReceiptUploadPermission, auditLog('create_payment', 'payments'), async (req, res) => {
  const { invoiceId, amount, paymentMethod, paymentDate, referenceNumber = '', notes = '', supplyStatus = 'not_supplied', receiptName, receiptData } = req.body;

  if (!invoiceId || amount === undefined || !paymentMethod) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invoice ID, amount, and payment method are required.' });
  }

  try {
    if (supplyStatus === 'supplied' && !(await requirePermission('payments.mark_supplied', req, res))) {
      return;
    }
    const userId = req.session.user.id;
    const payment = await paymentsService.recordPayment({
      invoiceId,
      amount,
      paymentMethod,
      paymentDate,
      referenceNumber,
      notes,
      supplyStatus,
      userId,
      receiptName,
      receiptData
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully.',
      payment
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('required') || msg.includes('positive') || msg.includes('exceeds') || msg.includes('fully paid') || msg.includes('supply status') || msg.includes('inactive') || msg.includes('file type') || msg.includes('size exceeds')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/payments/:id/reverse - Reverse/cancel a payment
router.post('/:id/reverse', requireAuth, checkPermission('payments.reverse'), requireSuppliedPaymentReversePermission, auditLog('reverse_payment', 'payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  const notes = String(req.body.notes || '').trim();

  try {
    const userId = req.session.user.id;
    const result = await paymentsService.reversePayment(paymentId, { notes, userId });
    res.status(200).json({
      success: true,
      message: 'Payment reversed successfully.',
      ...result
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('approved') || msg.includes('cancelled') || msg.includes('archived') || msg.includes('already supplied')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. POST /api/payments/:id/supply - Mark a single payment as supplied
router.post('/:id/supply', requireAuth, checkPermission('payments.mark_supplied'), auditLog('supply_payment', 'payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  try {
    const userId = req.session.user.id;
    const result = await paymentsService.supplyPayments({ paymentIds: [paymentId], userId });
    res.status(200).json({
      success: true,
      message: 'Payment marked as supplied successfully.',
      ...result
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('approved') || msg.includes('cancelled') || msg.includes('archived') || msg.includes('already supplied')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. POST /api/payments/supply-batch - Mark multiple payments as supplied
router.post('/supply-batch', requireAuth, checkPermission('payments.supply_batch'), auditLog('supply_payments_batch', 'payments'), async (req, res) => {
  const { paymentIds } = req.body;
  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'paymentIds array is required.' });
  }
  try {
    const userId = req.session.user.id;
    const result = await paymentsService.supplyPayments({ paymentIds, userId });
    res.status(200).json({
      success: true,
      message: 'Batch payments marked as supplied successfully.',
      ...result
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('approved') || msg.includes('cancelled') || msg.includes('archived') || msg.includes('already supplied')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// Amount-based supply: preview and confirm are owner-only via the dedicated permission.
router.get('/supply-amount/preview', requireAuth, checkPermission('payments.supply.amount'), async (req, res) => {
  const amount = parseFloat(req.query.amount);
  const outletId = req.query.outletId ? parseInt(req.query.outletId, 10) : null;
  try {
    res.json(await paymentsService.previewAmountSupply({ amount, outletId }));
  } catch (err) {
    res.status(400).json({ error: 'Bad Request', message: err.message });
  }
});

router.post('/supply-amount', requireAuth, checkPermission('payments.supply.amount'), auditLog('supply_amount', 'payment_supply_batches'), async (req, res) => {
  const { amount, outletId = null, selectedPaymentIds, expectedVersion } = req.body;
  try {
    const result = await paymentsService.supplyAmount({ amount, outletId: outletId ? parseInt(outletId, 10) : null, selectedPaymentIds, expectedVersion, userId: req.session.user.id });
    res.status(200).json({ success: true, message: 'Amount supplied successfully.', ...result });
  } catch (err) {
    const status = /stale|choose|positive|complete-payment/i.test(err.message) ? 409 : 400;
    res.status(status).json({ error: status === 409 ? 'Conflict' : 'Bad Request', message: err.message });
  }
});

// Auditable supply-operation history.
router.get('/supply-batches', requireAuth, checkPermission('payments.view'), async (req, res) => {
  try {
    const batches = await paymentsService.getSupplyBatches({
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 50,
      offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
      outletId: req.query.outletId ? parseInt(req.query.outletId, 10) : null,
      status: req.query.status || '',
      startDate: req.query.startDate || '',
      endDate: req.query.endDate || ''
    });
    res.json(batches);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

router.get('/supply-batches/:batchId', requireAuth, checkPermission('payments.view'), async (req, res) => {
  try {
    const batch = await paymentsService.getSupplyBatchById(parseInt(req.params.batchId, 10));
    if (!batch) return res.status(404).json({ error: 'Not Found', message: 'Supply operation does not exist.' });
    res.json(batch);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

router.post('/supply-batches/:batchId/reverse', requireAuth, checkPermission('payments.supply.reverse'), auditLog('reverse_supply_batch', 'payment_supply_batches'), async (req, res) => {
  const notes = String(req.body.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'Bad Request', message: 'A reversal reason is required.' });
  try {
    const result = await paymentsService.reverseSupplyBatch(parseInt(req.params.batchId, 10), { notes, userId: req.session.user.id });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = /does not exist|already reversed|no active/i.test(err.message) ? 409 : 400;
    res.status(status).json({ error: status === 409 ? 'Conflict' : 'Bad Request', message: err.message });
  }
});

router.post('/supply-batches/:batchId/items/:paymentId/reverse', requireAuth, checkPermission('payments.supply.reverse'), auditLog('reverse_supply_item', 'payment_supply_batch_items'), async (req, res) => {
  const notes = String(req.body.notes || '').trim();
  if (!notes) return res.status(400).json({ error: 'Bad Request', message: 'A reversal reason is required.' });
  try {
    const result = await paymentsService.reversePaymentSupply(parseInt(req.params.paymentId, 10), { notes, userId: req.session.user.id });
    if (Number(result.batchId) !== Number(req.params.batchId)) return res.status(409).json({ error: 'Conflict', message: 'Payment does not belong to this supply operation.' });
    res.json({ success: true, ...result });
  } catch (err) {
    const status = /does not exist|not supplied|not found|already/i.test(err.message) ? 409 : 400;
    res.status(status).json({ error: status === 409 ? 'Conflict' : 'Bad Request', message: err.message });
  }
});

// 6. POST /api/payments/:id/reverse-supply - Reverse supply status of a payment
router.post('/:id/reverse-supply', requireAuth, checkPermission('payments.supply.reverse'), auditLog('reverse_supply_payment', 'payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  const { notes = '' } = req.body;
  if (!String(notes).trim()) return res.status(400).json({ error: 'Bad Request', message: 'A reversal reason is required.' });
  try {
    const userId = req.session.user.id;
    const result = await paymentsService.reversePaymentSupply(paymentId, { notes, userId });
    res.status(200).json({
      success: true,
      message: 'Payment supply reversed successfully.',
      ...result
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('not supplied')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 7. GET /api/payments/invoice/:invoiceId/metrics - Fetch metrics for a specific invoice
router.get('/invoice/:invoiceId/metrics', requireAuth, checkPermission('payments.view'), async (req, res) => {
  const invoiceId = parseInt(req.params.invoiceId, 10);

  try {
    const metrics = await paymentsService.getPaymentMetrics(invoiceId);
    if (!metrics) {
      return res.status(404).json({ error: 'Not Found', message: 'Invoice not found.' });
    }
    res.status(200).json(metrics);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 8. GET /api/payments/receipts/review-queue - Get review queue
router.get('/receipts/review-queue', requireAuth, checkPermission('payments.receipt.review'), async (req, res) => {
  const status = req.query.status || 'pending_review';
  const outletId = req.query.outletId ? parseInt(req.query.outletId, 10) : null;
  const invoiceId = req.query.invoiceId ? parseInt(req.query.invoiceId, 10) : null;
  const recordedBy = req.query.recordedBy ? parseInt(req.query.recordedBy, 10) : null;
  const startDate = req.query.startDate || '';
  const endDate = req.query.endDate || '';
  const minAmount = req.query.minAmount ? parseFloat(req.query.minAmount) : null;
  const maxAmount = req.query.maxAmount ? parseFloat(req.query.maxAmount) : null;

  try {
    const list = await paymentsService.getReviewQueue({ 
      status, 
      outletId, 
      invoiceId,
      recordedBy,
      startDate,
      endDate,
      minAmount,
      maxAmount
    });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 9. GET /api/payments/:id/receipt - Download receipt file
router.get('/:id/receipt', requireAuth, checkPermission('payments.receipt.view'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  try {
    const payment = await paymentsService.getPaymentById(paymentId);
    if (!payment || !payment.receipt_stored_path) {
      return res.status(404).json({ error: 'Not Found', message: 'Receipt not found for this payment.' });
    }
    if (!(await canViewPaymentInvoice(req, payment.invoice_id))) {
      return res.status(403).json({ error: 'Forbidden', message: 'You are not allowed to view this invoice receipt.' });
    }

    const fs = require('fs');
    if (!fs.existsSync(payment.receipt_stored_path)) {
      return res.status(404).json({ error: 'Not Found', message: 'Receipt file not found on disk.' });
    }

    res.setHeader('Content-Type', payment.receipt_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(payment.receipt_original_name)}"`);
    fs.createReadStream(payment.receipt_stored_path).pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 10. POST /api/payments/:id/review - Review receipt
router.post('/:id/review', requireAuth, checkPermission('payments.receipt.review'), auditLog('review_payment_receipt', 'payments'), async (req, res) => {
  const paymentId = parseInt(req.params.id, 10);
  const { action, notes = '' } = req.body;

  if (!action || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Action must be "approve" or "reject".' });
  }

  try {
    const userId = req.session.user.id;
    const result = await paymentsService.reviewPaymentReceipt(paymentId, { action, notes, userId });
    res.status(200).json({
      success: true,
      message: `Payment receipt ${action}d successfully.`,
      payment: result
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('already')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// ──── Payment Methods Management ────

// GET /api/payments/methods - Get active payment methods (for dropdown)
router.get('/methods', requireAuth, async (req, res) => {
  try {
    const methods = await paymentMethodsService.getActivePaymentMethods();
    res.status(200).json(methods);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// GET /api/payments/methods/all - Get all payment methods (admin)
router.get('/methods/all', requireAuth, checkPermission('payments.methods.manage'), async (req, res) => {
  try {
    const methods = await paymentMethodsService.getAllPaymentMethods();
    res.status(200).json(methods);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// POST /api/payments/methods - Create a new payment method
router.post('/methods', requireAuth, checkPermission('payments.methods.manage'), auditLog('create_payment_method', 'payment_methods'), async (req, res) => {
  const { key, labelAr, labelEn, sortOrder } = req.body;
  if (!key || !labelAr) {
    return res.status(400).json({ error: 'Bad Request', message: 'key and labelAr are required.' });
  }
  try {
    const method = await paymentMethodsService.createPaymentMethod({ key, labelAr, labelEn, sortOrder });
    res.status(201).json({ success: true, message: 'تم إنشاء طريقة الدفع بنجاح.', method });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('already exists') || msg.includes('required') || msg.includes('must start')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// PUT /api/payments/methods/:id - Update a payment method
router.put('/methods/:id', requireAuth, checkPermission('payments.methods.manage'), auditLog('update_payment_method', 'payment_methods'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { labelAr, labelEn, isActive, sortOrder } = req.body;
  try {
    const method = await paymentMethodsService.updatePaymentMethod(id, { labelAr, labelEn, isActive, sortOrder });
    res.status(200).json({ success: true, message: 'تم تحديث طريقة الدفع بنجاح.', method });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// PATCH /api/payments/methods/:id/toggle - Toggle active status
router.patch('/methods/:id/toggle', requireAuth, checkPermission('payments.methods.manage'), auditLog('toggle_payment_method', 'payment_methods'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { isActive } = req.body;
  if (isActive === undefined) {
    return res.status(400).json({ error: 'Bad Request', message: 'isActive is required.' });
  }
  try {
    const method = await paymentMethodsService.togglePaymentMethod(id, isActive);
    res.status(200).json({ success: true, message: isActive ? 'تم تفعيل طريقة الدفع.' : 'تم تعطيل طريقة الدفع.', method });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// DELETE /api/payments/methods/:id - Delete a payment method (only if unused)
router.delete('/methods/:id', requireAuth, checkPermission('payments.methods.manage'), auditLog('delete_payment_method', 'payment_methods'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await paymentMethodsService.deletePaymentMethod(id);
    res.status(200).json({ success: true, message: 'تم حذف طريقة الدفع بنجاح.', ...result });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    if (msg.includes('لا يمكن حذف') || msg.includes('مرتبطة')) {
      return res.status(409).json({ error: 'Conflict', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
