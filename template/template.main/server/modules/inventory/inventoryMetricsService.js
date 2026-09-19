const db = require('../../db');

/**
 * Inventory and shipping metrics derived from the current business records.
 *
 * inventory_transactions is an append-only audit ledger. Its legacy `return`
 * rows contain both invoice edit reversals and real customer returns, so it is
 * intentionally not used as the source of truth for sales or shippable stock.
 */
function metricsSql({ where = '', params = [], suffix = '' } = {}) {
  const sql = `
    WITH inventory AS (
      SELECT
        product_id,
        COALESCE(SUM(CASE WHEN transaction_type = 'receipt' THEN quantity ELSE 0 END), 0) AS total_received,
        COALESCE(ABS(SUM(CASE WHEN transaction_type = 'supplier_return' THEN quantity ELSE 0 END)), 0) AS total_supplier_returned,
        COALESCE(ABS(SUM(CASE WHEN transaction_type = 'receipt_cancellation' THEN quantity ELSE 0 END)), 0) AS total_receipt_cancelled,
        COALESCE(SUM(CASE WHEN transaction_type IN ('receipt', 'supplier_return', 'receipt_cancellation') THEN quantity ELSE 0 END), 0) AS net_received,
        COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN quantity ELSE 0 END), 0) AS total_adjusted
      FROM inventory_transactions
      GROUP BY product_id
    ), invoice_sales AS (
      SELECT
        ii.product_id,
        COALESCE(SUM(ii.quantity), 0) AS invoiced_sales
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.payment_status != 'cancelled'
      GROUP BY ii.product_id
    ), customer_returns AS (
      SELECT
        ri.product_id,
        COALESCE(SUM(ri.quantity), 0) AS approved_customer_returns
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      JOIN invoices i ON i.id = r.invoice_id
      WHERE r.status = 'approved'
        AND i.payment_status != 'cancelled'
      GROUP BY ri.product_id
    ), shipped AS (
      SELECT
        ii.product_id,
        COALESCE(SUM(si.quantity), 0) AS total_shipped
      FROM shipment_items si
      JOIN shipments s ON s.id = si.shipment_id
      JOIN invoice_items ii ON ii.id = si.invoice_item_id
      WHERE s.status != 'cancelled'
      GROUP BY ii.product_id
    ), base AS (
      SELECT
        p.id,
        p.title,
        p.code,
        p.category,
        p.status,
        p.stock_policy AS stockPolicy,
        COALESCE(inv.total_received, 0) AS totalReceived,
        COALESCE(inv.total_supplier_returned, 0) AS totalSupplierReturned,
        COALESCE(inv.total_receipt_cancelled, 0) AS totalReceiptCancelled,
        COALESCE(inv.net_received, 0) AS netReceived,
        COALESCE(inv.total_adjusted, 0) AS totalAdjusted,
        COALESCE(sales.invoiced_sales, 0) AS invoicedSales,
        COALESCE(returns.approved_customer_returns, 0) AS customerReturns,
        COALESCE(ship.total_shipped, 0) AS totalShipped
      FROM products p
      LEFT JOIN inventory inv ON inv.product_id = p.id
      LEFT JOIN invoice_sales sales ON sales.product_id = p.id
      LEFT JOIN customer_returns returns ON returns.product_id = p.id
      LEFT JOIN shipped ship ON ship.product_id = p.id
      ${where}
    )
    SELECT
      id,
      title,
      code,
      category,
      status,
      stockPolicy,
      totalReceived,
      totalSupplierReturned,
      totalReceiptCancelled,
      netReceived,
      totalAdjusted,
      invoicedSales,
      customerReturns,
      totalShipped,
      MAX(0, invoicedSales - customerReturns) AS netSales,
      netReceived + totalAdjusted - MAX(0, invoicedSales - customerReturns) AS stockBalance,
      netReceived + totalAdjusted + customerReturns - totalShipped AS rawAvailableToShip,
      MAX(0, netReceived + totalAdjusted + customerReturns - totalShipped) AS availableToShip,
      MAX(0, totalShipped - customerReturns) AS netDelivered,
      MAX(0, MAX(0, invoicedSales - customerReturns) - MAX(0, totalShipped - customerReturns)) AS remainingToFulfill,
      MAX(0, -(netReceived + totalAdjusted + customerReturns - totalShipped)) AS shippingSupplyGap
    FROM base
    ORDER BY title ASC${suffix}
  `;
  return { sql, params };
}

