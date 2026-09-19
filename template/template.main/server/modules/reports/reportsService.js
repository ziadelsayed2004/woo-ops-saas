const db = require('../../db');
const inventoryMetricsService = require('../inventory/inventoryMetricsService');

async function getPaymentTotalsByGroup({ groupBy, startDate = '', endDate = '', outletIds = null, outletTypeId = null, governorate = '' }) {
  const groupExpression = groupBy === 'governorate' ? 'o.governorate' : groupBy === 'outletTypeId' ? 'o.outlet_type_id' : 'i.outlet_id';
  let sql = `
    SELECT ${groupExpression} AS group_key,
           COALESCE(SUM(ip.amount), 0) AS totalPaid,
           COALESCE(SUM(CASE WHEN ip.supply_status = 'supplied' THEN ip.amount ELSE 0 END), 0) AS suppliedCollections,
           COALESCE(SUM(CASE WHEN ip.supply_status = 'not_supplied' THEN ip.amount ELSE 0 END), 0) AS pendingSupply
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.payment_status != 'cancelled' AND ip.receipt_status = 'approved' AND ip.reversed_at IS NULL`;
  const params = [];
  if (startDate) { sql += ' AND ip.payment_date >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND ip.payment_date <= ?'; params.push(`${endDate} 23:59:59`); }
  if (outletIds && outletIds.length > 0) { sql += ` AND i.outlet_id IN (${outletIds.map(() => '?').join(',')})`; params.push(...outletIds); }
  if (outletTypeId) { sql += ' AND o.outlet_type_id = ?'; params.push(outletTypeId); }
  if (governorate) { sql += ' AND o.governorate = ?'; params.push(governorate); }
  sql += ` GROUP BY ${groupExpression}`;
  const rows = await db.all(sql, params);
  return new Map(rows.map(row => [String(row.group_key), row]));
}

/**
 * Get overall financial summary.
 */
