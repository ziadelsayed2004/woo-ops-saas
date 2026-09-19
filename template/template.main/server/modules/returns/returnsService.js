const db = require('../../db');
const inventoryService = require('../inventory/inventoryService');
const notificationsService = require('../notifications/notificationsService');

/**
 * Get return details by ID.
 */
async function getReturnById(id) {
  const sql = `
    SELECT r.*, i.invoice_number, o.name as outlet_name, u.full_name as user_full_name
    FROM returns r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN outlets o ON o.id = r.outlet_id
    LEFT JOIN users u ON u.id = r.created_by
    WHERE r.id = ?
  `;
  const ret = await db.get(sql, [id]);
  if (!ret) return null;

  const items = await db.all(`
    SELECT ri.*, p.title as product_title, p.code as product_code
    FROM return_items ri
    JOIN products p ON p.id = ri.product_id
    WHERE ri.return_id = ?
  `, [id]);

  ret.items = items;
  return ret;
}

/**
 * List returns with filters.
 */
async function getReturns({ limit = 50, offset = 0, invoiceId = null, outletId = null, outletIds = null } = {}) {
  let sql = `
    SELECT r.*, i.invoice_number, o.name as outlet_name, u.full_name as user_full_name
    FROM returns r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN outlets o ON o.id = r.outlet_id
    LEFT JOIN users u ON u.id = r.created_by
    WHERE 1=1
  `;
  const params = [];

  if (invoiceId) {
    sql += ` AND r.invoice_id = ?`;
    params.push(invoiceId);
  }

  if (outletId) {
    sql += ` AND r.outlet_id = ?`;
    params.push(outletId);
  }

  if (outletIds && outletIds.length > 0) {
    sql += ` AND r.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }

  sql += ` ORDER BY r.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await db.all(sql, params);
}

/**
 * Create a new return and record the financial ledger entry and stock transactions.
 */
async function createReturn({ invoiceId, reason = '', items = [], userId }) {
  if (!invoiceId) {
    throw new Error('Invoice ID is required');
  }
  if (!items || items.length === 0) {
    throw new Error('At least one item is required for returns');
  }

  const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} does not exist`);
  }
  if (invoice.archived_at) {
    throw new Error('Archived invoices must be restored before creating a return');
  }
  if (invoice.payment_status === 'cancelled') {
    throw new Error('Cannot return items from a cancelled invoice');
  }
  if (!['shipped', 'partially_shipped'].includes(invoice.shipping_status)) {
    throw new Error('Cannot return items from an invoice that has not been shipped');
  }

  const validatedItems = [];
  let totalReturnValue = 0;

  // Validate each return item
  for (const item of items) {
    const { invoiceItemId, quantity } = item;
    const qty = parseInt(quantity, 10);
    if (!invoiceItemId || isNaN(qty) || qty <= 0) {
      throw new Error('Valid Invoice Item ID and positive quantity are required');
    }

    const invoiceItem = await db.get(`
      SELECT ii.*, p.title as product_title, p.stock_policy
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.id = ? AND ii.invoice_id = ?
    `, [invoiceItemId, invoiceId]);

    if (!invoiceItem) {
      throw new Error(`Invoice Item with ID ${invoiceItemId} does not exist on invoice ${invoiceId}`);
    }

    // Get total quantity shipped for this invoice item.
    const shippedRow = await db.get(`
      SELECT COALESCE(SUM(si.quantity), 0) as qty
      FROM shipment_items si
      JOIN shipments s ON s.id = si.shipment_id
      WHERE si.invoice_item_id = ? AND s.status = 'shipped'
    `, [invoiceItemId]);
    let shippedQty = shippedRow.qty;

    if (invoice.shipping_status === 'shipped') {
      shippedQty = invoiceItem.quantity;
    }

    // Get total quantity already returned for this invoice item
    const returnedRow = await db.get(`
      SELECT COALESCE(SUM(ri.quantity), 0) as qty
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE ri.invoice_item_id = ? AND r.status != 'cancelled'
    `, [invoiceItemId]);

    const returnedQty = returnedRow.qty;
    const maxReturnable = shippedQty - returnedQty;

    if (qty > maxReturnable) {
      throw new Error(`Requested return quantity for product "${invoiceItem.product_title}" exceeds the remaining returnable quantity of ${maxReturnable}.`);
    }

    // Get total value already refunded for this invoice item
    const refundedValueRow = await db.get(`
      SELECT COALESCE(SUM(ri.total_price), 0) as val
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE ri.invoice_item_id = ? AND r.status != 'cancelled'
    `, [invoiceItemId]);

    const previouslyRefundedValue = refundedValueRow.val;
    const maxRefundableValue = Math.max(0, invoiceItem.total_price - previouslyRefundedValue);
    const itemTotalPrice = Math.min(maxRefundableValue, qty * invoiceItem.unit_price);
    totalReturnValue += itemTotalPrice;

    validatedItems.push({
      invoiceItemId,
      productId: invoiceItem.product_id,
      productTitle: invoiceItem.product_title,
      quantity: qty,
      unitPrice: invoiceItem.unit_price,
      totalPrice: itemTotalPrice,
      stockPolicy: invoiceItem.stock_policy
    });
  }

  const returnNumber = `RET-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  // Begin transaction
  await db.exec('BEGIN TRANSACTION;');

  try {
    const returnSql = `
      INSERT INTO returns (return_number, invoice_id, outlet_id, return_value, reason, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'approved', ?)
    `;
    const returnResult = await db.run(returnSql, [
      returnNumber,
      invoiceId,
      invoice.outlet_id,
      totalReturnValue,
      reason.trim() || null,
      userId
    ]);
    const returnId = returnResult.lastID;

    // Insert return items and handle stock transaction
    for (const item of validatedItems) {
      const itemSql = `
        INSERT INTO return_items (return_id, invoice_item_id, product_id, quantity, unit_price, total_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      await db.run(itemSql, [
        returnId,
        item.invoiceItemId,
        item.productId,
        item.quantity,
        item.unitPrice,
        item.totalPrice
      ]);

      if (item.stockPolicy === 'track') {
        await inventoryService.createTransaction({
          productId: item.productId,
          transactionType: 'return',
          quantity: item.quantity,
          referenceType: 'invoice',
          referenceId: invoiceId,
          userId
        });
      }
    }

    // Insert into finance ledger (reduces receivable exposure)
    await db.run(`
      INSERT INTO finance_ledger_entries (
        outlet_id, invoice_id, entry_type, reference_type, reference_id,
        cash_amount, receivable_amount, notes, created_by
      ) VALUES (?, ?, 'return_created', 'return', ?, 0, ?, ?, ?)
    `, [
      invoice.outlet_id,
      invoiceId,
      returnId,
      -totalReturnValue,
      reason.trim() || `مرتجع مبيعات رقم ${returnNumber}`,
      userId
    ]);

    // A return reduces the amount that must be collected for the invoice.
    // Keep the stored payment status aligned with the new net invoice amount.
    const paymentsService = require('../payments/paymentsService');
    await paymentsService.recalculatePaymentMetrics(invoiceId);

    // Recalculate invoice shipping status since items were returned
    const shipmentsService = require('../shipments/shipmentsService');
    await shipmentsService.recalculateInvoiceShippingStatus(invoiceId, userId);

    await db.exec('COMMIT;');

    // Trigger notifications check
    try {
      await notificationsService.checkOutletCreditLimitNotifications(invoice.outlet_id);
      await notificationsService.checkOutletFinanceNotifications(invoice.outlet_id);
      for (const item of validatedItems) {
        await notificationsService.checkStockNotifications(item.productId);
      }
      
      await notificationsService.createOrUpdateNotification({
        category: 'system',
        severity: 'info',
        title: 'مرتجع مبيعات جديد',
        message: `تم تسجيل مرتجع مبيعات رقم ${returnNumber} بقيمة ${totalReturnValue} EGP للفاتورة ${invoice.invoice_number}.`,
        source_type: 'return',
        source_id: returnId,
        dedupe_key: `return_created:${returnId}`,
        action_url: `/finance/ledger`
      });
    } catch (e) {
      console.error('Error running notification checks on return creation:', e);
    }

    return await getReturnById(returnId);
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

module.exports = {
  getReturnById,
  getReturns,
  createReturn
};
