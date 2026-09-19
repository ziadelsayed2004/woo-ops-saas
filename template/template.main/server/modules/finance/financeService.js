const db = require('../../db');
const paymentsService = require('../payments/paymentsService');
const inventoryMetricsService = require('../inventory/inventoryMetricsService');

/**
 * Record a manual financial adjustment (deposit, withdrawal, or receivable credit/debit adjustment).
 */
async function recordManualAdjustment({ outletId, amount, adjustmentType, title, notes, userId }) {
  const isOutletRequired = !['salary', 'expense'].includes(adjustmentType);
  const resolvedOutletId = outletId ? parseInt(outletId, 10) : null;

  if (isOutletRequired && !resolvedOutletId) {
    throw new Error('Outlet ID is required');
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Amount must be a positive number');
  }
  if (!adjustmentType || !['deposit', 'withdrawal', 'credit_adjustment', 'debit_adjustment', 'expense', 'salary'].includes(adjustmentType)) {
    throw new Error('Invalid adjustment type');
  }
  if (!notes || notes.trim() === '') {
    throw new Error('Notes/Reason is required for manual adjustments');
  }

  if (resolvedOutletId) {
    const outlet = await db.get('SELECT id FROM outlets WHERE id = ?', [resolvedOutletId]);
    if (!outlet) {
      throw new Error(`Outlet with ID ${resolvedOutletId} does not exist`);
    }
  }

  await db.exec('BEGIN TRANSACTION;');

  try {
    let signedAmount = parsedAmount;
    if (['withdrawal', 'credit_adjustment', 'expense', 'salary'].includes(adjustmentType)) {
      signedAmount = -parsedAmount;
    }

    const adjSql = `
      INSERT INTO manual_adjustments (outlet_id, amount, adjustment_type, title, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const adjResult = await db.run(adjSql, [resolvedOutletId, signedAmount, adjustmentType, title ? title.trim() : null, notes.trim(), userId]);
    const adjId = adjResult.lastID;

    let cashImpact = 0;
    let receivableImpact = 0;

    if (adjustmentType === 'deposit') {
      cashImpact = parsedAmount;
    } else if (adjustmentType === 'withdrawal') {
      cashImpact = -parsedAmount;
    } else if (adjustmentType === 'credit_adjustment') {
      receivableImpact = -parsedAmount;
    } else if (adjustmentType === 'debit_adjustment') {
      receivableImpact = parsedAmount;
    } else if (adjustmentType === 'expense') {
      cashImpact = -parsedAmount;
    } else if (adjustmentType === 'salary') {
      cashImpact = -parsedAmount;
    }

    await db.run(`
      INSERT INTO finance_ledger_entries (
        outlet_id, entry_type, reference_type, reference_id,
        cash_amount, receivable_amount, title, notes, created_by
      ) VALUES (?, 'manual_adjustment', 'manual', ?, ?, ?, ?, ?, ?)
    `, [resolvedOutletId, adjId, cashImpact, receivableImpact, title ? title.trim() : null, notes.trim(), userId]);

    await db.exec('COMMIT;');
    return {
      id: adjId,
      outletId: resolvedOutletId,
      amount: signedAmount,
      adjustmentType,
      title: title ? title.trim() : null,
      notes: notes.trim(),
      createdBy: userId
    };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Fetch overview finance metrics in Egypt timezone and EGP.
 */
function appendIdScope(query, column, ids) {
  if (!Array.isArray(ids)) return;
  if (ids.length === 0) {
    query.sql += ' AND 0=1';
    return;
  }

  query.sql += ` AND ${column} IN (${ids.map(() => '?').join(',')})`;
  query.params.push(...ids);
}

function appendInvoiceAuthorScope(query, invoiceAlias, authorIds) {
  if (!Array.isArray(authorIds)) return;
  if (authorIds.length === 0) {
    query.sql += ' AND 0=1';
    return;
  }

  query.sql += ` AND EXISTS (
    SELECT 1
    FROM invoice_items scoped_ii
    JOIN product_authors scoped_pa ON scoped_pa.product_id = scoped_ii.product_id
    WHERE scoped_ii.invoice_id = ${invoiceAlias}.id
      AND scoped_pa.author_id IN (${authorIds.map(() => '?').join(',')})
  )`;
  query.params.push(...authorIds);
}

function appendReturnAuthorScope(query, returnAlias, authorIds) {
  if (!Array.isArray(authorIds)) return;
  if (authorIds.length === 0) {
    query.sql += ' AND 0=1';
    return;
  }

  query.sql += ` AND EXISTS (
    SELECT 1
    FROM invoice_items scoped_ii
    JOIN product_authors scoped_pa ON scoped_pa.product_id = scoped_ii.product_id
    WHERE scoped_ii.invoice_id = ${returnAlias}.invoice_id
      AND scoped_pa.author_id IN (${authorIds.map(() => '?').join(',')})
  )`;
  query.params.push(...authorIds);
}

function appendLedgerAuthorScope(query, ledgerAlias, authorIds) {
  if (!Array.isArray(authorIds)) return;
  if (authorIds.length === 0) {
    query.sql += ' AND 0=1';
    return;
  }

  // Ledger rows point to invoices directly, or indirectly through a payment
  // or return. Resolve that invoice before applying the linked-author scope so
  // manual/general entries can never leak into an author summary.
  query.sql += ` AND EXISTS (
    SELECT 1
    FROM invoice_items scoped_ii
    JOIN product_authors scoped_pa ON scoped_pa.product_id = scoped_ii.product_id
    WHERE scoped_ii.invoice_id = CASE
      WHEN ${ledgerAlias}.reference_type = 'invoice' THEN ${ledgerAlias}.reference_id
      WHEN ${ledgerAlias}.reference_type = 'payment' THEN (
        SELECT scoped_payment.invoice_id
        FROM invoice_payments scoped_payment
        WHERE scoped_payment.id = ${ledgerAlias}.reference_id
      )
      WHEN ${ledgerAlias}.reference_type = 'return' THEN (
        SELECT scoped_return.invoice_id
        FROM returns scoped_return
        WHERE scoped_return.id = ${ledgerAlias}.reference_id
      )
      ELSE NULL
    END
      AND scoped_pa.author_id IN (${authorIds.map(() => '?').join(',')})
  )`;
  query.params.push(...authorIds);
}

function appendProductAuthorScope(query, productAlias, authorIds) {
  if (!Array.isArray(authorIds)) return;
  if (authorIds.length === 0) {
    query.sql += ' AND 0=1';
    return;
  }

  query.sql += ` AND EXISTS (
    SELECT 1
    FROM product_authors scoped_pa
    WHERE scoped_pa.product_id = ${productAlias}.id
      AND scoped_pa.author_id IN (${authorIds.map(() => '?').join(',')})
  )`;
  query.params.push(...authorIds);
}

async function getFinanceSummary(outletIds = null, authorIds = null) {
  const totalInvoicesQuery = { sql: `
    SELECT COALESCE(SUM(total_price), 0) as total, COUNT(*) as count
    FROM invoices i
    WHERE i.payment_status != 'cancelled'
  `, params: [] };
  const ledgerQuery = { sql: `
    SELECT 
      COALESCE(SUM(cash_amount), 0) as treasuryBalance,
      COALESCE(SUM(custody_amount), 0) as custodyBalance,
      COALESCE(SUM(receivable_amount), 0) as totalReceivables
    FROM finance_ledger_entries fle
    WHERE 1=1
  `, params: [] };
  const partialShipmentsQuery = { sql: `
    SELECT COUNT(*) as count
    FROM invoices i
    WHERE i.shipping_status = 'partially_shipped' AND i.payment_status != 'cancelled'
  `, params: [] };

  appendIdScope(totalInvoicesQuery, 'i.outlet_id', outletIds);
  appendInvoiceAuthorScope(totalInvoicesQuery, 'i', authorIds);
  appendIdScope(ledgerQuery, 'fle.outlet_id', outletIds);
  appendLedgerAuthorScope(ledgerQuery, 'fle', authorIds);
  appendIdScope(partialShipmentsQuery, 'i.outlet_id', outletIds);
  appendInvoiceAuthorScope(partialShipmentsQuery, 'i', authorIds);

  const suppliedQuery = { sql: `
    SELECT COALESCE(SUM(p.amount), 0) as total
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.payment_status != 'cancelled' AND p.supply_status = 'supplied' AND p.receipt_status = 'approved' AND p.reversed_at IS NULL
  `, params: [] };
  const unsuppliedQuery = { sql: `
    SELECT COALESCE(SUM(p.amount), 0) as total
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.payment_status != 'cancelled' AND p.supply_status = 'not_supplied' AND p.receipt_status = 'approved' AND p.reversed_at IS NULL
  `, params: [] };
  const unreviewedReceiptsQuery = { sql: `
    SELECT COALESCE(SUM(p.amount), 0) as total, COUNT(p.id) as count
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.payment_status != 'cancelled' AND p.receipt_status = 'pending_review' AND p.reversed_at IS NULL
  `, params: [] };
  const rejectedReceiptsQuery = { sql: `
    SELECT COALESCE(SUM(p.amount), 0) as total
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    WHERE i.payment_status != 'cancelled' AND p.receipt_status = 'rejected' AND p.reversed_at IS NULL
  `, params: [] };
  const returnsQuery = { sql: `
    SELECT COALESCE(SUM(return_value), 0) as total
    FROM returns r
    WHERE r.status = 'approved'
  `, params: [] };

  const invoicePaymentQueries = [
    suppliedQuery,
    unsuppliedQuery,
    unreviewedReceiptsQuery,
    rejectedReceiptsQuery
  ];
  const grossCollectedQuery = { sql: `
    SELECT COALESCE(SUM(p.amount), 0) AS total
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.payment_status != 'cancelled' AND p.receipt_status = 'approved' AND p.reversed_at IS NULL
  `, params: [] };
  for (const query of invoicePaymentQueries) {
    appendIdScope(query, 'i.outlet_id', outletIds);
    appendInvoiceAuthorScope(query, 'i', authorIds);
  }
  appendIdScope(grossCollectedQuery, 'i.outlet_id', outletIds);
  appendInvoiceAuthorScope(grossCollectedQuery, 'i', authorIds);
  appendIdScope(returnsQuery, 'r.outlet_id', outletIds);
  appendReturnAuthorScope(returnsQuery, 'r', authorIds);

  const invoiceRow = await db.get(totalInvoicesQuery.sql, totalInvoicesQuery.params);
  const ledgerRow = await db.get(ledgerQuery.sql, ledgerQuery.params);
  const suppliedRow = await db.get(suppliedQuery.sql, suppliedQuery.params);
  const unsuppliedRow = await db.get(unsuppliedQuery.sql, unsuppliedQuery.params);
  const unreviewedRow = await db.get(unreviewedReceiptsQuery.sql, unreviewedReceiptsQuery.params);
  const rejectedRow = await db.get(rejectedReceiptsQuery.sql, rejectedReceiptsQuery.params);
  const grossCollectedRow = await db.get(grossCollectedQuery.sql, grossCollectedQuery.params);
  const returnsRow = await db.get(returnsQuery.sql, returnsQuery.params);
  const partialShipmentsRow = await db.get(partialShipmentsQuery.sql, partialShipmentsQuery.params);
  // Stock alerts are derived from the shared balance calculation. Outlet
  // visibility must not expose the global operational stock count.
  let stockAlertsCount = 0;
  if (!Array.isArray(outletIds)) {
    const stockRows = await inventoryMetricsService.getAllProductMetrics({
      status: 'active',
      authorIds: Array.isArray(authorIds) ? authorIds : null
    });
    stockAlertsCount = stockRows.filter(row =>
      row.stockPolicy !== 'ignore' && Number(row.stockBalance) <= 10
    ).length;
  }

  const totalInvoices = invoiceRow.total;
  const totalInvoicesCount = invoiceRow.count;
  const totalCollected = grossCollectedRow.total;
  const treasuryBalance = ledgerRow.treasuryBalance;
  const custodyBalance = ledgerRow.custodyBalance;
  const totalReceivables = ledgerRow.totalReceivables;
  const suppliedBalance = suppliedRow.total;
  const unsuppliedBalance = unsuppliedRow.total;
  const unreviewedBalance = unreviewedRow.total;
  const unreviewedCount = unreviewedRow.count || 0;
  const rejectedBalance = rejectedRow.total;
  const returnBalance = returnsRow.total;
  const partialShipmentsCount = partialShipmentsRow ? partialShipmentsRow.count : 0;
  return {
    totalInvoices,
    totalInvoicesCount,
    totalCollected,
    totalReceivables,
    grossCollected: totalCollected,
    suppliedCollections: suppliedBalance,
    pendingSupply: unsuppliedBalance,
    treasuryBalance,
    custodyBalance,
    receivableBalance: totalReceivables,
    totalOverdue: 0,

    invoice_total: totalInvoices,
    collected_total: totalCollected,
    pending_balance: totalReceivables,
    pendingBalance: totalReceivables,
    actualBalance: treasuryBalance,
    suppliedBalance,
    unsuppliedBalance,
    supplied_balance: suppliedBalance,
    unsupplied_balance: unsuppliedBalance,

    pending: totalReceivables,
    collected: totalCollected,
    supplied: suppliedBalance,
    unsupplied: unsuppliedBalance,
    unreviewedReceipts: unreviewedBalance,
    unreviewedCount,
    rejectedReceipts: rejectedBalance,
    unreviewed_receipts: unreviewedBalance,
    unreviewed_count: unreviewedCount,
    rejected_receipts: rejectedBalance,
    returns: returnBalance,
    partialShipmentsCount,
    stockAlertsCount
  };
}

/**
 * Retrieve finance ledger entries history.
 */
async function getLedgerHistory({ limit = 50, offset = 0, outletId = null, startDate = '', endDate = '', entryType = '', entryGroup = '', supplyStatus = '', outletIds = null } = {}) {
  let sql = `
    SELECT fle.*, o.name as outlet_name, u.full_name as user_full_name,
           ip.amount as payment_amount, ip.supply_status as payment_supply_status,
           ip.payment_method, ip.reversed_at as payment_reversed_at,
           ma.amount as manual_amount, ma.adjustment_type
    FROM finance_ledger_entries fle
    LEFT JOIN outlets o ON o.id = fle.outlet_id
    LEFT JOIN users u ON u.id = fle.created_by
    LEFT JOIN invoice_payments ip ON ip.id = fle.reference_id AND fle.entry_type IN ('payment_recorded', 'payment_reversed', 'payment_supplied', 'supply_reversed')
    LEFT JOIN manual_adjustments ma ON ma.id = fle.reference_id AND fle.entry_type = 'manual_adjustment'
    WHERE 1=1
  `;
  const params = [];

  if (outletId) {
    sql += ` AND fle.outlet_id = ?`;
    params.push(outletId);
  }
  if (startDate) {
    sql += ` AND fle.created_at >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND fle.created_at <= ?`;
    params.push(`${endDate} 23:59:59`);
  }
  if (entryType) {
    sql += ` AND fle.entry_type = ?`;
    params.push(entryType);
  }
  if (entryGroup) {
    if (entryGroup === 'payments') {
      sql += ` AND fle.entry_type IN ('payment_recorded', 'payment_reversed', 'payment_supplied', 'supply_reversed')`;
    } else if (entryGroup === 'settlements') {
      sql += ` AND fle.entry_type = 'manual_adjustment'`;
    }
  }
  if (supplyStatus) {
    if (supplyStatus === 'supplied') {
      sql += ` AND fle.entry_type IN ('payment_supplied', 'supply_reversed')`;
    } else if (supplyStatus === 'not_supplied') {
      sql += ` AND fle.entry_type IN ('payment_recorded', 'payment_reversed')`;
    }
  }
  if (outletIds && outletIds.length > 0) {
    sql += ` AND fle.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }

  // Handle export cases where limit is not provided or explicitly 'all'
  if (limit === 'all') {
    sql += ` ORDER BY fle.created_at DESC, fle.id DESC`;
  } else {
    sql += ` ORDER BY fle.created_at DESC, fle.id DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
  }

  return await db.all(sql, params);
}

/**
 * Group balances by outlet.
 */
async function getBalancesByOutlet(outletIds = null) {
  let sql = `
    SELECT 
      o.id, 
      o.name, 
      o.governorate, 
      ot.name as outlet_type_name,
      o.credit_limit
    FROM outlets o
    JOIN outlet_types ot ON ot.id = o.outlet_type_id
    WHERE 1=1
  `;
  const params = [];
  if (outletIds && outletIds.length > 0) {
    sql += ` AND o.id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }
  
  sql += ` ORDER BY o.name ASC`;
  const outlets = await db.all(sql, params);

  const results = [];
  for (const outlet of outlets) {
    const summary = await getFinanceSummary([outlet.id]);
    results.push({
      id: outlet.id,
      name: outlet.name,
      governorate: outlet.governorate,
      outlet_type_name: outlet.outlet_type_name,
      credit_limit: outlet.credit_limit,
      invoice_total: summary.totalInvoices,
      collected_total: summary.totalCollected,
      treasury_balance: summary.treasuryBalance,
      custody_balance: summary.custodyBalance,
      pending_balance: summary.pendingBalance,
      supplied_balance: summary.suppliedBalance,
      unsupplied_balance: summary.unsuppliedBalance,
      collected_balance: summary.totalCollected,
      receivable_balance: summary.totalReceivables,
      return_balance: summary.returns
    });
  }
  return results;
}