async function getFinancialSummary({ startDate = '', endDate = '', outletId = null, outletTypeId = null, governorate = '', authorIds = null } = {}) {
  // 1. Calculate sales metrics from invoices table
  let salesSql = `
    SELECT 
      COALESCE(SUM(i.total_price), 0) as totalSales,
      COALESCE(SUM(i.shipping_cost), 0) as totalShipping,
      COALESCE(SUM(i.discount), 0) as totalDiscount,
      COALESCE(SUM(i.subtotal), 0) as totalSubtotal,
      COALESCE(SUM(CASE WHEN i.payment_type = 'deferred' THEN i.total_price ELSE 0 END), 0) as totalDeferredRemaining,
      COALESCE(SUM(CASE WHEN i.payment_type = 'cash' THEN i.total_price ELSE 0 END), 0) as totalCashSales
    FROM invoices i
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.payment_status != 'cancelled'
  `;
  const salesParams = [];

  if (authorIds && authorIds.length > 0) {
    salesSql += ` AND i.id IN (
      SELECT ii.invoice_id
      FROM invoice_items ii
      JOIN product_authors pa ON pa.product_id = ii.product_id
      WHERE pa.author_id IN (${authorIds.map(() => '?').join(',')})
    )`;
    salesParams.push(...authorIds);
  } else if (authorIds) {
    salesSql += ` AND 0=1`;
  }

  if (startDate) {
    salesSql += ` AND i.created_at >= ?`;
    salesParams.push(startDate);
  }
  if (endDate) {
    salesSql += ` AND i.created_at <= ?`;
    salesParams.push(`${endDate} 23:59:59`);
  }
  if (outletId) {
    salesSql += ` AND i.outlet_id = ?`;
    salesParams.push(outletId);
  }
  if (outletTypeId) {
    salesSql += ` AND o.outlet_type_id = ?`;
    salesParams.push(outletTypeId);
  }
  if (governorate) {
    salesSql += ` AND o.governorate = ?`;
    salesParams.push(governorate);
  }

  const salesRow = await db.get(salesSql, salesParams);

  // 2. Calculate paid & remaining metrics from finance ledger
  let ledgerSql = `
    SELECT 
      COALESCE(SUM(fle.cash_amount), 0) as treasuryBalance,
      COALESCE(SUM(fle.custody_amount), 0) as custodyBalance,
      COALESCE(SUM(fle.receivable_amount), 0) as totalReceivables
    FROM finance_ledger_entries fle
    JOIN outlets o ON o.id = fle.outlet_id
    WHERE 1=1
  `;
  const ledgerParams = [];

  if (authorIds && authorIds.length > 0) {
    ledgerSql += ` AND (
      (fle.reference_type = 'invoice' AND fle.reference_id IN (
        SELECT ii.invoice_id
        FROM invoice_items ii
        JOIN product_authors pa ON pa.product_id = ii.product_id
        WHERE pa.author_id IN (${authorIds.map(() => '?').join(',')})
      ))
      OR
      (fle.reference_type = 'payment' AND fle.reference_id IN (
        SELECT ip.id
        FROM invoice_payments ip
        WHERE ip.invoice_id IN (
          SELECT ii.invoice_id
          FROM invoice_items ii
          JOIN product_authors pa ON pa.product_id = ii.product_id
          WHERE pa.author_id IN (${authorIds.map(() => '?').join(',')})
        )
      ))
    )`;
    ledgerParams.push(...authorIds, ...authorIds);
  } else if (authorIds) {
    ledgerSql += ` AND 0=1`;
  }

  if (startDate) {
    ledgerSql += ` AND fle.created_at >= ?`;
    ledgerParams.push(startDate);
  }
  if (endDate) {
    ledgerSql += ` AND fle.created_at <= ?`;
    ledgerParams.push(`${endDate} 23:59:59`);
  }
  if (outletId) {
    ledgerSql += ` AND fle.outlet_id = ?`;
    ledgerParams.push(outletId);
  }
  if (outletTypeId) {
    ledgerSql += ` AND o.outlet_type_id = ?`;
    ledgerParams.push(outletTypeId);
  }
  if (governorate) {
    ledgerSql += ` AND o.governorate = ?`;
    ledgerParams.push(governorate);
  }

  const ledgerRow = await db.get(ledgerSql, ledgerParams);

  // 3. Calculate supplied & unsupplied payment metrics from invoice_payments table
  let paymentSql = `
    SELECT 
      COALESCE(SUM(ip.amount), 0) as totalPaid,
      COALESCE(SUM(CASE WHEN ip.supply_status = 'supplied' THEN ip.amount ELSE 0 END), 0) as totalSupplied,
      COALESCE(SUM(CASE WHEN ip.supply_status = 'not_supplied' THEN ip.amount ELSE 0 END), 0) as totalUnsupplied
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.payment_status != 'cancelled' AND ip.receipt_status = 'approved' AND ip.reversed_at IS NULL
  `;
  const paymentParams = [];

  if (authorIds && authorIds.length > 0) {
    paymentSql += ` AND i.id IN (
      SELECT ii.invoice_id
      FROM invoice_items ii
      JOIN product_authors pa ON pa.product_id = ii.product_id
      WHERE pa.author_id IN (${authorIds.map(() => '?').join(',')})
    )`;
    paymentParams.push(...authorIds);
  } else if (authorIds) {
    paymentSql += ` AND 0=1`;
  }

  if (startDate) {
    paymentSql += ` AND ip.payment_date >= ?`;
    paymentParams.push(startDate);
  }
  if (endDate) {
    paymentSql += ` AND ip.payment_date <= ?`;
    paymentParams.push(`${endDate} 23:59:59`);
  }
  if (outletId) {
    paymentSql += ` AND i.outlet_id = ?`;
    paymentParams.push(outletId);
  }
  if (outletTypeId) {
    paymentSql += ` AND o.outlet_type_id = ?`;
    paymentParams.push(outletTypeId);
  }
  if (governorate) {
    paymentSql += ` AND o.governorate = ?`;
    paymentParams.push(governorate);
  }

  const paymentRow = await db.get(paymentSql, paymentParams);

  // 4. Calculate invoice shipping status counts
  let shipSql = `
    SELECT 
      COALESCE(SUM(CASE WHEN i.shipping_status = 'shipped' THEN 1 ELSE 0 END), 0) as countShipped,
      COALESCE(SUM(CASE WHEN i.shipping_status = 'partially_shipped' THEN 1 ELSE 0 END), 0) as countPartiallyShipped,
      COALESCE(SUM(CASE WHEN i.shipping_status = 'pending' THEN 1 ELSE 0 END), 0) as countNotShipped
    FROM invoices i
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.payment_status != 'cancelled'
  `;
  const shipParams = [];

  if (authorIds && authorIds.length > 0) {
    shipSql += ` AND i.id IN (
      SELECT ii.invoice_id
      FROM invoice_items ii
      JOIN product_authors pa ON pa.product_id = ii.product_id
      WHERE pa.author_id IN (${authorIds.map(() => '?').join(',')})
    )`;
    shipParams.push(...authorIds);
  } else if (authorIds) {
    shipSql += ` AND 0=1`;
  }

  if (startDate) {
    shipSql += ` AND i.created_at >= ?`;
    shipParams.push(startDate);
  }
  if (endDate) {
    shipSql += ` AND i.created_at <= ?`;
    shipParams.push(`${endDate} 23:59:59`);
  }
  if (outletId) {
    shipSql += ` AND i.outlet_id = ?`;
    shipParams.push(outletId);
  }
  if (outletTypeId) {
    shipSql += ` AND o.outlet_type_id = ?`;
    shipParams.push(outletTypeId);
  }
  if (governorate) {
    shipSql += ` AND o.governorate = ?`;
    shipParams.push(governorate);
  }

  const shipRow = await db.get(shipSql, shipParams);

  const totalSales = parseFloat(salesRow.totalSales || 0);
  const totalPaid = parseFloat(paymentRow.totalPaid || 0);
  const totalRemaining = parseFloat(ledgerRow.totalReceivables || 0);

  return {
    totalSales,
    totalPaid,
    totalRemaining,
    totalShipping: parseFloat(salesRow.totalShipping || 0),
    totalDiscount: parseFloat(salesRow.totalDiscount || 0),
    totalSubtotal: parseFloat(salesRow.totalSubtotal || 0),
    totalDeferredRemaining: parseFloat(salesRow.totalDeferredRemaining || 0),
    totalCashSales: parseFloat(salesRow.totalCashSales || 0),
    totalSupplied: parseFloat(paymentRow.totalSupplied || 0),
    totalUnsupplied: parseFloat(paymentRow.totalUnsupplied || 0),
    grossCollected: totalPaid,
    suppliedCollections: parseFloat(paymentRow.totalSupplied || 0),
    pendingSupply: parseFloat(paymentRow.totalUnsupplied || 0),
    receivableBalance: totalRemaining,
    treasuryBalance: parseFloat(ledgerRow.treasuryBalance || 0),
    custodyBalance: parseFloat(ledgerRow.custodyBalance || 0),
    countShipped: parseInt(shipRow.countShipped || 0, 10),
    countPartiallyShipped: parseInt(shipRow.countPartiallyShipped || 0, 10),
    countNotShipped: parseInt(shipRow.countNotShipped || 0, 10)
  };
}

