const db = require('../../db');
const notificationsService = require('../notifications/notificationsService');
const inventoryMetricsService = require('../inventory/inventoryMetricsService');

/**
 * Recalculate invoice shipping status based on non-cancelled shipments.
 */
async function recalculateInvoiceShippingStatus(invoiceId, userId = null) {
  const invoice = await db.get('SELECT shipping_status, invoice_number FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return;

  const items = await db.all(`
    SELECT ii.id, ii.quantity, p.title as product_title
    FROM invoice_items ii
    JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = ?
  `, [invoiceId]);

  let allShipped = items.length > 0;
  let anyShipped = false;

  for (const item of items) {
    const shippedRow = await db.get(`
      SELECT
        COALESCE(SUM(CASE WHEN s.status = 'shipped' THEN si.quantity ELSE 0 END), 0) as shipped_qty
      FROM shipment_items si
      JOIN shipments s ON s.id = si.shipment_id
      WHERE si.invoice_item_id = ?
    `, [item.id]);
    const shippedQty = Number(shippedRow.shipped_qty) || 0;
    if (shippedQty < item.quantity) allShipped = false;
    if (shippedQty > 0) anyShipped = true;
  }

  let newStatus = 'pending';
  if (allShipped) newStatus = 'shipped';
  else if (anyShipped) newStatus = 'partially_shipped';

  if (newStatus !== invoice.shipping_status) {
    await db.run('UPDATE invoices SET shipping_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, invoiceId]);
    await db.run(`
      INSERT INTO invoice_status_history (invoice_id, status_type, old_status, new_status, changed_by, notes)
      VALUES (?, 'shipping', ?, ?, ?, ?)
    `, [invoiceId, invoice.shipping_status, newStatus, userId, `Shipping status updated to ${newStatus}.`]);
  }

  // Trigger partial shipment notification checks
  try {
    if (newStatus === 'partially_shipped') {
      await notificationsService.createOrUpdateNotification({
        category: 'shipment_partial',
        severity: 'warning',
        title: 'شحنة جزئية للفاتورة',
        message: `تم شحن الفاتورة رقم ${invoice.invoice_number} شحناً جزئياً.`,
        source_type: 'invoice',
        source_id: invoiceId,
        dedupe_key: `shipment_partial:${invoiceId}`,
        action_url: `/operations/shipments`
      });
    } else {
      await notificationsService.resolveNotificationByDedupeKey(`shipment_partial:${invoiceId}`);
    }
  } catch (e) {
    console.error('Error triggering partial shipment notification checks:', e);
  }
}

/**
 * Create a new shipment.
 */
async function createShipment({ invoiceId, shippingCarrier = '', trackingNumber = '', items = [], userId = null }) {
  if (!invoiceId) {
    throw new Error('Invoice ID is required');
  }
  if (!items || items.length === 0) {
    throw new Error('At least one item is required for a shipment');
  }

  const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} does not exist`);
  }
  if (invoice.archived_at) {
    throw new Error('Archived invoices must be restored before creating a shipment');
  }
  if (invoice.payment_status === 'cancelled') {
    throw new Error('Cannot create a shipment for a cancelled invoice');
  }
  if (invoice.shipping_status === 'shipped') {
    throw new Error('Cannot create a shipment for an invoice whose shipping is already complete');
  }

  // Validate each item
  const validatedItems = [];
  for (const item of items) {
    const { invoiceItemId, quantity } = item;
    const qty = parseInt(quantity, 10);
    if (!invoiceItemId || isNaN(qty) || qty <= 0) {
      throw new Error('Valid Invoice Item ID and positive quantity are required');
    }

    const invoiceItem = await db.get(`
      SELECT ii.*, p.title as product_title
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.id = ? AND ii.invoice_id = ?
    `, [invoiceItemId, invoiceId]);

    if (!invoiceItem) {
      throw new Error(`Invoice Item with ID ${invoiceItemId} does not exist on invoice ${invoiceId}`);
    }

    // Calculate how much has already been shipped/allocated in non-cancelled shipments
    const allocatedRow = await db.get(`
      SELECT COALESCE(SUM(si.quantity), 0) as qty
      FROM shipment_items si
      JOIN shipments s ON s.id = si.shipment_id
      WHERE si.invoice_item_id = ? AND s.status != 'cancelled'
    `, [invoiceItemId]);

    const remainingQty = Math.max(0, invoiceItem.quantity - allocatedRow.qty);
    if (qty > remainingQty) {
      throw new Error(`Requested shipment quantity for product "${invoiceItem.product_title}" exceeds the remaining unshipped quantity of ${remainingQty}.`);
    }

    // Check physical warehouse stock before shipping
    const product = await db.get('SELECT stock_policy FROM products WHERE id = ?', [invoiceItem.product_id]);
    if (product && product.stock_policy === 'track') {
      const metrics = await inventoryMetricsService.getProductMetrics(invoiceItem.product_id);
      const physicalStock = metrics ? metrics.availableToShip : 0;
      if (physicalStock < qty) {
        const error = new Error(`المخزون الفعلي المتاح للكتاب "${invoiceItem.product_title}" في المستودع هو ${physicalStock}، وهو غير كافٍ لشحن الكمية المطلوبة (${qty}).`);
        error.code = 'INSUFFICIENT_STOCK';
        throw error;
      }
    }

    validatedItems.push({
      invoiceItemId,
      quantity: qty
    });
  }

  const shipmentNumber = `SHP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');

  try {
    // Re-check the aggregate product quantities after acquiring the write
    // lock. The first validation is user-friendly; this check is the
    // concurrency-safe reservation gate immediately before inserting rows.
    const requestedByProduct = new Map();
    for (const item of validatedItems) {
      const row = await db.get('SELECT product_id FROM invoice_items WHERE id = ?', [item.invoiceItemId]);
      if (row) requestedByProduct.set(
        row.product_id,
        (requestedByProduct.get(row.product_id) || 0) + item.quantity
      );
    }
    for (const [productId, requestedQty] of requestedByProduct.entries()) {
      const product = await db.get('SELECT title, stock_policy FROM products WHERE id = ?', [productId]);
      if (!product || product.stock_policy !== 'track') continue;
      const metrics = await inventoryMetricsService.getProductMetrics(productId);
      const available = metrics ? metrics.availableToShip : 0;
      if (available < requestedQty) {
        const error = new Error(
          `The available shipping quantity for "${product.title}" is ${available}; requested ${requestedQty}.`
        );
        error.code = 'INSUFFICIENT_STOCK';
        error.availableToShip = available;
        error.shippingSupplyGap = metrics ? metrics.shippingSupplyGap : 0;
        throw error;
      }
    }

    const shipmentSql = `
      INSERT INTO shipments (shipment_number, invoice_id, shipping_carrier, tracking_number, status, shipped_at, created_by)
      VALUES (?, ?, ?, ?, 'shipped', ?, ?)
    `;
    const shippedAt = new Date().toISOString();
    const shipmentResult = await db.run(shipmentSql, [
      shipmentNumber,
      invoiceId,
      shippingCarrier.trim() || null,
      trackingNumber.trim() || null,
      shippedAt,
      userId
    ]);
    const shipmentId = shipmentResult.lastID;

    // Insert items
    for (const item of validatedItems) {
      const itemSql = `
        INSERT INTO shipment_items (shipment_id, invoice_item_id, quantity)
        VALUES (?, ?, ?)
      `;
      await db.run(itemSql, [shipmentId, item.invoiceItemId, item.quantity]);
    }

    // A confirmed shipment is physical fulfillment, not a draft allocation.
    const historySql = `
      INSERT INTO shipment_status_history (shipment_id, old_status, new_status, changed_by, notes)
      VALUES (?, 'pending', 'shipped', ?, 'Shipment created and confirmed as shipped.')
    `;
    await db.run(historySql, [shipmentId, userId]);

    // Recalculate invoice shipping status
    await recalculateInvoiceShippingStatus(invoiceId, userId);

    await db.exec('COMMIT;');

    return await getShipmentById(shipmentId);
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Update shipment status.
 */
async function updateShipmentStatus(shipmentId, { status, notes = '', userId = null }) {
  const allowedStatuses = ['pending', 'shipped', 'cancelled'];
  if (!status || !allowedStatuses.includes(status)) {
    throw new Error('Invalid status. Allowed: pending, shipped, cancelled');
  }

  const shipment = await db.get(`
    SELECT s.*, i.archived_at
    FROM shipments s
    JOIN invoices i ON i.id = s.invoice_id
    WHERE s.id = ?
  `, [shipmentId]);
  if (!shipment) {
    throw new Error(`Shipment with ID ${shipmentId} does not exist`);
  }
  if (shipment.archived_at) {
    throw new Error('Archived invoices must be restored before changing shipment status');
  }

  if (shipment.status === status) {
    return await getShipmentById(shipmentId);
  }

  const allowedTransitions = {
    pending: ['shipped', 'cancelled'],
    shipped: ['cancelled'],
    cancelled: []
  };
  if (!(allowedTransitions[shipment.status] || []).includes(status)) {
    throw new Error(`Invalid shipment status transition from ${shipment.status} to ${status}`);
  }

  await db.exec('BEGIN TRANSACTION;');

  try {
    let shippedAt = shipment.shipped_at;
    const nowStr = new Date().toISOString();

    if (status === 'shipped' && !shippedAt) shippedAt = nowStr;
    const updateSql = `
      UPDATE shipments
      SET status = ?, shipped_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    await db.run(updateSql, [status, shippedAt, shipmentId]);

    // Log history
    const historySql = `
      INSERT INTO shipment_status_history (shipment_id, old_status, new_status, changed_by, notes)
      VALUES (?, ?, ?, ?, ?)
    `;
    await db.run(historySql, [
      shipmentId,
      shipment.status,
      status,
      userId,
      notes.trim() || `Status updated from ${shipment.status} to ${status}.`
    ]);

    // Recalculate invoice shipping status
    await recalculateInvoiceShippingStatus(shipment.invoice_id, userId);

    await db.exec('COMMIT;');

    return await getShipmentById(shipmentId);
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Retrieve shipments list.
 */
async function getShipments({ limit = 50, offset = 0, invoiceId = null, status = null, outletIds = null } = {}) {
  let sql = `
    SELECT s.*, i.invoice_number, u.full_name as user_full_name
    FROM shipments s
    JOIN invoices i ON i.id = s.invoice_id
    LEFT JOIN users u ON u.id = s.created_by
    WHERE 1=1
  `;
  const params = [];

  if (invoiceId) {
    sql += ` AND s.invoice_id = ?`;
    params.push(invoiceId);
  }

  if (status) {
    sql += ` AND s.status = ?`;
    params.push(status);
  }

  if (outletIds && outletIds.length > 0) {
    sql += ` AND i.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }

  sql += ` ORDER BY s.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await db.all(sql, params);
}

/**
 * Retrieve specific shipment by ID.
 */
async function getShipmentById(id) {
  const sql = `
    SELECT s.*, i.invoice_number, u.full_name as user_full_name
    FROM shipments s
    JOIN invoices i ON i.id = s.invoice_id
    LEFT JOIN users u ON u.id = s.created_by
    WHERE s.id = ?
  `;
  const shipment = await db.get(sql, [id]);
  if (!shipment) return null;

  // Load items
  const items = await db.all(`
    SELECT si.*, ii.product_id, ii.unit_price, p.title as product_title, p.code as product_code
    FROM shipment_items si
    JOIN invoice_items ii ON ii.id = si.invoice_item_id
    JOIN products p ON p.id = ii.product_id
    WHERE si.shipment_id = ?
  `, [id]);

  // Load status history
  const history = await db.all(`
    SELECT ssh.*, u.full_name as user_full_name
    FROM shipment_status_history ssh
    LEFT JOIN users u ON u.id = ssh.changed_by
    WHERE ssh.shipment_id = ?
    ORDER BY ssh.created_at ASC
  `, [id]);

  shipment.items = items;
  shipment.history = history;

  return shipment;
}

/**
 * Calculate remaining shippable quantities per invoice item.
 */
async function getRemainingShippableItems(invoiceId) {
  const invoice = await db.get('SELECT id FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} does not exist`);
  }

  const items = await db.all(`
    SELECT ii.id as invoice_item_id, ii.product_id, ii.quantity as ordered_quantity,
           p.title as product_title, p.code as product_code, p.stock_policy
    FROM invoice_items ii
    JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = ?
  `, [invoiceId]);

  const metricsByProduct = await inventoryMetricsService.getProductMetricsMap(
    items.map(item => item.product_id)
  );

  for (const item of items) {
    const allocatedRow = await db.get(`
      SELECT COALESCE(SUM(si.quantity), 0) as qty
      FROM shipment_items si
      JOIN shipments s ON s.id = si.shipment_id
      WHERE si.invoice_item_id = ? AND s.status != 'cancelled'
    `, [item.invoice_item_id]);

    const returnedRow = await db.get(`
      SELECT COALESCE(SUM(ri.quantity), 0) as qty
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE ri.invoice_item_id = ? AND r.status = 'approved'
    `, [item.invoice_item_id]);

    item.shipped_quantity = allocatedRow.qty;
    item.returned_quantity = returnedRow.qty;
    item.remaining_quantity = Math.max(0, item.ordered_quantity - allocatedRow.qty);
    const metrics = metricsByProduct.get(item.product_id);
    item.product_available_to_ship = item.stock_policy === 'track'
      ? (metrics ? metrics.availableToShip : 0)
      : null;
    item.product_shippable_stock_balance = item.stock_policy === 'track'
      ? (metrics ? metrics.shippableStockBalance : 0)
      : null;
    item.shipping_supply_gap = item.stock_policy === 'track'
      ? (metrics ? metrics.shippingSupplyGap : 0)
      : 0;
    item.product_supply_required_to_fulfill = item.stock_policy === 'track'
      ? (metrics ? metrics.supplyRequiredToFulfill : 0)
      : 0;
    item.max_shippable_quantity = item.stock_policy === 'track'
      ? Math.min(item.remaining_quantity, item.product_available_to_ship)
      : item.remaining_quantity;
  }

  return items;
}

module.exports = {
  createShipment,
  updateShipmentStatus,
  getShipments,
  getShipmentById,
  recalculateInvoiceShippingStatus,
  getRemainingShippableItems
};
