const express = require('express');
const router = express.Router();
const inventoryService = require('./inventoryService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/inventory/stock-summary - List stock levels for active products
router.get('/stock-summary', requireAuth, checkPermission('inventory.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const search = req.query.search || '';

  try {
    const summary = await inventoryService.getStockSummary({ limit, offset, search });
    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/inventory/transactions - Retrieve ledger transaction log
router.get('/transactions', requireAuth, checkPermission('inventory.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const productId = req.query.productId ? parseInt(req.query.productId, 10) : null;
  const transactionType = req.query.transactionType || '';

  try {
    const transactions = await inventoryService.getTransactions({ limit, offset, productId, transactionType });
    res.status(200).json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/inventory/adjustments - Record a stock adjustment
router.post('/adjustments', requireAuth, checkPermission('inventory.adjustments.create'), auditLog('create_inventory_adjustment', 'inventory'), async (req, res) => {
  const { reason, notes = '', items = [] } = req.body;

  if (!reason || !items || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Reason and items array are required.' });
  }

  try {
    const userId = req.session.user.id;
    const adjustment = await inventoryService.createAdjustment({
      reason,
      notes,
      items,
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Stock adjustment recorded successfully.',
      adjustment
    });
  } catch (err) {
    if (err.message && (err.message.includes('required') || err.message.includes('invalid') || err.message.includes('does not exist'))) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. POST /api/inventory/opening-balance - Record opening stock balance for a book
router.post('/opening-balance', requireAuth, checkPermission('inventory.adjustments.create'), auditLog('create_opening_balance', 'inventory'), async (req, res) => {
  const { productId, quantity } = req.body;

  if (!productId || quantity === undefined) {
    return res.status(400).json({ error: 'Bad Request', message: 'productId and quantity are required.' });
  }

  try {
    const userId = req.session.user.id;
    
    // Check if the product already has transactions
    const existing = await inventoryService.getTransactions({ productId, limit: 1 });
    if (existing && existing.length > 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Opening balance can only be set when no prior transactions exist for this product.'
      });
    }

    const adjustment = await inventoryService.createAdjustment({
      reason: 'Opening Balance',
      notes: 'Initial opening stock balance setup.',
      items: [{ productId, quantity }],
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Opening balance setup successfully.',
      adjustment
    });
  } catch (err) {
    if (err.message && (err.message.includes('required') || err.message.includes('invalid') || err.message.includes('does not exist'))) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. GET /api/inventory/receipts - Retrieve list of receipts
router.get('/receipts', requireAuth, checkPermission('inventory.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const status = req.query.status || '';

  try {
    const list = await inventoryService.getReceipts({ limit, offset, status });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 6. GET /api/inventory/receipts/:id - Retrieve receipt details with items
router.get('/receipts/:id', requireAuth, checkPermission('inventory.view'), async (req, res) => {
  const receiptId = parseInt(req.params.id, 10);

  try {
    const receipt = await inventoryService.getReceiptDetails(receiptId);
    if (!receipt) {
      return res.status(404).json({ error: 'Not Found', message: 'Receipt not found.' });
    }
    res.status(200).json(receipt);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 7. POST /api/inventory/receipts - Create a new inventory receipt
router.post('/receipts', requireAuth, checkPermission('inventory.receipts.create'), auditLog('create_inventory_receipt', 'inventory'), async (req, res) => {
  const { supplierName = '', receivedDate, notes = '', items = [] } = req.body;

  if (!receivedDate || !items || items.length === 0) {
    return res.status(400).json({ error: 'Bad Request', message: 'Received date and items are required.' });
  }

  try {
    const userId = req.session.user.id;
    const receipt = await inventoryService.createReceipt({
      supplierName,
      receivedDate,
      notes,
      items,
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Inventory receipt logged successfully.',
      receipt
    });
  } catch (err) {
    if (err.message && (err.message.includes('required') || err.message.includes('positive') || err.message.includes('does not exist'))) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 8. POST /api/inventory/receipts/:id/cancel - Cancel an active receipt, even if stock becomes negative
router.post('/receipts/:id/cancel', requireAuth, checkPermission('inventory.receipts.reverse'), auditLog('cancel_inventory_receipt', 'inventory'), async (req, res) => {
  const receiptId = parseInt(req.params.id, 10);
  try {
    const receipt = await inventoryService.cancelReceipt(receiptId, {
      reason: req.body.reason,
      userId: req.session.user.id
    });
    res.status(200).json({ success: true, message: 'Inventory receipt cancelled successfully.', receipt });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: 'Bad Request', message: err.message });
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 9. POST /api/inventory/receipts/:id/returns - Record a supplier return
router.post('/receipts/:id/returns', requireAuth, checkPermission('inventory.receipts.reverse'), auditLog('create_inventory_receipt_return', 'inventory'), async (req, res) => {
  const receiptId = parseInt(req.params.id, 10);
  const { returnDate = '', reason = '', notes = '', items = [] } = req.body;
  try {
    const receipt = await inventoryService.createSupplierReturn(receiptId, {
      returnDate,
      reason,
      notes,
      items,
      userId: req.session.user.id
    });
    res.status(201).json({ success: true, message: 'Supplier return recorded successfully.', receipt });
  } catch (err) {
    if (err.statusCode === 400) return res.status(400).json({ error: 'Bad Request', message: err.message });
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