/**
 * Get balances grouped by outlet.
 */
async function getBalancesByOutlet({ startDate = '', endDate = '', governorate = '', outletTypeId = null, outletIds = null } = {}) {
  let sql = `
    SELECT 
      o.id as outletId,
      o.name as outletName,
      ot.name as outletTypeName,
      o.governorate,
      o.credit_limit as creditLimit,
      COALESCE(i_sum.totalSales, 0) as totalSales,
      COALESCE(fle_sum.totalCollected, 0) as totalPaid,
      COALESCE(fle_sum.totalReceivables, 0) as remainingAmount
    FROM outlets o
    JOIN outlet_types ot ON ot.id = o.outlet_type_id
    LEFT JOIN (
      SELECT 
        i.outlet_id,
        SUM(i.total_price) as totalSales
      FROM invoices i
      WHERE i.payment_status != 'cancelled'
  `;
  const params = [];
  if (startDate) {
    sql += ` AND i.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND i.created_at <= ?`;
    params.push(`${endDate} 23:59:59`);
  }
  if (outletIds && outletIds.length > 0) {
    sql += ` AND i.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  }
  sql += `
      GROUP BY i.outlet_id
    ) i_sum ON i_sum.outlet_id = o.id
    LEFT JOIN (
      SELECT 
        fle.outlet_id,
        SUM(fle.cash_amount) as totalCollected,
        SUM(fle.receivable_amount) as totalReceivables
      FROM finance_ledger_entries fle
      WHERE 1=1
  `;
  
  const fleParams = [];
  if (startDate) {
    sql += ` AND fle.created_at >= ?`;
    fleParams.push(startDate);
  }
  if (endDate) {
    sql += ` AND fle.created_at <= ?`;
    fleParams.push(`${endDate} 23:59:59`);
  }
  if (outletIds && outletIds.length > 0) {
    sql += ` AND fle.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    fleParams.push(...outletIds);
  }
  sql += `
      GROUP BY fle.outlet_id
    ) fle_sum ON fle_sum.outlet_id = o.id
    WHERE 1=1
  `;

  const whereParams = [];
  if (governorate) {
    sql += ` AND o.governorate = ?`;
    whereParams.push(governorate);
  }
  if (outletTypeId) {
    sql += ` AND o.outlet_type_id = ?`;
    whereParams.push(outletTypeId);
  }
  if (outletIds && outletIds.length > 0) {
    sql += ` AND o.id IN (${outletIds.map(() => '?').join(',')})`;
    whereParams.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }
  sql += ` ORDER BY o.name ASC`;

  const allParams = [...params, ...fleParams, ...whereParams];
  const rows = await db.all(sql, allParams);
  const paymentTotals = await getPaymentTotalsByGroup({ groupBy: 'outletId', startDate, endDate, outletIds, outletTypeId, governorate });
  return rows.map(row => ({
    ...row,
    totalPaid: Number(paymentTotals.get(String(row.outletId))?.totalPaid || 0),
    suppliedCollections: Number(paymentTotals.get(String(row.outletId))?.suppliedCollections || 0),
    pendingSupply: Number(paymentTotals.get(String(row.outletId))?.pendingSupply || 0)
  }));
}

