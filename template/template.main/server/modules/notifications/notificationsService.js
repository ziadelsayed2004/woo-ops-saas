const db = require('../../db');
const inventoryMetricsService = require('../inventory/inventoryMetricsService');

const LOW_STOCK_THRESHOLD = parseInt(process.env.LOW_STOCK_THRESHOLD, 10) || 5;

/**
 * Create or update a notification (with optional deduplication by dedupe_key).
 */
async function createOrUpdateNotification({
  category,
  severity,
  title,
  message,
  source_type = null,
  source_id = null,
  dedupe_key = null,
  action_url = null
}) {
  if (!category || !severity || !title || !message) {
    throw new Error('Missing required notification fields');
  }

  const allowedCategories = [
    'stock_negative', 'stock_low', 'outlet_credit_limit_exceeded',
    'invoice_overdue', 'payment_received',
    'shipment_partial', 'shipment_delayed', 'system', 'finance_warning', 'price_missing'
  ];
  if (!allowedCategories.includes(category)) {
    throw new Error(`Invalid notification category: ${category}`);
  }

  const allowedSeverities = ['info', 'warning', 'critical', 'success'];
  if (!allowedSeverities.includes(severity)) {
    throw new Error(`Invalid notification severity: ${severity}`);
  }

  if (dedupe_key) {
    // Check if an active (unread/read) notification exists with the same dedupe_key
    const existing = await db.get(
      `SELECT id, message, severity, title FROM notifications WHERE dedupe_key = ? AND status IN ('unread', 'read')`,
      [dedupe_key]
    );

    if (existing) {
      // If it exists, update it to make sure it's fresh and keep/reset to unread so user notices
      await db.run(
        `UPDATE notifications 
         SET title = ?, message = ?, severity = ?, status = 'unread', updated_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [title, message, severity, existing.id]
      );
      return existing.id;
    }
  }

  // Otherwise, create a new one
  const sql = `
    INSERT INTO notifications (category, severity, title, message, source_type, source_id, dedupe_key, status, action_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?)
  `;
  const result = await db.run(sql, [
    category,
    severity,
    title,
    message,
    source_type,
    source_id,
    dedupe_key,
    action_url
  ]);

  return result.lastID;
}

/**
 * Mark a notification as read.
 */
async function markAsRead(id) {
  const result = await db.run(
    `UPDATE notifications SET status = 'read', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  );
  return result.changes > 0;
}

/**
 * Resolve a notification.
 */
async function resolveNotification(id) {
  const result = await db.run(
    `UPDATE notifications SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  );
  return result.changes > 0;
}

/**
 * Resolve notification by its dedupe key.
 */
async function resolveNotificationByDedupeKey(dedupeKey) {
  if (!dedupeKey) return false;
  const result = await db.run(
    `UPDATE notifications 
     SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
     WHERE dedupe_key = ? AND status IN ('unread', 'read')`,
    [dedupeKey]
  );
  return result.changes > 0;
}

/**
 * List/filter notifications.
 */
async function getNotifications({
  limit = 50,
  offset = 0,
  status = null,
  category = null,
  severity = null,
  severities = null
} = {}) {
  let sql = `SELECT * FROM notifications WHERE 1=1`;
  const params = [];

  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  if (category) {
    sql += ` AND category = ?`;
    params.push(category);
  }
  if (Array.isArray(severities) && severities.length > 0) {
    sql += ` AND severity IN (${severities.map(() => '?').join(',')})`;
    params.push(...severities);
  } else if (severity) {
    sql += ` AND severity = ?`;
    params.push(severity);
  }

  sql += ` ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await db.all(sql, params);
}

/**
 * Get notification counts grouped by status.
 */
async function getNotificationCounts() {
  const rows = await db.all(
    `SELECT status, COUNT(*) as count FROM notifications GROUP BY status`
  );
  const counts = { unread: 0, read: 0, resolved: 0 };
  for (const row of rows) {
    if (counts.hasOwnProperty(row.status)) {
      counts[row.status] = row.count;
    }
  }
  return counts;
}

/**
 * Check stock alerts for a product.
 */
async function checkStockNotifications(productId) {
  const product = await db.get('SELECT title, code, stock_policy FROM products WHERE id = ?', [productId]);
  if (!product) return;

  if (product.stock_policy !== 'track') {
    await resolveNotificationByDedupeKey(`stock_negative:${productId}`);
    await resolveNotificationByDedupeKey(`stock_low:${productId}`);
    return;
  }

  const metrics = await inventoryMetricsService.getProductMetrics(productId);
  const stock = metrics ? metrics.stockBalance : 0;

  if (stock < 0) {
    await createOrUpdateNotification({
      category: 'stock_negative',
      severity: 'critical',
      title: 'رصيد سالب للمنتج',
      message: `المنتج "${product.title}" (${product.code}) لديه رصيد سالب: ${stock}.`,
      source_type: 'product',
      source_id: productId,
      dedupe_key: `stock_negative:${productId}`,
      action_url: '/inventory'
    });
    await resolveNotificationByDedupeKey(`stock_low:${productId}`);
  } else if (stock <= LOW_STOCK_THRESHOLD) {
    await createOrUpdateNotification({
      category: 'stock_low',
      severity: 'warning',
      title: 'رصيد منخفض للمنتج',
      message: `المنتج "${product.title}" (${product.code}) لديه رصيد منخفض: ${stock}.`,
      source_type: 'product',
      source_id: productId,
      dedupe_key: `stock_low:${productId}`,
      action_url: '/inventory'
    });
    await resolveNotificationByDedupeKey(`stock_negative:${productId}`);
  } else {
    await resolveNotificationByDedupeKey(`stock_negative:${productId}`);
    await resolveNotificationByDedupeKey(`stock_low:${productId}`);
  }
}

/**
 * Check credit limit alerts for an outlet.
 */
async function checkOutletCreditLimitNotifications(outletId) {
  const outlet = await db.get('SELECT name, credit_limit FROM outlets WHERE id = ?', [outletId]);
  if (!outlet) return;

  const creditLimit = outlet.credit_limit || 0;
  if (creditLimit <= 0) {
    await resolveNotificationByDedupeKey(`outlet_credit_limit:${outletId}`);
    return;
  }

  const ledgerRow = await db.get(`
    SELECT COALESCE(SUM(receivable_amount), 0) as totalReceivable
    FROM finance_ledger_entries
    WHERE outlet_id = ?
  `, [outletId]);
  const totalReceivable = ledgerRow ? ledgerRow.totalReceivable : 0;

  if (totalReceivable > creditLimit) {
    await createOrUpdateNotification({
      category: 'outlet_credit_limit_exceeded',
      severity: 'critical',
      title: 'تجاوز الحد الائتماني للمنفذ',
      message: `المنفذ "${outlet.name}" تجاوز الحد الائتماني المسموح به (${creditLimit} EGP). المديونية الحالية: ${totalReceivable} EGP.`,
      source_type: 'outlet',
      source_id: outletId,
      dedupe_key: `outlet_credit_limit:${outletId}`,
      action_url: '/outlets'
    });
  } else {
    await resolveNotificationByDedupeKey(`outlet_credit_limit:${outletId}`);
  }
}


/**
 * Check overdue deferred invoice alerts.
 */
async function checkOverdueInvoicesNotifications() {
  const overdueInvoices = await db.all(`
    SELECT i.*, o.name as outlet_name
    FROM invoices i
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.payment_type = 'deferred'
      AND i.payment_status IN ('unpaid', 'partially_paid')
      AND i.created_at < datetime('now', '-30 days')
  `);

  for (const inv of overdueInvoices) {
    await createOrUpdateNotification({
      category: 'invoice_overdue',
      severity: 'critical',
      title: 'فاتورة أجلة متأخرة السداد',
      message: `الفاتورة الآجلة رقم ${inv.invoice_number} (المنفذ: ${inv.outlet_name}) تجاوزت 30 يوماً دون سداد كامل. المتبقي: ${inv.total_price} EGP.`,
      source_type: 'invoice',
      source_id: inv.id,
      dedupe_key: `invoice_overdue:${inv.id}`,
      action_url: '/invoices'
    });
  }

  const settledInvoices = await db.all(`
    SELECT id FROM invoices WHERE payment_status IN ('paid', 'cancelled')
  `);
  for (const inv of settledInvoices) {
    await resolveNotificationByDedupeKey(`invoice_overdue:${inv.id}`);
  }
}

/**
 * Check missing price configurations for a product.
 */
async function checkProductPriceNotifications(productId) {
  const product = await db.get('SELECT title, status FROM products WHERE id = ?', [productId]);
  if (!product) return;

  if (product.status !== 'active') {
    await resolveNotificationByDedupeKey(`product_price_missing:${productId}`);
    return;
  }

  const activeTypes = await db.all("SELECT id, name FROM outlet_types WHERE status = 'active'");
  const missingFor = [];

  for (const type of activeTypes) {
    const priceRow = await db.get(
      'SELECT price FROM product_prices WHERE product_id = ? AND outlet_type_id = ?',
      [productId, type.id]
    );
    if (!priceRow || priceRow.price === null || priceRow.price === undefined) {
      missingFor.push(type.name);
    }
  }

  if (missingFor.length > 0) {
    await createOrUpdateNotification({
      category: 'price_missing',
      severity: 'warning',
      title: 'سعر منتج غير مهيأ',
      message: `المنتج "${product.title}" يفتقد لتهيئة السعر لأنواع المنافذ التالية: ${missingFor.join(', ')}.`,
      source_type: 'product',
      source_id: productId,
      dedupe_key: `product_price_missing:${productId}`,
      action_url: '/products'
    });
  } else {
    await resolveNotificationByDedupeKey(`product_price_missing:${productId}`);
  }
}

/**
 * Check finance warning alerts for an outlet.
 */
async function checkOutletFinanceNotifications(outletId) {
  const outlet = await db.get('SELECT name, credit_limit FROM outlets WHERE id = ?', [outletId]);
  if (!outlet) return;

  // 1. Check collected-not-supplied cash
  const row = await db.get(`
    SELECT COALESCE(SUM(p.amount), 0) as unsupplied
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.outlet_id = ? AND p.supply_status = 'not_supplied'
      AND p.receipt_status = 'approved' AND p.reversed_at IS NULL
  `, [outletId]);
  const unsupplied = row ? row.unsupplied : 0;

  if (unsupplied > 1000) {
    await createOrUpdateNotification({
      category: 'finance_warning',
      severity: 'warning',
      title: 'نقدية غير موردة مرتفعة',
      message: `المنفذ "${outlet.name}" لديه نقدية محصلة ولم تورد بقيمة ${unsupplied} EGP.`,
      source_type: 'outlet',
      source_id: outletId,
      dedupe_key: `outlet_unsupplied_cash:${outletId}`,
      action_url: '/payments'
    });
  } else {
    await resolveNotificationByDedupeKey(`outlet_unsupplied_cash:${outletId}`);
  }

  // 2. Check pending-balance approaching credit limit
  const creditLimit = outlet.credit_limit || 0;
  if (creditLimit > 0) {
    const ledgerRow = await db.get(`
      SELECT COALESCE(SUM(receivable_amount), 0) as totalReceivable
      FROM finance_ledger_entries
      WHERE outlet_id = ?
    `, [outletId]);
    const totalReceivable = ledgerRow ? ledgerRow.totalReceivable : 0;

    if (totalReceivable >= creditLimit * 0.8 && totalReceivable <= creditLimit) {
      await createOrUpdateNotification({
        category: 'finance_warning',
        severity: 'warning',
        title: 'اقتراب من الحد الائتماني للمنفذ',
        message: `المديونية الحالية للمنفذ "${outlet.name}" هي ${totalReceivable} EGP، والتي تقترب من الحد الائتماني (${creditLimit} EGP).`,
        source_type: 'outlet',
        source_id: outletId,
        dedupe_key: `outlet_credit_warning:${outletId}`,
        action_url: '/outlets'
      });
    } else if (totalReceivable < creditLimit * 0.8) {
      await resolveNotificationByDedupeKey(`outlet_credit_warning:${outletId}`);
    }
  } else {
    await resolveNotificationByDedupeKey(`outlet_credit_warning:${outletId}`);
  }
}

module.exports = {
  createOrUpdateNotification,
  markAsRead,
  resolveNotification,
  resolveNotificationByDedupeKey,
  getNotifications,
  getNotificationCounts,
  checkStockNotifications,
  checkOutletCreditLimitNotifications,
  checkOverdueInvoicesNotifications,
  checkProductPriceNotifications,
  checkOutletFinanceNotifications
};