/**
 * Group balances by governorate.
 */
async function getBalancesByGovernorate() {
  const sql = `
    SELECT 
      o.governorate,
      COALESCE(SUM(fle.cash_amount), 0) as collected_balance,
      COALESCE(SUM(fle.receivable_amount), 0) as receivable_balance
    FROM outlets o
    LEFT JOIN finance_ledger_entries fle ON fle.outlet_id = o.id
    GROUP BY o.governorate
    ORDER BY o.governorate ASC
  `;
  return await db.all(sql);
}

/**
 * Group balances by outlet type.
 */
async function getBalancesByOutletType() {
  const sql = `
    SELECT 
      ot.id,
      ot.name as outlet_type_name,
      COALESCE(SUM(fle.cash_amount), 0) as collected_balance,
      COALESCE(SUM(fle.receivable_amount), 0) as receivable_balance
    FROM outlet_types ot
    LEFT JOIN outlets o ON o.outlet_type_id = ot.id
    LEFT JOIN finance_ledger_entries fle ON fle.outlet_id = o.id
    GROUP BY ot.id
    ORDER BY ot.name ASC
  `;
  return await db.all(sql);
}

/**
 * Generate per-outlet statement of account in chronological order.
 */
async function getOutletStatement(outletId) {
  const outlet = await db.get('SELECT * FROM outlets WHERE id = ?', [outletId]);
  if (!outlet) {
    throw new Error(`Outlet with ID ${outletId} does not exist`);
  }

  const entries = await db.all(`
    SELECT fle.*, u.full_name as user_full_name
    FROM finance_ledger_entries fle
    LEFT JOIN users u ON u.id = fle.created_by
    WHERE fle.outlet_id = ?
    ORDER BY fle.created_at ASC, fle.id ASC
  `, [outletId]);

  let runningReceivable = 0;
  let runningCash = 0;
  let runningCustody = 0;

  const statement = entries.map(entry => {
    runningReceivable += entry.receivable_amount || 0;
    runningCash += entry.cash_amount || 0;
    runningCustody += entry.custody_amount || 0;
    return {
      id: entry.id,
      entry_type: entry.entry_type,
      reference_type: entry.reference_type,
      reference_id: entry.reference_id,
      cash_amount: entry.cash_amount,
      custody_amount: entry.custody_amount || 0,
      receivable_amount: entry.receivable_amount,
      notes: entry.notes,
      created_by: entry.created_by,
      user_full_name: entry.user_full_name,
      created_at: entry.created_at,
      running_receivable: parseFloat(runningReceivable.toFixed(2)),
      running_cash: parseFloat(runningCash.toFixed(2)),
      running_custody: parseFloat(runningCustody.toFixed(2))
    };
  });

  const summary = await getFinanceSummary([outletId]);

  return {
    outlet: {
      id: outlet.id,
      name: outlet.name,
      governorate: outlet.governorate,
      credit_limit: outlet.credit_limit
    },
    summary: {
      invoice_total: summary.invoice_total,
      collected_total: summary.collected_total,
      supplied_balance: summary.supplied_balance,
      unsupplied_balance: summary.unsupplied_balance,
      return_balance: summary.returns,
      pending_balance: summary.pending_balance,
      net_exposure: summary.pending_balance
    },
    statement
  };
}

module.exports = {
  recordManualAdjustment,
  getFinanceSummary,
  getLedgerHistory,
  getBalancesByOutlet,
  getBalancesByGovernorate,
  getBalancesByOutletType,
  getOutletStatement
};