/**
 * Get balances grouped by governorate.
 */
async function getBalancesByGovernorate({ startDate = '', endDate = '', outletTypeId = null } = {}) {
  let sql = `
    SELECT 
      o.governorate,
      COALESCE(i_sum.totalSales, 0) as totalSales,
      COALESCE(fle_sum.totalCollected, 0) as totalPaid,
      COALESCE(fle_sum.totalReceivables, 0) as remainingAmount
    FROM (SELECT DISTINCT governorate FROM outlets WHERE governorate IS NOT NULL AND governorate != ''`;
  const govParams = [];
  if (outletTypeId) {
    sql += ` AND outlet_type_id = ?`;
    govParams.push(outletTypeId);
  }
  sql += `) o
    LEFT JOIN (
      SELECT 
        o2.governorate,
        SUM(i.total_price) as totalSales
      FROM invoices i
      JOIN outlets o2 ON o2.id = i.outlet_id
      WHERE i.payment_status != 'cancelled'
  `;
  const params = [];
  if (outletTypeId) {
    sql += ` AND o2.outlet_type_id = ?`;
    params.push(outletTypeId);
  }
  if (startDate) {
    sql += ` AND i.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND i.created_at <= ?`;
    params.push(`${endDate} 23:59:59`);
  }
  sql += `
      GROUP BY o2.governorate
    ) i_sum ON i_sum.governorate = o.governorate
    LEFT JOIN (
      SELECT 
        o3.governorate,
        SUM(fle.cash_amount) as totalCollected,
        SUM(fle.receivable_amount) as totalReceivables
      FROM finance_ledger_entries fle
      JOIN outlets o3 ON o3.id = fle.outlet_id
      WHERE 1=1
  `;
  const fleParams = [];
  if (outletTypeId) {
    sql += ` AND o3.outlet_type_id = ?`;
    fleParams.push(outletTypeId);
  }
  if (startDate) {
    sql += ` AND fle.created_at >= ?`;
    fleParams.push(startDate);
  }
  if (endDate) {
    sql += ` AND fle.created_at <= ?`;
    fleParams.push(`${endDate} 23:59:59`);
  }
  sql += `
      GROUP BY o3.governorate
    ) fle_sum ON fle_sum.governorate = o.governorate
    ORDER BY o.governorate ASC
  `;
  const allParams = [...govParams, ...params, ...fleParams];
  const rows = await db.all(sql, allParams);
  const paymentTotals = await getPaymentTotalsByGroup({ groupBy: 'governorate', startDate, endDate, outletTypeId });
  return rows.map(row => ({
    ...row,
    totalPaid: Number(paymentTotals.get(String(row.governorate))?.totalPaid || 0),
    suppliedCollections: Number(paymentTotals.get(String(row.governorate))?.suppliedCollections || 0),
    pendingSupply: Number(paymentTotals.get(String(row.governorate))?.pendingSupply || 0)
  }));
}

