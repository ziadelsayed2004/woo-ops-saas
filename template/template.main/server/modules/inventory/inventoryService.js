const db = require('../../db');
const notificationsService = require('../notifications/notificationsService');
const inventoryMetricsService = require('./inventoryMetricsService');

class InventoryValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryValidationError';
    this.statusCode = 400;
  }
}


/**
 * Get the real-time stock level for a specific product.
 */
async function getRealTimeStock(productId) {
  const metrics = await inventoryMetricsService.getProductMetrics(productId);
  return metrics ? metrics.stockBalance : 0;
}

/**
 * Get stock summaries for all active products.
 */
async function getStockSummary({ limit = 50, offset = 0, search = '' } = {}) {
  return await inventoryMetricsService.getAllProductMetrics({
    status: 'active',
    search,
    limit,
    offset
  });
}

/**
 * Create a transaction entry in the inventory ledger.
 */
async function createTransaction({ productId, transactionType, quantity, referenceType, referenceId, userId }) {
  if (!productId || !transactionType || quantity === undefined || !referenceType || referenceId === undefined) {
    throw new Error('Missing transaction details');
  }

  const sql = `
    INSERT INTO inventory_transactions (product_id, transaction_type, quantity, reference_type, reference_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const result = await db.run(sql, [productId, transactionType, quantity, referenceType, referenceId, userId]);
  return { id: result.lastID, productId, transactionType, quantity, referenceType, referenceId, userId };
}

/**
 * Create a stock adjustment.
 */
async function createAdjustment({ reason, notes = '', items = [], userId }) {
  if (!reason) {
    throw new Error('Reason is required for stock adjustments');
  }
  if (!items || items.length === 0) {
    throw new Error('At least one item is required for stock adjustments');
  }

  // Verify all products exist
  for (const item of items) {
    const { productId, quantity } = item;
    if (!productId || quantity === undefined || isNaN(parseInt(quantity, 10))) {
      throw new Error('Invalid product or quantity details');
    }
    const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
    if (!product) {
      throw new Error(`Product with ID ${productId} does not exist`);
    }
  }

  const adjustmentNumber = `ADJ-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  // Save adjustment parent
  const parentSql = `
    INSERT INTO inventory_adjustments (adjustment_number, reason, notes, created_by)
    VALUES (?, ?, ?, ?)
  `;
  const parentResult = await db.run(parentSql, [adjustmentNumber, reason.trim(), notes.trim(), userId]);
  const adjustmentId = parentResult.lastID;

  // Save adjustment items and transaction ledger records
  for (const item of items) {
    const { productId, quantity } = item;
    const parsedQty = parseInt(quantity, 10);

    const itemSql = `
      INSERT INTO inventory_adjustment_items (adjustment_id, product_id, quantity)
      VALUES (?, ?, ?)
    `;
    await db.run(itemSql, [adjustmentId, productId, parsedQty]);

    // Insert transaction ledger record
    await createTransaction({
      productId,
      transactionType: 'adjustment',
      quantity: parsedQty,
      referenceType: 'adjustment',
      referenceId: adjustmentId,
      userId
    });
  }

  // Check stock notifications for each item
  for (const item of items) {
    try {
      await notificationsService.checkStockNotifications(item.productId);
    } catch (e) {
      console.error('Error running checkStockNotifications:', e);
    }
  }

  return {
    id: adjustmentId,
    adjustmentNumber,
    reason,
    notes,
    items
  };
}

/**
 * Retrieve all transactions.
 */
async function getTransactions({ limit = 50, offset = 0, productId = null, transactionType = '' } = {}) {
  let sql = `
    SELECT t.*, p.title as product_title, p.code as product_code, u.full_name as user_full_name
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE 1=1
  `;
  const params = [];

  if (productId) {
    sql += ` AND t.product_id = ?`;
    params.push(productId);
  }
  if (transactionType) {
    sql += ` AND t.transaction_type = ?`;
    params.push(transactionType);
  }

  sql += ` ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await db.all(sql, params);
}

/**
 * Retrieve all stock adjustments.
 */
async function getAdjustments({ limit = 50, offset = 0 } = {}) {
  const sql = `
    SELECT a.*, u.full_name as user_full_name
    FROM inventory_adjustments a
    LEFT JOIN users u ON u.id = a.created_by
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await db.all(sql, [limit, offset]);
}

