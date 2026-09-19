const db = require('../../db');
const crypto = require('crypto');
const notificationsService = require('../notifications/notificationsService');
const auditService = require('../audit/auditService');
const config = require('../../config');


/**
 * Recalculate invoice payment status.
 */
async function recalculatePaymentMetrics(invoiceId) {
  const invoice = await db.get(`
    SELECT i.total_price, i.payment_status, i.payment_type,
      COALESCE((
        SELECT SUM(r.return_value) FROM returns r
        WHERE r.invoice_id = i.id AND r.status != 'cancelled'
      ), 0) AS returned_amount
    FROM invoices i
    WHERE i.id = ?
  `, [invoiceId]);
  if (!invoice) return;

  const payments = await db.all('SELECT amount FROM invoice_payments WHERE invoice_id = ? AND receipt_status = "approved" AND reversed_at IS NULL', [invoiceId]);
  const totalPaid = parseFloat(payments.reduce((sum, p) => sum + p.amount, 0).toFixed(2));

  // Determine new payment status
  let newStatus = 'unpaid';
  const netInvoiceAmount = Math.max(0, invoice.total_price - Number(invoice.returned_amount || 0));
  if (totalPaid >= netInvoiceAmount) {
    newStatus = 'paid';
  } else if (totalPaid > 0) {
    newStatus = 'partially_paid';
  }

  // Update invoice header status
  if (newStatus !== invoice.payment_status) {
    await db.run('UPDATE invoices SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newStatus, invoiceId]);
    
    // Log in status history
    await db.run(
      'INSERT INTO invoice_status_history (invoice_id, status_type, old_status, new_status, notes) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, 'payment', invoice.payment_status, newStatus, `Payment status updated to ${newStatus}.`]
    );
  }
}

/**
 * Record a payment collection.
 */
async function recordPayment({ invoiceId, amount, paymentMethod, paymentDate, referenceNumber = '', notes = '', supplyStatus = 'not_supplied', userId, receiptName, receiptData }) {
  if (!invoiceId) {
    throw new Error('Invoice ID is required');
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    throw new Error('Payment amount must be a positive number');
  }
  if (!paymentMethod) {
    throw new Error('Payment method is required');
  }
  const activeMethod = await db.get('SELECT key FROM payment_methods WHERE key = ? AND is_active = 1', [paymentMethod]);
  if (!activeMethod) {
    throw new Error('Payment method is inactive or does not exist');
  }
  if (!['supplied', 'not_supplied'].includes(supplyStatus)) {
    throw new Error('Invalid supply status');
  }

  const invoice = await db.get(`
    SELECT i.total_price, i.payment_status, i.outlet_id, i.invoice_number, i.archived_at,
      COALESCE((
        SELECT SUM(r.return_value) FROM returns r
        WHERE r.invoice_id = i.id AND r.status != 'cancelled'
      ), 0) AS returned_amount
    FROM invoices i
    WHERE i.id = ?
  `, [invoiceId]);
  if (!invoice) {
    throw new Error(`Invoice with ID ${invoiceId} does not exist`);
  }
  if (invoice.archived_at) {
    throw new Error('Archived invoices must be restored before recording a payment');
  }

  const existingPayments = await db.all('SELECT amount FROM invoice_payments WHERE invoice_id = ? AND receipt_status != "rejected" AND reversed_at IS NULL', [invoiceId]);
  const currentPaid = existingPayments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = parseFloat(Math.max(0, invoice.total_price - Number(invoice.returned_amount || 0) - currentPaid).toFixed(2));

  if (remaining <= 0) {
    throw new Error('Invoice is already fully paid');
  }
  if (parsedAmount > remaining) {
    throw new Error(`Payment amount exceeds invoice remaining balance. Remaining: ${remaining}`);
  }

  const dateStr = paymentDate || new Date().toISOString();

  // Handle receipt attachment upload if provided
  let receiptOriginalName = null;
  let receiptStoredPath = null;
  let receiptMimeType = null;
  let receiptSize = null;
  let receiptStatus = 'approved'; // immediately approved if no receipt

  if (receiptData) {
    const fs = require('fs');
    const path = require('path');
    const receiptsDir = path.join(config.uploadsDir, 'receipts');
    if (!fs.existsSync(receiptsDir)) {
      fs.mkdirSync(receiptsDir, { recursive: true });
    }

    const matches = receiptData.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer;
    if (matches && matches.length === 3) {
      receiptMimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
    } else {
      receiptMimeType = 'application/octet-stream';
      buffer = Buffer.from(receiptData, 'base64');
    }
    receiptSize = buffer.length;
    receiptOriginalName = receiptName || 'receipt.bin';

    const ext = (path.extname(receiptOriginalName) || '.bin').toLowerCase();
    
    // Allowed MIME types and extensions validation
    const allowedMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'application/pdf'];
    const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.pdf'];
    if (!allowedMimeTypes.includes(receiptMimeType) || !allowedExtensions.includes(ext)) {
      throw new Error('Invalid file type. Only PNG, JPEG, GIF, and PDF are allowed.');
    }

    // Size limit verification (5MB max)
    const MAX_SIZE = 5 * 1024 * 1024;
    if (receiptSize > MAX_SIZE) {
      throw new Error('File size exceeds the 5MB limit.');
    }

    const safeName = `receipt-${Date.now()}-${Math.floor(Math.random() * 100000)}${ext}`;
    receiptStoredPath = path.join(receiptsDir, safeName);
    fs.writeFileSync(receiptStoredPath, buffer);
    receiptStatus = 'approved';
  }

  await db.exec('BEGIN TRANSACTION;');

  try {
    const isSupplied = supplyStatus === 'supplied';
    const suppliedAt = isSupplied ? new Date().toISOString() : null;
    const suppliedBy = isSupplied ? userId : null;

    const sql = `
      INSERT INTO invoice_payments (
        invoice_id, amount, payment_method, payment_date, reference_number, notes, recorded_by, supply_status, supplied_at, supplied_by,
        receipt_original_name, receipt_stored_path, receipt_mime_type, receipt_size, receipt_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await db.run(sql, [
      invoiceId,
      parsedAmount,
      paymentMethod,
      dateStr,
      referenceNumber.trim() || null,
      notes.trim() || null,
      userId,
      supplyStatus,
      suppliedAt,
      suppliedBy,
      receiptOriginalName,
      receiptStoredPath,
      receiptMimeType,
      receiptSize,
      receiptStatus
    ]);
    const paymentId = result.lastID;

    // Only apply metrics and ledger entry immediately if not pending review
    if (receiptStatus === 'approved') {
      // Recalculate metrics
      await recalculatePaymentMetrics(invoiceId);

      // Record ledger entry
      await db.run(`
        INSERT INTO finance_ledger_entries (
          outlet_id, invoice_id, entry_type, reference_type, reference_id,
          cash_amount, custody_amount, receivable_amount, notes, created_by
        ) VALUES (?, ?, 'payment_recorded', 'payment', ?, 0, ?, ?, ?, ?)
      `, [invoice.outlet_id, invoiceId, paymentId, parsedAmount, -parsedAmount, `Payment for invoice ${invoice.invoice_number} recorded.`, userId]);

      if (supplyStatus === 'supplied') {
        const batch = await db.run(
          `INSERT INTO payment_supply_batches
             (requested_amount, supplied_amount, outlet_id, created_by, selection_mode)
           VALUES (?, ?, ?, ?, 'manual')`,
          [parsedAmount, parsedAmount, invoice.outlet_id, userId]
        );
        await db.run(
          'INSERT INTO payment_supply_batch_items (batch_id, payment_id, amount) VALUES (?, ?, ?)',
          [batch.lastID, paymentId, parsedAmount]
        );
        await db.run(`
          INSERT INTO finance_ledger_entries (
            outlet_id, invoice_id, entry_type, reference_type, reference_id,
            cash_amount, custody_amount, receivable_amount, notes, created_by
          ) VALUES (?, ?, 'payment_supplied', 'payment', ?, ?, ?, 0, ?, ?)
        `, [invoice.outlet_id, invoiceId, paymentId, parsedAmount, -parsedAmount, `Payment supplied in batch #${batch.lastID}.`, userId]);
      }
    }

    await db.exec('COMMIT;');

    if (receiptStatus === 'approved') {
      // Trigger notification checks after commit
      try {
        await notificationsService.createOrUpdateNotification({
          category: 'payment_received',
          severity: 'info',
          title: 'تم استلام دفعة مالية',
          message: `تم استلام دفعة بقيمة ${parsedAmount} EGP للفاتورة ${invoice.invoice_number}.`,
          source_type: 'payment',
          source_id: paymentId,
          dedupe_key: `payment_received:${paymentId}`,
          action_url: `/finance/invoices/${invoiceId}`
        });

        await notificationsService.checkOutletCreditLimitNotifications(invoice.outlet_id);
        await notificationsService.checkOutletFinanceNotifications(invoice.outlet_id);
      } catch (e) {
        console.error('Error running notification checks on payment recording:', e);
      }
    } else {
      // Trigger a warning notification for pending review receipts if needed
      try {
        await notificationsService.createOrUpdateNotification({
          category: 'finance_warning',
          severity: 'warning',
          title: 'إيصال دفع قيد المراجعة',
          message: `تم تحميل إيصال دفع جديد بقيمة ${parsedAmount} EGP للفاتورة ${invoice.invoice_number} وينتظر المراجعة.`,
          source_type: 'payment',
          source_id: paymentId,
          dedupe_key: `payment_receipt_pending:${paymentId}`,
          action_url: `/payments`
        });
      } catch (e) {
        console.error('Error triggering pending receipt notification:', e);
      }
    }

    const newPayment = await db.get('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
    return newPayment;
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Reverse/cancel a payment.
 */
async function reversePayment(paymentId, { notes = '', userId }) {
  const payment = await db.get('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
  if (!payment) {
    throw new Error(`Payment record with ID ${paymentId} does not exist`);
  }
  if (payment.reversed_at) {
    throw new Error('Payment is already reversed');
  }
  if (payment.supply_status === 'supplied') {
    throw new Error('Reverse the payment supply before reversing this payment');
  }

  // Get invoice details for ledger
  const invoice = await db.get('SELECT outlet_id, invoice_number FROM invoices WHERE id = ?', [payment.invoice_id]);

  await db.exec('BEGIN TRANSACTION;');

  try {
    // Keep the payment row for auditability and for supply-batch foreign keys.
    await db.run(
      `UPDATE invoice_payments
       SET reversed_at = CURRENT_TIMESTAMP, reversed_by = ?, reversal_notes = ?
       WHERE id = ? AND reversed_at IS NULL`,
      [userId, notes.trim() || null, paymentId]
    );

    // Recalculate metrics
    await recalculatePaymentMetrics(payment.invoice_id);

    // Record ledger entry for reversal only if payment was approved
    if (invoice && payment.receipt_status === 'approved') {
      await db.run(`
        INSERT INTO finance_ledger_entries (
          outlet_id, invoice_id, entry_type, reference_type, reference_id,
          cash_amount, custody_amount, receivable_amount, notes, created_by
        ) VALUES (?, ?, 'payment_reversed', 'payment', ?, 0, ?, ?, ?, ?)
      `, [invoice.outlet_id, payment.invoice_id, paymentId, -payment.amount, payment.amount, notes.trim() || `Payment for invoice ${invoice.invoice_number} reversed.`, userId]);
    }

    await db.exec('COMMIT;');

    // Trigger notification checks
    try {
      if (invoice) {
        await notificationsService.checkOutletCreditLimitNotifications(invoice.outlet_id);
        await notificationsService.checkOutletFinanceNotifications(invoice.outlet_id);
      }
      await notificationsService.resolveNotificationByDedupeKey(`payment_received:${paymentId}`);
      await notificationsService.resolveNotificationByDedupeKey(`payment_receipt_pending:${paymentId}`);
    } catch (e) {
      console.error('Error running notification checks on payment reversal:', e);
    }

    return { success: true, reversedPaymentId: paymentId, invoiceId: payment.invoice_id };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Supply a list of payments.
 */
async function supplyPayments({ paymentIds, userId }) {
  if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
    throw new Error('Payment IDs array is required');
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');

  try {
    const updatedPayments = [];
    const outletIds = new Set();
    const eligiblePayments = [];

    for (const paymentId of paymentIds) {
      const payment = await db.get('SELECT p.*, i.outlet_id, i.payment_status, i.archived_at FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ? AND p.reversed_at IS NULL', [paymentId]);
      if (!payment) {
        throw new Error(`Payment record with ID ${paymentId} does not exist`);
      }
      if (payment.receipt_status && payment.receipt_status !== 'approved') {
        throw new Error('Only approved payments can be supplied');
      }
      if (payment.payment_status === 'cancelled' || payment.archived_at) {
        throw new Error('Cancelled or archived invoice payments cannot be supplied');
      }
      if (payment.supply_status === 'supplied') {
        continue;
      }
      eligiblePayments.push(payment);

      await auditService.log({
        userId,
        action: 'supply_payment',
        targetType: 'payments',
        targetId: paymentId.toString(),
        details: { amount: payment.amount }
      });

      if (payment.outlet_id) {
        outletIds.add(payment.outlet_id);
      }
      updatedPayments.push(paymentId);
    }

    if (eligiblePayments.length === 0) {
      await db.exec('COMMIT;');
      return { success: true, suppliedCount: 0, paymentIds: [] };
    }

    const suppliedAmount = Number(eligiblePayments.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2));
    const batch = await db.run(
      `INSERT INTO payment_supply_batches
         (requested_amount, supplied_amount, outlet_id, created_by, selection_mode)
       VALUES (?, ?, ?, ?, 'manual')`,
      [suppliedAmount, suppliedAmount, new Set(eligiblePayments.map(row => row.outlet_id)).size === 1 ? eligiblePayments[0].outlet_id : null, userId]
    );
    for (const payment of eligiblePayments) {
      await db.run(
        'UPDATE invoice_payments SET supply_status = "supplied", supplied_at = CURRENT_TIMESTAMP, supplied_by = ? WHERE id = ? AND supply_status = "not_supplied" AND reversed_at IS NULL',
        [userId, payment.id]
      );
      await db.run('INSERT INTO payment_supply_batch_items (batch_id, payment_id, amount) VALUES (?, ?, ?)', [batch.lastID, payment.id, payment.amount]);
      await db.run(`
        INSERT INTO finance_ledger_entries (
          outlet_id, invoice_id, entry_type, reference_type, reference_id,
          cash_amount, custody_amount, receivable_amount, notes, created_by
        ) VALUES (?, ?, 'payment_supplied', 'payment', ?, ?, ?, 0, ?, ?)
      `, [payment.outlet_id, payment.invoice_id, payment.id, payment.amount, -payment.amount, `Payment supplied in batch #${batch.lastID}.`, userId]);
    }

    await db.exec('COMMIT;');

    for (const oId of outletIds) {
      try {
        await notificationsService.checkOutletFinanceNotifications(oId);
      } catch (e) {
        console.error('Error checking finance notifications after supply:', e);
      }
    }

    return { success: true, suppliedCount: eligiblePayments.length, paymentIds: updatedPayments, batchId: batch.lastID, suppliedAmount };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

/**
 * Reverse a payment supply.
 */
async function reversePaymentSupply(paymentId, { notes = '', userId }) {
  const payment = await db.get('SELECT p.*, i.outlet_id FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ? AND p.reversed_at IS NULL', [paymentId]);
  if (!payment) {
    throw new Error(`Payment record with ID ${paymentId} does not exist`);
  }
  if (payment.supply_status !== 'supplied') {
    throw new Error('Payment is not supplied');
  }

  const item = await db.get(`
    SELECT bi.batch_id, bi.amount, b.status AS batch_status
    FROM payment_supply_batch_items bi
    JOIN payment_supply_batches b ON b.id = bi.batch_id
    WHERE bi.payment_id = ? AND bi.status = 'active'
    ORDER BY bi.batch_id DESC LIMIT 1`, [paymentId]);
  if (!item) throw new Error('Payment supply operation was not found');

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');

  try {
    await db.run('UPDATE payment_supply_batch_items SET status = "reversed", reversed_at = CURRENT_TIMESTAMP, reversed_by = ?, reversal_notes = ? WHERE batch_id = ? AND payment_id = ? AND status = "active"', [userId, notes.trim() || null, item.batch_id, paymentId]);
    await db.run('UPDATE invoice_payments SET supply_status = "not_supplied", supplied_at = NULL, supplied_by = NULL WHERE id = ? AND reversed_at IS NULL', [paymentId]);
    const remaining = await db.get('SELECT COUNT(*) AS count FROM payment_supply_batch_items WHERE batch_id = ? AND status = "active"', [item.batch_id]);
    await db.run(
      'UPDATE payment_supply_batches SET status = ?, reversed_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE reversed_at END, reversed_by = CASE WHEN ? = 0 THEN ? ELSE reversed_by END, reversal_notes = CASE WHEN ? = 0 THEN ? ELSE reversal_notes END WHERE id = ?',
      [remaining.count === 0 ? 'reversed' : 'partially_reversed', remaining.count, remaining.count, userId, remaining.count, notes.trim() || null, item.batch_id]
    );

    await db.run(`
      INSERT INTO finance_ledger_entries (
        outlet_id, invoice_id, entry_type, reference_type, reference_id,
        cash_amount, custody_amount, receivable_amount, notes, created_by
      ) VALUES (?, ?, 'supply_reversed', 'payment', ?, ?, ?, 0, ?, ?)
    `, [payment.outlet_id, payment.invoice_id, paymentId, -item.amount, item.amount, notes.trim() || `Payment supply reversed from batch #${item.batch_id}.`, userId]);

    await auditService.log({
      userId,
      action: 'reverse_supply_payment',
      targetType: 'payments',
      targetId: paymentId.toString(),
      details: { amount: item.amount, batchId: item.batch_id }
    });

    await db.exec('COMMIT;');

    try {
      await notificationsService.checkOutletFinanceNotifications(payment.outlet_id);
    } catch (e) {
      console.error('Error checking finance notifications after supply reversal:', e);
    }

    return { success: true, paymentId, batchId: item.batch_id, amount: item.amount };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

async function getSupplyBatches({ limit = 50, offset = 0, outletId = null, status = '', startDate = '', endDate = '' } = {}) {
  let sql = `
    SELECT b.*, o.name AS outlet_name, u.full_name AS created_by_name,
           COUNT(CASE WHEN bi.status = 'active' THEN 1 END) AS active_item_count,
           COUNT(bi.payment_id) AS item_count
    FROM payment_supply_batches b
    LEFT JOIN outlets o ON o.id = b.outlet_id
    LEFT JOIN users u ON u.id = b.created_by
    LEFT JOIN payment_supply_batch_items bi ON bi.batch_id = b.id
    WHERE 1=1`;
  const params = [];
  if (outletId) { sql += ' AND b.outlet_id = ?'; params.push(outletId); }
  if (status) { sql += ' AND b.status = ?'; params.push(status); }
  if (startDate) { sql += ' AND b.created_at >= ?'; params.push(startDate); }
  if (endDate) { sql += ' AND b.created_at <= ?'; params.push(`${endDate} 23:59:59`); }
  sql += ' GROUP BY b.id ORDER BY datetime(b.created_at) DESC, b.id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return db.all(sql, params);
}

async function getSupplyBatchById(batchId) {
  const batch = await db.get(`
    SELECT b.*, o.name AS outlet_name, u.full_name AS created_by_name
    FROM payment_supply_batches b
    LEFT JOIN outlets o ON o.id = b.outlet_id
    LEFT JOIN users u ON u.id = b.created_by
    WHERE b.id = ?`, [batchId]);
  if (!batch) return null;
  batch.items = await db.all(`
    SELECT bi.*, p.amount AS payment_amount, p.payment_method, p.payment_date,
           p.supply_status, p.reversed_at, i.invoice_number, i.outlet_id,
           o.name AS outlet_name, pm.label_ar AS payment_method_label
    FROM payment_supply_batch_items bi
    JOIN invoice_payments p ON p.id = bi.payment_id
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN outlets o ON o.id = i.outlet_id
    LEFT JOIN payment_methods pm ON pm.key = p.payment_method
    WHERE bi.batch_id = ? ORDER BY bi.payment_id`, [batchId]);
  return batch;
}

async function reverseSupplyBatch(batchId, { notes = '', userId }) {
  const batch = await db.get('SELECT * FROM payment_supply_batches WHERE id = ?', [batchId]);
  if (!batch) throw new Error(`Supply operation ${batchId} does not exist`);
  if (batch.status === 'reversed') throw new Error('Supply operation is already reversed');
  const items = await db.all(`
    SELECT bi.*, p.invoice_id, i.outlet_id
    FROM payment_supply_batch_items bi
    JOIN invoice_payments p ON p.id = bi.payment_id
    JOIN invoices i ON i.id = p.invoice_id
    WHERE bi.batch_id = ? AND bi.status = 'active'`, [batchId]);
  if (!items.length) throw new Error('Supply operation has no active items');
  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    for (const item of items) {
      await db.run('UPDATE payment_supply_batch_items SET status = "reversed", reversed_at = CURRENT_TIMESTAMP, reversed_by = ?, reversal_notes = ? WHERE batch_id = ? AND payment_id = ? AND status = "active"', [userId, notes.trim() || null, batchId, item.payment_id]);
      await db.run('UPDATE invoice_payments SET supply_status = "not_supplied", supplied_at = NULL, supplied_by = NULL WHERE id = ? AND reversed_at IS NULL', [item.payment_id]);
      await db.run(`INSERT INTO finance_ledger_entries
        (outlet_id, invoice_id, entry_type, reference_type, reference_id, cash_amount, custody_amount, receivable_amount, notes, created_by)
        VALUES (?, ?, 'supply_reversed', 'payment', ?, ?, ?, 0, ?, ?)`, [item.outlet_id, item.invoice_id, item.payment_id, -item.amount, item.amount, notes.trim() || `Supply batch #${batchId} reversed.`, userId]);
    }
    await db.run('UPDATE payment_supply_batches SET status = "reversed", reversed_at = CURRENT_TIMESTAMP, reversed_by = ?, reversal_notes = ? WHERE id = ?', [userId, notes.trim() || null, batchId]);
    await db.exec('COMMIT;');
    await auditService.log({ userId, action: 'reverse_supply_batch', targetType: 'payment_supply_batches', targetId: String(batchId), details: { amount: batch.supplied_amount, itemCount: items.length, notes } });
    return { success: true, batchId, reversedAmount: batch.supplied_amount, itemCount: items.length };
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

function buildSupplyAllocation(rows, requestedAmount) {
  const requested = Number(requestedAmount);
  if (!Number.isFinite(requested) || requested <= 0) throw new Error('Supply amount must be a positive number');
  let total = 0;
  const selected = [];
  for (const row of rows) {
    const next = Number((total + Number(row.amount)).toFixed(2));
    if (next > requested) break;
    selected.push(row);
    total = next;
  }
  const nextRow = rows[selected.length];
  return {
    requestedAmount: Number(requested.toFixed(2)),
    lowerAmount: Number(total.toFixed(2)),
    upperAmount: nextRow ? Number((total + Number(nextRow.amount)).toFixed(2)) : Number(total.toFixed(2)),
    selected,
    upperSelected: nextRow ? [...selected, nextRow] : selected,
    exact: Number(total.toFixed(2)) === Number(requested.toFixed(2))
  };
}

async function getSupplyCandidates(outletId = null) {
  let sql = `
    SELECT p.id AS payment_id, p.invoice_id, p.amount, p.payment_date, p.created_at,
           i.invoice_number, i.outlet_id, i.created_at AS invoice_created_at,
           o.name AS outlet_name
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN outlets o ON o.id = i.outlet_id
    WHERE p.supply_status = 'not_supplied'
      AND p.reversed_at IS NULL
      AND COALESCE(p.receipt_status, 'approved') = 'approved'
      AND i.payment_status != 'cancelled'
      AND i.archived_at IS NULL`;
  const params = [];
  if (outletId !== null && outletId !== undefined) { sql += ' AND i.outlet_id = ?'; params.push(outletId); }
  sql += ' ORDER BY datetime(i.created_at) ASC, datetime(p.payment_date) ASC, p.id ASC';
  return db.all(sql, params);
}

async function previewAmountSupply({ amount, outletId = null }) {
  const rows = await getSupplyCandidates(outletId);
  const allocation = buildSupplyAllocation(rows, amount);
  const version = crypto.createHash('sha256').update(JSON.stringify({
    amount: Number(allocation.requestedAmount),
    outletId: outletId === undefined ? null : outletId,
    candidates: rows.map(row => [row.payment_id, Number(row.amount), row.payment_date, row.created_at])
  })).digest('hex');
  return {
    ...allocation,
    version,
    candidates: rows,
    selectedPaymentIds: allocation.selected.map(row => row.payment_id),
    upperSelectedPaymentIds: allocation.upperSelected.map(row => row.payment_id),
    invoiceCount: new Set(allocation.selected.map(row => row.invoice_id)).size,
    outletCount: new Set(allocation.selected.map(row => row.outlet_id)).size
  };
}

async function supplyAmount({ amount, outletId = null, userId, selectedPaymentIds, expectedVersion }) {
  const preview = await previewAmountSupply({ amount, outletId });
  const requestedIds = Array.isArray(selectedPaymentIds) ? selectedPaymentIds.map(Number) : preview.selectedPaymentIds;
  const lowerIds = preview.selectedPaymentIds;
  const upperIds = preview.upperSelectedPaymentIds;
  if (!requestedIds.length || (requestedIds.join(',') !== lowerIds.join(',') && requestedIds.join(',') !== upperIds.join(','))) throw new Error('Supply preview is stale; refresh and try again');
  if (expectedVersion && expectedVersion !== preview.version && expectedVersion !== requestedIds.join(':')) throw new Error('Supply preview is stale; refresh and try again');
  const chosenAmount = requestedIds.join(',') === upperIds.join(',') ? preview.upperAmount : preview.lowerAmount;
  if (chosenAmount <= 0 || (chosenAmount !== preview.requestedAmount && chosenAmount !== preview.lowerAmount && chosenAmount !== preview.upperAmount)) throw new Error('Choose the lower or upper complete-payment amount before confirming');

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const locked = await getSupplyCandidates(outletId);
    const current = buildSupplyAllocation(locked, preview.requestedAmount);
    const currentIds = requestedIds.join(',');
    const currentLower = current.selected.map(r => r.payment_id).join(',');
    const currentUpper = current.upperSelected.map(r => r.payment_id).join(',');
    if (currentIds !== currentLower && currentIds !== currentUpper) throw new Error('Supply preview is stale; refresh and try again');
    const currentSelected = currentIds === currentUpper ? current.upperSelected : current.selected;
    const suppliedAmount = Number(currentSelected.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2));
    const selectionMode = requestedIds.join(',') === upperIds.join(',') ? 'upper' : (currentSelected.length === current.selected.length ? 'lower' : 'manual');
    const batch = await db.run(
      'INSERT INTO payment_supply_batches (requested_amount, supplied_amount, outlet_id, created_by, selection_mode) VALUES (?, ?, ?, ?, ?)',
      [preview.requestedAmount, suppliedAmount, outletId || null, userId, selectionMode]
    );
    for (const row of currentSelected) {
      await db.run('UPDATE invoice_payments SET supply_status = "supplied", supplied_at = CURRENT_TIMESTAMP, supplied_by = ? WHERE id = ? AND supply_status = "not_supplied" AND reversed_at IS NULL', [userId, row.payment_id]);
      await db.run('INSERT INTO payment_supply_batch_items (batch_id, payment_id, amount) VALUES (?, ?, ?)', [batch.lastID, row.payment_id, row.amount]);
      await db.run(`INSERT INTO finance_ledger_entries (outlet_id, invoice_id, entry_type, reference_type, reference_id, cash_amount, custody_amount, receivable_amount, notes, created_by)
        VALUES (?, ?, 'payment_supplied', 'payment', ?, ?, ?, 0, ?, ?)`, [row.outlet_id, row.invoice_id, row.payment_id, row.amount, -row.amount, `Payment supplied in batch #${batch.lastID}.`, userId]);
    }
    await db.exec('COMMIT;');
    await auditService.log({ userId, action: 'supply_amount', targetType: 'payment_supply_batches', targetId: String(batch.lastID), details: { requestedAmount: preview.requestedAmount, suppliedAmount, outletId, paymentIds: requestedIds } });
    return { batchId: batch.lastID, requestedAmount: preview.requestedAmount, suppliedAmount, paymentIds: requestedIds };
  } catch (err) { await db.exec('ROLLBACK;'); throw err; }
}

/**
 * Retrieve payments list.
 */
async function getPayments({ limit = 50, offset = 0, invoiceId = null, outletIds = null, supplyStatus = '', paymentMethod = '', startDate = '', endDate = '' } = {}) {
  let sql = `
    SELECT p.*, i.invoice_number, pm.label_ar AS payment_method_label, u.full_name as user_full_name
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN payment_methods pm ON pm.key = p.payment_method
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE 1=1
  `;
  const params = [];

  if (invoiceId) {
    sql += ` AND p.invoice_id = ?`;
    params.push(invoiceId);
  }

  if (supplyStatus) {
    sql += ` AND p.supply_status = ?`;
    params.push(supplyStatus);
  }

  if (paymentMethod) {
    sql += ` AND p.payment_method = ?`;
    params.push(paymentMethod);
  }

  if (startDate) {
    sql += ` AND p.payment_date >= ?`;
    params.push(startDate);
  }

  if (endDate) {
    sql += ` AND p.payment_date <= ?`;
    params.push(`${endDate} 23:59:59`);
  }

  if (outletIds && outletIds.length > 0) {
    sql += ` AND i.outlet_id IN (${outletIds.map(() => '?').join(',')})`;
    params.push(...outletIds);
  } else if (outletIds) {
    sql += ` AND 0=1`;
  }

  sql += ` ORDER BY p.payment_date DESC, p.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await db.all(sql, params);
}


/**
 * Fetch detailed metrics for an invoice.
 */
async function getPaymentMetrics(invoiceId) {
  const invoice = await db.get(`
    SELECT i.id, i.invoice_number, i.total_price, i.payment_status, i.payment_type,
      COALESCE((
        SELECT SUM(r.return_value) FROM returns r
        WHERE r.invoice_id = i.id AND r.status != 'cancelled'
      ), 0) AS returned_amount
    FROM invoices i
    WHERE i.id = ?
  `, [invoiceId]);

  if (!invoice) return null;

  const payments = await db.all('SELECT amount, supply_status, receipt_status, reversed_at FROM invoice_payments WHERE invoice_id = ?', [invoiceId]);
  const activePayments = payments.filter(p => !p.reversed_at);
  const paidAmount = parseFloat(activePayments.filter(p => p.receipt_status === 'approved').reduce((sum, p) => sum + p.amount, 0).toFixed(2));
  const unreviewedReceiptAmount = parseFloat(activePayments.filter(p => p.receipt_status === 'pending_review').reduce((sum, p) => sum + p.amount, 0).toFixed(2));
  const rejectedReceiptAmount = parseFloat(activePayments.filter(p => p.receipt_status === 'rejected').reduce((sum, p) => sum + p.amount, 0).toFixed(2));
  const returnedAmount = parseFloat(Number(invoice.returned_amount || 0).toFixed(2));
  const netAmount = parseFloat(Math.max(0, invoice.total_price - returnedAmount).toFixed(2));
  const remainingAmount = parseFloat(Math.max(0, netAmount - paidAmount).toFixed(2));

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number,
    paymentType: invoice.payment_type,
    totalPrice: invoice.total_price,
    returnedAmount,
    netAmount,
    paidAmount,
    remainingAmount,
    unreviewedReceiptAmount,
    rejectedReceiptAmount,
    paymentStatus: invoice.payment_status
  };
}

/**
 * Get review queue payments with receipts.
 */
async function getReviewQueue({ 
  status = 'pending_review', 
  outletId = null, 
  invoiceId = null,
  recordedBy = null,
  startDate = '',
  endDate = '',
  minAmount = null,
  maxAmount = null
} = {}) {
  let sql = `
    SELECT p.*, i.invoice_number, o.name as outlet_name, u.full_name as recorder_full_name
    FROM invoice_payments p
    JOIN invoices i ON i.id = p.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.receipt_stored_path IS NOT NULL AND p.reversed_at IS NULL
  `;
  const params = [];
  if (status) {
    sql += ` AND p.receipt_status = ?`;
    params.push(status);
  }
  if (outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(outletId);
  }
  if (invoiceId) {
    sql += ` AND p.invoice_id = ?`;
    params.push(invoiceId);
  }
  if (recordedBy) {
    sql += ` AND p.recorded_by = ?`;
    params.push(recordedBy);
  }
  if (startDate) {
    sql += ` AND p.payment_date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND p.payment_date <= ?`;
    params.push(`${endDate} 23:59:59`);
  }
  if (minAmount !== null) {
    sql += ` AND p.amount >= ?`;
    params.push(minAmount);
  }
  if (maxAmount !== null) {
    sql += ` AND p.amount <= ?`;
    params.push(maxAmount);
  }
  sql += ` ORDER BY p.created_at DESC`;
  return await db.all(sql, params);
}

/**
 * Get single payment by ID.
 */
async function getPaymentById(id) {
  return await db.get('SELECT * FROM invoice_payments WHERE id = ?', [id]);
}

/**
 * Review a payment receipt (approve/reject).
 */
async function reviewPaymentReceipt(paymentId, { action, notes = '', userId }) {
  const payment = await db.get('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
  if (!payment) {
    throw new Error(`Payment record with ID ${paymentId} does not exist`);
  }
  if (!payment.receipt_stored_path) {
    throw new Error('This payment does not have a receipt attachment to review');
  }
  if (payment.receipt_status !== 'pending_review') {
    throw new Error(`Payment receipt is already reviewed. Status: ${payment.receipt_status}`);
  }

  const invoice = await db.get('SELECT outlet_id, invoice_number FROM invoices WHERE id = ?', [payment.invoice_id]);

  await db.exec('BEGIN TRANSACTION;');

  try {
    const reviewedAt = new Date().toISOString();
    const status = action === 'approve' ? 'approved' : 'rejected';
    
    await db.run(
      `UPDATE invoice_payments 
       SET receipt_status = ?, receipt_reviewer_id = ?, receipt_reviewed_at = ?, receipt_review_note = ?
       WHERE id = ?`,
      [status, userId, reviewedAt, notes.trim() || null, paymentId]
    );

    if (action === 'approve') {
      // 1. Recalculate metrics
      await recalculatePaymentMetrics(payment.invoice_id);

      // 2. Record ledger entry
      await db.run(`
        INSERT INTO finance_ledger_entries (
          outlet_id, invoice_id, entry_type, reference_type, reference_id,
          cash_amount, custody_amount, receivable_amount, notes, created_by
        ) VALUES (?, ?, 'payment_recorded', 'payment', ?, 0, ?, ?, ?, ?)
      `, [invoice.outlet_id, payment.invoice_id, paymentId, payment.amount, -payment.amount, `Approved payment receipt for invoice ${invoice.invoice_number}.`, userId]);

      if (payment.supply_status === 'supplied') {
        const batch = await db.run(
          `INSERT INTO payment_supply_batches
             (requested_amount, supplied_amount, outlet_id, created_by, selection_mode)
           VALUES (?, ?, ?, ?, 'manual')`,
          [payment.amount, payment.amount, invoice.outlet_id, userId]
        );
        await db.run('INSERT INTO payment_supply_batch_items (batch_id, payment_id, amount) VALUES (?, ?, ?)', [batch.lastID, paymentId, payment.amount]);
        await db.run(`
          INSERT INTO finance_ledger_entries (
            outlet_id, invoice_id, entry_type, reference_type, reference_id,
            cash_amount, custody_amount, receivable_amount, notes, created_by
          ) VALUES (?, ?, 'payment_supplied', 'payment', ?, ?, ?, 0, ?, ?)
        `, [invoice.outlet_id, payment.invoice_id, paymentId, payment.amount, -payment.amount, `Payment was already marked supplied in batch #${batch.lastID}.`, userId]);
      }
    }

    await db.exec('COMMIT;');

    if (action === 'approve') {
      // Trigger notification checks after commit
      try {
        await notificationsService.createOrUpdateNotification({
          category: 'payment_received',
          severity: 'info',
          title: 'تم استلام دفعة مالية',
          message: `تم استلام دفعة بقيمة ${payment.amount} EGP للفاتورة ${invoice.invoice_number}.`,
          source_type: 'payment',
          source_id: paymentId,
          dedupe_key: `payment_received:${paymentId}`,
          action_url: `/finance/invoices/${payment.invoice_id}`
        });

        await notificationsService.checkOutletCreditLimitNotifications(invoice.outlet_id);
        await notificationsService.checkOutletFinanceNotifications(invoice.outlet_id);
      } catch (e) {
        console.error('Error running notification checks on payment receipt approval:', e);
      }
      try {
        await notificationsService.resolveNotificationByDedupeKey(`payment_receipt_pending:${paymentId}`);
      } catch (e) {
        console.error('Error resolving pending receipt notification:', e);
      }
    } else {
      try {
        await notificationsService.createOrUpdateNotification({
          category: 'finance_warning',
          severity: 'critical',
          title: 'تم رفض إيصال الدفع',
          message: `تم رفض إيصال الدفع للفاتورة ${invoice.invoice_number}. السبب: ${notes || 'غير محدد'}.`,
          source_type: 'payment',
          source_id: paymentId,
          dedupe_key: `payment_receipt_rejected:${paymentId}`,
          action_url: `/payments`
        });
        await notificationsService.resolveNotificationByDedupeKey(`payment_receipt_pending:${paymentId}`);
      } catch (e) {
        console.error('Error triggering rejected receipt notification:', e);
      }
    }

    const updatedPayment = await db.get('SELECT * FROM invoice_payments WHERE id = ?', [paymentId]);
    return updatedPayment;
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }
}

module.exports = {
  recordPayment,
  reversePayment,
  supplyPayments,
  reversePaymentSupply,
  getPayments,
  recalculatePaymentMetrics,
  getPaymentMetrics,
  getReviewQueue,
  getPaymentById,
  reviewPaymentReceipt
  ,previewAmountSupply
  ,supplyAmount
  ,getSupplyBatches
  ,getSupplyBatchById
  ,reverseSupplyBatch
};