/**
 * Get balances grouped by outlet type.
 */
async function getBalancesByOutletType({ startDate = '', endDate = '' } = {}) {
  let sql = `
    SELECT 
      ot.id as outletTypeId,
      ot.name as outletTypeName,
      COALESCE(i_sum.totalSales, 0) as totalSales,
      COALESCE(fle_sum.totalCollected, 0) as totalPaid,
      COALESCE(fle_sum.totalReceivables, 0) as remainingAmount
    FROM outlet_types ot
    LEFT JOIN (
      SELECT 
        o.outlet_type_id,
        SUM(i.total_price) as totalSales
      FROM invoices i
      JOIN outlets o ON o.id = i.outlet_id
      WHERE i.payment_status != 'cancelled'
  `;
  const params = [];
  if (startDate) {
    sql += ` AND i.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND i.created_at <= ?`;
    params.push(`${endDate} 23:59:59`);
  }
  sql += `
      GROUP BY o.outlet_type_id
    ) i_sum ON i_sum.outlet_type_id = ot.id
    LEFT JOIN (
      SELECT 
        o2.outlet_type_id,
        SUM(fle.cash_amount) as totalCollected,
        SUM(fle.receivable_amount) as totalReceivables
      FROM finance_ledger_entries fle
      JOIN outlets o2 ON o2.id = fle.outlet_id
      WHERE 1=1
  `;
  const fleParams = [];
  if (startDate) {
    sql += ` AND fle.created_at >= ?`;
    fleParams.push(startDate);
  }
  if (endDate) {
    sql += ` AND fle.created_at <= ?`;
    fleParams.push(`${endDate} 23:59:59`);
  }
  sql += `
      GROUP BY o2.outlet_type_id
    ) fle_sum ON fle_sum.outlet_type_id = ot.id
    ORDER BY ot.name ASC
  `;
  const allParams = [...params, ...fleParams];
  const rows = await db.all(sql, allParams);
  const paymentTotals = await getPaymentTotalsByGroup({ groupBy: 'outletTypeId', startDate, endDate });
  return rows.map(row => ({
    ...row,
    totalPaid: Number(paymentTotals.get(String(row.outletTypeId))?.totalPaid || 0),
    suppliedCollections: Number(paymentTotals.get(String(row.outletTypeId))?.suppliedCollections || 0),
    pendingSupply: Number(paymentTotals.get(String(row.outletTypeId))?.pendingSupply || 0)
  }));
}

async function getStockReport({ search = '', category = '', status = '', authorIds = null } = {}) {
  const rows = await inventoryMetricsService.getAllProductMetrics({ search, category, status, authorIds });
  return rows.map(row => ({
    ...row,
    productId: row.id,
    productTitle: row.title,
    productCode: row.code,
    stockPolicy: row.stockPolicy,
    totalSold: row.invoicedSales,
    totalReturned: row.customerReturns,
    currentStock: row.stockBalance
  }));
}

/**
 * Get authors report.
 */