function normalize(row) {
  if (!row) return null;
  const numericFields = [
    'totalReceived',
    'totalSupplierReturned',
    'totalReceiptCancelled',
    'netReceived',
    'totalAdjusted',
    'invoicedSales',
    'customerReturns',
    'totalShipped',
    'netSales',
    'stockBalance',
    'rawAvailableToShip',
    'availableToShip',
    'netDelivered',
    'remainingToFulfill',
    'shippingSupplyGap'
  ];
  const result = { ...row };
  for (const field of numericFields) result[field] = Number(result[field] || 0);

  // Backwards-compatible aliases consumed by the existing dashboard/exporter.
  result.stock = result.stockBalance;
  result.currentStock = result.stockBalance;
  result.totalSold = result.invoicedSales;
  result.totalReturned = result.customerReturns;
  result.netSales = Math.max(0, result.netSales);
  // Reconciliation fields shown to management. A negative shipping balance
  // means stock was historically shipped without enough recorded supply; its
  // absolute value is a deficit, not additional stock available to ship.
  result.shippableStockBalance = result.rawAvailableToShip;
  result.remainingToShip = result.remainingToFulfill;
  result.supplyRequiredToFulfill = Math.max(0, -result.stockBalance);
  return result;
}

async function getProductMetrics(productId) {
  const normalizedId = Number(productId);
  if (!Number.isInteger(normalizedId) || normalizedId <= 0) return null;
  const { sql, params } = metricsSql({ where: 'WHERE p.id = ?', params: [normalizedId] });
  const rows = await db.all(sql, params);
  return normalize(rows[0]);
}

async function getProductMetricsMap(productIds = null) {
  let where = '';
  let params = [];
  if (Array.isArray(productIds)) {
    const ids = productIds.map(Number).filter(id => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return new Map();
    where = `WHERE p.id IN (${ids.map(() => '?').join(',')})`;
    params = ids;
  }
  const { sql } = metricsSql({ where, params });
  const rows = await db.all(sql, params);
  return new Map(rows.map(row => {
    const normalized = normalize(row);
    return [normalized.id, normalized];
  }));
}

async function getAllProductMetrics({ search = '', category = '', status = '', authorIds = null, limit = null, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (search) {
    clauses.push('(p.title LIKE ? OR p.code LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term);
  }
  if (category) {
    if (Number.isInteger(Number(category)) && String(category).trim() !== '') {
      clauses.push('p.id IN (SELECT product_id FROM product_categories WHERE category_id = ?)');
      params.push(Number(category));
    } else {
      clauses.push('p.id IN (SELECT pc.product_id FROM product_categories pc JOIN categories c ON pc.category_id = c.id WHERE c.name = ?)');
      params.push(category);
    }
  }
  if (status) {
    clauses.push('p.status = ?');
    params.push(status);
  }
  if (authorIds && authorIds.length > 0) {
    clauses.push(`p.id IN (SELECT product_id FROM product_authors WHERE author_id IN (${authorIds.map(() => '?').join(',')}))`);
    params.push(...authorIds);
  } else if (authorIds) {
    clauses.push('0=1');
  }
  let suffix = '';
  if (limit !== null && limit !== undefined && Number.isInteger(Number(limit)) && Number(limit) >= 0) {
    suffix = ' LIMIT ? OFFSET ?';
    params.push(Number(limit), Math.max(0, Number(offset) || 0));
  }
  const { sql } = metricsSql({
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
    suffix
  });
  const rows = await db.all(sql, params);
  return rows.map(normalize);
}

module.exports = {
  getProductMetrics,
  getProductMetricsMap,
  getAllProductMetrics
};