/**
 * Retrieve adjustment details by ID.
 */
async function getAdjustmentDetails(id) {
  const adjustment = await db.get(`
    SELECT a.*, u.full_name as user_full_name
    FROM inventory_adjustments a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.id = ?
  `, [id]);

  if (adjustment) {
    const items = await db.all(`
      SELECT ai.*, p.title as product_title, p.code as product_code
      FROM inventory_adjustment_items ai
      JOIN products p ON p.id = ai.product_id
      WHERE ai.adjustment_id = ?
    `, [id]);
    adjustment.items = items;
  }

  return adjustment;
}

/**
 * Create a new inventory receipt.
 */
async function createReceipt({ supplierName = '', receivedDate, notes = '', items = [], userId }) {
  if (!receivedDate) {
    throw new Error('Received date is required');
  }
  if (!items || items.length === 0) {
    throw new Error('At least one item is required for inventory receipts');
  }

  const productIds = new Set();
  // Validate items before opening the transaction.
  for (const item of items) {
    const { productId, quantity, unitCost } = item;
    if (!productId || quantity === undefined || unitCost === undefined) {
      throw new Error('Product ID, quantity, and unit cost are required for all receipt items');
    }
    const qty = parseInt(quantity, 10);
    const cost = parseFloat(unitCost);
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Quantity must be a positive integer');
    }
    if (isNaN(cost) || cost < 0) {
      throw new Error('Unit cost must be a positive number');
    }

    const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
    if (!product) {
      throw new Error(`Product with ID ${productId} does not exist`);
    }
    if (productIds.has(Number(productId))) {
      throw new Error('A product can only appear once in an inventory receipt');
    }
    productIds.add(Number(productId));
  }

  const receiptNumber = `REC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  let receiptId;
  await db.exec('BEGIN TRANSACTION;');
  try {
    const parentSql = `
      INSERT INTO inventory_receipts (receipt_number, supplier_name, received_date, notes, created_by)
      VALUES (?, ?, ?, ?, ?)
    `;
    const parentResult = await db.run(parentSql, [
      receiptNumber,
      supplierName.trim() ? supplierName.trim() : null,
      receivedDate,
      notes.trim(),
      userId
    ]);
    receiptId = parentResult.lastID;

    for (const item of items) {
      const { productId, quantity, unitCost } = item;
      const qty = parseInt(quantity, 10);
      const cost = parseFloat(unitCost);
      await db.run(`
        INSERT INTO inventory_receipt_items (receipt_id, product_id, quantity, unit_cost)
        VALUES (?, ?, ?, ?)
      `, [receiptId, productId, qty, cost]);

      await createTransaction({
        productId,
        transactionType: 'receipt',
        quantity: qty,
        referenceType: 'receipt',
        referenceId: receiptId,
        userId
      });
    }
    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  // Check stock notifications for each item
  for (const item of items) {
    try {
      await notificationsService.checkStockNotifications(item.productId);
    } catch (e) {
      console.error('Error running checkStockNotifications:', e);
    }
  }

  return {
    id: receiptId,
    receiptNumber,
    status: 'active',
    supplierName,
    receivedDate,
    notes,
    items
  };
}

/**
 * Retrieve all inventory receipts.
 */
async function getReceipts({ limit = 50, offset = 0, status = '' } = {}) {
  const sql = `
    SELECT r.*, u.full_name as user_full_name
    FROM inventory_receipts r
    LEFT JOIN users u ON u.id = r.created_by
    ${status ? 'WHERE r.status = ?' : ''}
    ORDER BY r.received_date DESC, r.created_at DESC
    LIMIT ? OFFSET ?
  `;
  return await db.all(sql, status ? [status, limit, offset] : [limit, offset]);
}

/**
 * Retrieve inventory receipt details and its items.
 */
async function getReceiptDetails(id) {
  const receipt = await db.get(`
    SELECT r.*, u.full_name as user_full_name
    FROM inventory_receipts r
    LEFT JOIN users u ON u.id = r.created_by
    WHERE r.id = ?
  `, [id]);

  if (receipt) {
    const items = await db.all(`
      SELECT ri.*, p.title as product_title, p.code as product_code,
        COALESCE(ret.returned_quantity, 0) as returned_quantity,
        (ri.quantity - COALESCE(ret.returned_quantity, 0)) as remaining_quantity,
        MAX(0, ri.quantity - COALESCE(ret.returned_quantity, 0)) as max_returnable
      FROM inventory_receipt_items ri
      JOIN products p ON p.id = ri.product_id
      LEFT JOIN (
        SELECT receipt_item_id, SUM(quantity) as returned_quantity
        FROM inventory_receipt_return_items
        GROUP BY receipt_item_id
      ) ret ON ret.receipt_item_id = ri.id
      WHERE ri.receipt_id = ?
    `, [id]);
    receipt.items = items;

    receipt.returns = await db.all(`
      SELECT rr.*, u.full_name as user_full_name
      FROM inventory_receipt_returns rr
      LEFT JOIN users u ON u.id = rr.created_by
      WHERE rr.receipt_id = ?
      ORDER BY rr.return_date DESC, rr.created_at DESC
    `, [id]);
    for (const supplierReturn of receipt.returns) {
      supplierReturn.items = await db.all(`
        SELECT rri.*, p.title as product_title, p.code as product_code
        FROM inventory_receipt_return_items rri
        JOIN products p ON p.id = rri.product_id
        WHERE rri.return_id = ?
      `, [supplierReturn.id]);
    }
  }

  return receipt;
}

async function cancelReceipt(id, { reason, userId }) {
  if (!reason || !String(reason).trim()) {
    throw new InventoryValidationError('Cancellation reason is required');
  }
  const receipt = await db.get('SELECT * FROM inventory_receipts WHERE id = ?', [id]);
  if (!receipt) throw new InventoryValidationError('Inventory receipt not found');
  if (receipt.status !== 'active') {
    throw new InventoryValidationError('Only an active receipt without prior returns can be cancelled');
  }

  const items = await db.all(`
    SELECT ri.*, p.title as product_title
    FROM inventory_receipt_items ri
    JOIN products p ON p.id = ri.product_id
    WHERE ri.receipt_id = ?
  `, [id]);
  // Reversing an incorrectly recorded receipt is an accounting correction.
  // It is intentionally allowed to make stock negative; shipment creation is
  // the operation that enforces sufficient physical stock.
  const affectedProductIds = new Set(items.map(item => item.product_id));

  await db.exec('BEGIN TRANSACTION;');
  try {
    await db.run(`
      UPDATE inventory_receipts
      SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?,
          cancellation_reason = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'active'
    `, [userId, String(reason).trim(), id]);
    for (const item of items) {
      await createTransaction({
        productId: item.product_id,
        transactionType: 'receipt_cancellation',
        quantity: -item.quantity,
        referenceType: 'receipt',
        referenceId: id,
        userId
      });
    }
    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  for (const productId of affectedProductIds) {
    try { await notificationsService.checkStockNotifications(productId); } catch (e) { console.error('Error running stock notification check:', e); }
  }
  return await getReceiptDetails(id);
}

async function createSupplierReturn(receiptId, { returnDate, reason, notes = '', items = [], userId }) {
  if (!reason || !String(reason).trim()) throw new InventoryValidationError('Return reason is required');
  if (!Array.isArray(items) || items.length === 0) throw new InventoryValidationError('At least one return item is required');
  const receipt = await db.get('SELECT * FROM inventory_receipts WHERE id = ?', [receiptId]);
  if (!receipt) throw new InventoryValidationError('Inventory receipt not found');
  if (receipt.status === 'cancelled' || receipt.status === 'returned') {
    throw new InventoryValidationError('This receipt cannot receive more supplier returns');
  }

  const receiptItems = await db.all('SELECT ri.*, p.title as product_title FROM inventory_receipt_items ri JOIN products p ON p.id = ri.product_id WHERE ri.receipt_id = ?', [receiptId]);
  const receiptItemById = new Map(receiptItems.map(item => [Number(item.id), item]));
  const previous = await db.all(`
    SELECT receipt_item_id, SUM(quantity) as returned_quantity
    FROM inventory_receipt_return_items
    WHERE receipt_item_id IN (SELECT id FROM inventory_receipt_items WHERE receipt_id = ?)
    GROUP BY receipt_item_id
  `, [receiptId]);
  const previousByItem = new Map(previous.map(row => [Number(row.receipt_item_id), Number(row.returned_quantity)]));
  const requestedByProduct = new Map();
  const validatedItems = [];
  for (const raw of items) {
    const receiptItemId = Number(raw.receiptItemId);
    const quantity = Number.parseInt(raw.quantity, 10);
    const receiptItem = receiptItemById.get(receiptItemId);
    if (!receiptItem || !Number.isInteger(quantity) || quantity <= 0) {
      throw new InventoryValidationError('Each return item must reference a valid positive quantity');
    }
    const remaining = receiptItem.quantity - (previousByItem.get(receiptItemId) || 0);
    if (quantity > remaining) {
      throw new InventoryValidationError(`كمية مرتجع ${receiptItem.product_title} تتجاوز المتبقي ${remaining}`);
    }
    validatedItems.push({ receiptItemId, productId: receiptItem.product_id, quantity });
    requestedByProduct.set(receiptItem.product_id, (requestedByProduct.get(receiptItem.product_id) || 0) + quantity);
  }
  // Supplier returns are tied to the remaining quantity on the source receipt,
  // not to current warehouse stock. They may therefore take stock below zero.

  const returnNumber = `SRET-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  let returnId;
  await db.exec('BEGIN TRANSACTION;');
  try {
    const result = await db.run(`
      INSERT INTO inventory_receipt_returns (return_number, receipt_id, return_date, reason, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [returnNumber, receiptId, returnDate || new Date().toISOString(), String(reason).trim(), String(notes || '').trim(), userId]);
    returnId = result.lastID;
    for (const item of validatedItems) {
      await db.run(`
        INSERT INTO inventory_receipt_return_items (return_id, receipt_item_id, product_id, quantity)
        VALUES (?, ?, ?, ?)
      `, [returnId, item.receiptItemId, item.productId, item.quantity]);
      await createTransaction({
        productId: item.productId,
        transactionType: 'supplier_return',
        quantity: -item.quantity,
        referenceType: 'receipt_return',
        referenceId: returnId,
        userId
      });
    }
    const totals = await db.get(`
      SELECT
        (SELECT COALESCE(SUM(quantity), 0) FROM inventory_receipt_items WHERE receipt_id = ?) as received_quantity,
        (SELECT COALESCE(SUM(rri.quantity), 0)
         FROM inventory_receipt_return_items rri
         JOIN inventory_receipt_items ri ON ri.id = rri.receipt_item_id
         WHERE ri.receipt_id = ?) as returned_quantity
    `, [receiptId, receiptId]);
    const nextStatus = Number(totals.returned_quantity) >= Number(totals.received_quantity)
      ? 'returned' : 'partially_returned';
    await db.run('UPDATE inventory_receipts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [nextStatus, receiptId]);
    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  for (const productId of requestedByProduct.keys()) {
    try { await notificationsService.checkStockNotifications(productId); } catch (e) { console.error('Error running stock notification check:', e); }
  }
  return await getReceiptDetails(receiptId);
}

module.exports = {
  getRealTimeStock,
  getStockSummary,
  createTransaction,
  createAdjustment,
  getTransactions,
  getAdjustments,
  getAdjustmentDetails,
  createReceipt,
  getReceipts,
  getReceiptDetails,
  cancelReceipt,
  createSupplierReturn,
  InventoryValidationError
};