async function getAuthorReport({ search = '', status = '', authorIds = null } = {}) {
  let sql = `
    SELECT 
      a.id as authorId,
      a.name as authorName,
      a.status,
      COUNT(DISTINCT pa.product_id) as totalBooks,
      COALESCE(SUM(ii.total_price), 0) as totalSales,
      COALESCE(SUM(ii.quantity), 0) as totalCopiesSold,
      0 as currentStock
    FROM authors a
    LEFT JOIN product_authors pa ON pa.author_id = a.id
    LEFT JOIN invoice_items ii ON ii.product_id = pa.product_id
    WHERE 1=1
  `;
  const params = [];

  if (authorIds && authorIds.length > 0) {
    sql += ` AND a.id IN (${authorIds.map(() => '?').join(',')})`;
    params.push(...authorIds);
  } else if (authorIds) {
    sql += ` AND 0=1`;
  }

  if (search) {
    sql += ` AND a.name LIKE ?`;
    params.push(`%${search}%`);
  }
  if (status) {
    sql += ` AND a.status = ?`;
    params.push(status);
  }

  sql += ` GROUP BY a.id ORDER BY a.name ASC`;

  const rows = await db.all(sql, params);
  if (rows.length === 0) return rows;

  // Author stock must use the same product-level balance as the inventory
  // report. The legacy transaction sum includes invoice-edit reversal rows
  // whose meaning is intentionally kept only in the audit ledger.
  const authorProducts = await db.all(`
    SELECT author_id as authorId, product_id as productId
    FROM product_authors
    WHERE author_id IN (${rows.map(() => '?').join(',')})
  `, rows.map(row => row.authorId));
  const productIds = [...new Set(authorProducts.map(row => Number(row.productId)))];
  const productMetrics = await inventoryMetricsService.getProductMetricsMap(productIds);
  const stockByAuthor = new Map();
  for (const link of authorProducts) {
    const authorId = Number(link.authorId);
    const productId = Number(link.productId);
    if (!productMetrics.has(productId)) continue;
    if (!stockByAuthor.has(authorId)) stockByAuthor.set(authorId, new Set());
    stockByAuthor.get(authorId).add(productId);
  }

  return rows.map(row => {
    const productSet = stockByAuthor.get(Number(row.authorId)) || new Set();
    const currentStock = [...productSet].reduce(
      (sum, productId) => sum + Number(productMetrics.get(productId)?.stockBalance || 0),
      0
    );
    return { ...row, currentStock };
  });
}

/**
 * Get supplier receipt summary report.
 */
async function getReceiptReport({ search = '', startDate = '', endDate = '', authorIds = null } = {}) {
  let sql = `
    SELECT 
      COALESCE(r.supplier_name, 'Unknown Supplier') as supplierName,
      COUNT(r.id) as totalReceipts,
      COALESCE(SUM(items_sum.totalQty), 0) as totalQuantity,
      COALESCE(SUM(items_sum.returnedQty), 0) as totalReturnedQuantity,
      COALESCE(SUM(items_sum.totalQty - items_sum.returnedQty), 0) as netQuantity,
      COALESCE(SUM(items_sum.totalCost), 0) as totalCost
    FROM inventory_receipts r
    LEFT JOIN (
      SELECT ri.receipt_id,
        SUM(ri.quantity) as totalQty,
        SUM(ri.quantity * ri.unit_cost) as totalCost,
        SUM(COALESCE(ret.returnedQty, 0)) as returnedQty
      FROM inventory_receipt_items ri
      LEFT JOIN (
        SELECT receipt_item_id, SUM(quantity) as returnedQty
        FROM inventory_receipt_return_items
        GROUP BY receipt_item_id
      ) ret ON ret.receipt_item_id = ri.id
      GROUP BY ri.receipt_id
    ) items_sum ON items_sum.receipt_id = r.id
    WHERE r.status != 'cancelled'
  `;
  const params = [];

  if (authorIds && authorIds.length > 0) {
    sql += ` AND r.id IN (
      SELECT receipt_id FROM inventory_receipt_items WHERE product_id IN (
        SELECT product_id FROM product_authors WHERE author_id IN (${authorIds.map(() => '?').join(',')})
      )
    )`;
    params.push(...authorIds);
  } else if (authorIds) {
    sql += ` AND 0=1`;
  }

  if (search) {
    sql += ` AND r.supplier_name LIKE ?`;
    params.push(`%${search}%`);
  }
  if (startDate) {
    sql += ` AND r.received_date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND r.received_date <= ?`;
    params.push(`${endDate} 23:59:59`);
  }

  sql += ` GROUP BY r.supplier_name ORDER BY r.supplier_name ASC`;

  return await db.all(sql, params);
}

async function getProductOptions({ search = '', authorIds = null } = {}) {
  let sql = `SELECT p.id, p.title, p.code FROM products p WHERE p.status = 'active'`;
  const params = [];
  if (authorIds && authorIds.length > 0) {
    sql += ` AND p.id IN (SELECT product_id FROM product_authors WHERE author_id IN (${authorIds.map(() => '?').join(',')}))`;
    params.push(...authorIds);
  } else if (authorIds) {
    sql += ' AND 0=1';
  }
  if (search) {
    sql += ' AND (p.title LIKE ? OR p.code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY p.title ASC LIMIT 1000';
  return await db.all(sql, params);
}

async function getProductSalesByGovernorate({ productId, startDate = '', endDate = '', governorate = '', outletTypeId = null, authorIds = null } = {}) {
  if (!productId) throw new Error('Product ID is required');
  let sql = `
    WITH line_data AS (
      SELECT i.id as invoice_id, i.payment_status, o.governorate, o.id as outlet_id,
             ii.id as invoice_item_id, ii.quantity as ordered_quantity,
             COALESCE(ii.free_quantity, 0) as free_quantity,
             COALESCE(ret.returned_quantity, 0) as returned_quantity,
             COALESCE(ship.shipped_quantity, 0) as shipped_quantity
      FROM invoices i
      JOIN outlets o ON o.id = i.outlet_id
      JOIN invoice_items ii ON ii.invoice_id = i.id
      LEFT JOIN (
        SELECT ri.invoice_item_id, SUM(ri.quantity) as returned_quantity
        FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
        WHERE r.status = 'approved'
        GROUP BY ri.invoice_item_id
      ) ret ON ret.invoice_item_id = ii.id
      LEFT JOIN (
        SELECT si.invoice_item_id, SUM(si.quantity) as shipped_quantity
        FROM shipment_items si
        JOIN shipments s ON s.id = si.shipment_id
        WHERE s.status != 'cancelled'
        GROUP BY si.invoice_item_id
      ) ship ON ship.invoice_item_id = ii.id
      WHERE i.payment_status != 'cancelled' AND ii.product_id = ?
  `;
  const params = [Number(productId)];
  if (startDate) { sql += ' AND date(i.created_at) >= date(?)'; params.push(startDate); }
  if (endDate) { sql += ' AND date(i.created_at) <= date(?)'; params.push(endDate); }
  if (governorate) { sql += ' AND o.governorate = ?'; params.push(governorate); }
  if (outletTypeId) { sql += ' AND o.outlet_type_id = ?'; params.push(outletTypeId); }
  if (authorIds && authorIds.length > 0) {
    sql += ` AND ii.product_id IN (SELECT product_id FROM product_authors WHERE author_id IN (${authorIds.map(() => '?').join(',')}))`;
    params.push(...authorIds);
  } else if (authorIds) {
    sql += ' AND 0=1';
  }
  sql += `
    ), normalized AS (
      SELECT *, MAX(0, ordered_quantity - returned_quantity) as net_quantity,
             MAX(0, shipped_quantity - returned_quantity) as net_customer_quantity,
             MAX(0, ordered_quantity - shipped_quantity) as remaining_to_ship
      FROM line_data
    )
    SELECT COALESCE(governorate, 'غير مصنف') as governorate,
           COUNT(DISTINCT invoice_id) as invoiceCount,
           COUNT(DISTINCT outlet_id) as outletCount,
           SUM(ordered_quantity) as totalQuantity,
           SUM(ordered_quantity - free_quantity) as billableQuantity,
           SUM(free_quantity) as freeQuantity,
           SUM(returned_quantity) as returnedQuantity,
           SUM(net_quantity) as netQuantity,
           SUM(shipped_quantity) as shippedQuantity,
           SUM(remaining_to_ship) as remainingToShip,
           SUM(net_customer_quantity) as netCustomerQuantity,
           SUM(CASE WHEN payment_status = 'paid' THEN net_quantity ELSE 0 END) as paidQuantity,
           SUM(CASE WHEN payment_status = 'partially_paid' THEN net_quantity ELSE 0 END) as partiallyPaidQuantity,
           SUM(CASE WHEN payment_status = 'unpaid' THEN net_quantity ELSE 0 END) as unpaidQuantity
    FROM normalized
    GROUP BY governorate
    ORDER BY governorate ASC
  `;
  return await db.all(sql, params);
}

module.exports = {
  getFinancialSummary,
  getBalancesByOutlet,
  getBalancesByGovernorate,
  getBalancesByOutletType,
  getStockReport,
  getAuthorReport,
  getReceiptReport,
  getProductOptions,
  getProductSalesByGovernorate
};
