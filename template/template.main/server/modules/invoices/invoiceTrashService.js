const fs = require('fs');
const path = require('path');
const db = require('../../db');
const config = require('../../config');
const notificationsService = require('../notifications/notificationsService');

const SNAPSHOT_VERSION = 1;
const RETENTION_DAYS = 30;

class InvoiceTrashError extends Error {
  constructor(message, status = 400, code = 'INVOICE_TRASH_ERROR') {
    super(message);
    this.name = 'InvoiceTrashError';
    this.status = status;
    this.code = code;
  }
}

function normalizeInvoiceIds(invoiceIds) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new InvoiceTrashError('Invoice IDs must be a non-empty array.');
  }
  const normalized = invoiceIds.map(Number);
  if (normalized.some(id => !Number.isInteger(id) || id <= 0)) {
    throw new InvoiceTrashError('Invoice IDs must contain positive integers only.');
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new InvoiceTrashError('Invoice IDs must not contain duplicates.');
  }
  return normalized;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

async function deleteRowsByIds(table, ids) {
  if (!ids.length) return;
  await db.run(`DELETE FROM ${table} WHERE id IN (${placeholders(ids)})`, ids);
}

async function snapshotInvoice(invoiceId) {
  const invoice = await db.get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  if (!invoice) return null;

  const invoiceItems = await db.all('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', [invoiceId]);
  const invoiceStatusHistory = await db.all('SELECT * FROM invoice_status_history WHERE invoice_id = ? ORDER BY id', [invoiceId]);
  const invoicePayments = await db.all('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY id', [invoiceId]);
  const shipments = await db.all('SELECT * FROM shipments WHERE invoice_id = ? ORDER BY id', [invoiceId]);
  const returns = await db.all('SELECT * FROM returns WHERE invoice_id = ? ORDER BY id', [invoiceId]);

  const shipmentIds = shipments.map(row => row.id);
  const returnIds = returns.map(row => row.id);
  const paymentIds = invoicePayments.map(row => row.id);

  const shipmentItems = shipmentIds.length
    ? await db.all(`SELECT * FROM shipment_items WHERE shipment_id IN (${placeholders(shipmentIds)}) ORDER BY id`, shipmentIds)
    : [];
  const shipmentStatusHistory = shipmentIds.length
    ? await db.all(`SELECT * FROM shipment_status_history WHERE shipment_id IN (${placeholders(shipmentIds)}) ORDER BY id`, shipmentIds)
    : [];
  const returnItems = returnIds.length
    ? await db.all(`SELECT * FROM return_items WHERE return_id IN (${placeholders(returnIds)}) ORDER BY id`, returnIds)
    : [];
  const inventoryTransactions = await db.all(
    "SELECT * FROM inventory_transactions WHERE reference_type = 'invoice' AND reference_id = ? ORDER BY id",
    [invoiceId]
  );

  const ledgerConditions = ["invoice_id = ?", "(reference_type = 'invoice' AND reference_id = ?)"];
  const ledgerParams = [invoiceId, invoiceId];
  if (paymentIds.length) {
    ledgerConditions.push(`(reference_type = 'payment' AND reference_id IN (${placeholders(paymentIds)}))`);
    ledgerParams.push(...paymentIds);
  }
  if (returnIds.length) {
    ledgerConditions.push(`(reference_type = 'return' AND reference_id IN (${placeholders(returnIds)}))`);
    ledgerParams.push(...returnIds);
  }
  const financeLedgerEntries = await db.all(
    `SELECT * FROM finance_ledger_entries WHERE ${ledgerConditions.join(' OR ')} ORDER BY id`,
    ledgerParams
  );

  const notificationConditions = ["(source_type = 'invoice' AND source_id = ?)"];
  const notificationParams = [invoiceId];
  if (paymentIds.length) {
    notificationConditions.push(`(source_type = 'payment' AND source_id IN (${placeholders(paymentIds)}))`);
    notificationParams.push(...paymentIds);
  }
  if (returnIds.length) {
    notificationConditions.push(`(source_type = 'return' AND source_id IN (${placeholders(returnIds)}))`);
    notificationParams.push(...returnIds);
  }
  const notifications = await db.all(
    `SELECT * FROM notifications WHERE ${notificationConditions.join(' OR ')} ORDER BY id`,
    notificationParams
  );

  return {
    version: SNAPSHOT_VERSION,
    invoice,
    invoiceItems,
    invoiceStatusHistory,
    invoicePayments,
    shipments,
    shipmentItems,
    shipmentStatusHistory,
    returns,
    returnItems,
    inventoryTransactions,
    financeLedgerEntries,
    notifications
  };
}

async function removeSnapshotFromOperationalTables(snapshot) {
  await deleteRowsByIds('notifications', snapshot.notifications.map(row => row.id));
  await deleteRowsByIds('finance_ledger_entries', snapshot.financeLedgerEntries.map(row => row.id));
  await deleteRowsByIds('inventory_transactions', snapshot.inventoryTransactions.map(row => row.id));
  await deleteRowsByIds('return_items', snapshot.returnItems.map(row => row.id));
  await deleteRowsByIds('returns', snapshot.returns.map(row => row.id));
  await deleteRowsByIds('shipment_status_history', snapshot.shipmentStatusHistory.map(row => row.id));
  await deleteRowsByIds('shipment_items', snapshot.shipmentItems.map(row => row.id));
  await deleteRowsByIds('shipments', snapshot.shipments.map(row => row.id));
  await deleteRowsByIds('invoice_payments', snapshot.invoicePayments.map(row => row.id));
  await deleteRowsByIds('invoice_status_history', snapshot.invoiceStatusHistory.map(row => row.id));
  await deleteRowsByIds('invoice_items', snapshot.invoiceItems.map(row => row.id));
  await db.run('DELETE FROM invoices WHERE id = ?', [snapshot.invoice.id]);
}

async function insertRows(table, rows) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const quotedColumns = columns.map(column => `"${column}"`).join(', ');
    await db.run(
      `INSERT INTO ${table} (${quotedColumns}) VALUES (${placeholders(columns)})`,
      columns.map(column => row[column])
    );
  }
}

async function restoreSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== SNAPSHOT_VERSION || !snapshot.invoice) {
    throw new InvoiceTrashError('The stored invoice snapshot is invalid or unsupported.', 409, 'INVALID_SNAPSHOT');
  }
  await insertRows('invoices', [snapshot.invoice]);
  await insertRows('invoice_items', snapshot.invoiceItems || []);
  await insertRows('invoice_status_history', snapshot.invoiceStatusHistory || []);
  await insertRows('invoice_payments', snapshot.invoicePayments || []);
  await insertRows('shipments', snapshot.shipments || []);
  await insertRows('shipment_items', snapshot.shipmentItems || []);
  await insertRows('shipment_status_history', snapshot.shipmentStatusHistory || []);
  await insertRows('returns', snapshot.returns || []);
  await insertRows('return_items', snapshot.returnItems || []);
  await insertRows('inventory_transactions', snapshot.inventoryTransactions || []);
  await insertRows('finance_ledger_entries', snapshot.financeLedgerEntries || []);
  await insertRows('notifications', snapshot.notifications || []);
}

async function writeAudit({ userId = null, action, invoiceRows, ipAddress = null }) {
  const details = JSON.stringify({
    invoices: invoiceRows.map(row => ({
      id: row.invoice_id || row.id,
      invoiceNumber: row.invoice_number,
      totalPrice: row.total_price
    }))
  });
  await db.run(
    `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address)
     VALUES (?, ?, 'invoices', ?, ?, ?)`,
    [userId, action, invoiceRows.map(row => row.invoice_id || row.id).join(','), details, ipAddress]
  );
}

async function refreshDerivedState(snapshots) {
  const outletIds = [...new Set(snapshots.map(snapshot => snapshot.invoice.outlet_id))];
  const productIds = [...new Set(snapshots.flatMap(snapshot => snapshot.invoiceItems.map(item => item.product_id)))];
  for (const outletId of outletIds) {
    try {
      await notificationsService.checkOutletCreditLimitNotifications(outletId);
      await notificationsService.checkOutletFinanceNotifications(outletId);
    } catch (error) {
      console.error(`Failed to refresh outlet notifications for ${outletId}:`, error);
    }
  }
  for (const productId of productIds) {
    try {
      await notificationsService.checkStockNotifications(productId);
    } catch (error) {
      console.error(`Failed to refresh stock notifications for ${productId}:`, error);
    }
  }
}

async function trashInvoices({ invoiceIds, userId, ipAddress = null }) {
  const normalizedIds = normalizeInvoiceIds(invoiceIds);
  const snapshots = [];
  const trashRows = [];

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    for (const invoiceId of normalizedIds) {
      const existingTrash = await db.get('SELECT invoice_id FROM invoice_trash WHERE invoice_id = ?', [invoiceId]);
      if (existingTrash) {
        throw new InvoiceTrashError(`Invoice with ID ${invoiceId} is already in trash.`, 409, 'ALREADY_TRASHED');
      }
      const snapshot = await snapshotInvoice(invoiceId);
      if (!snapshot) {
        throw new InvoiceTrashError(`Invoice with ID ${invoiceId} does not exist.`, 404, 'INVOICE_NOT_FOUND');
      }

      const invoice = snapshot.invoice;
      const result = await db.run(
        `INSERT INTO invoice_trash (
          invoice_id, invoice_number, outlet_id, total_price, payment_status, shipping_status,
          was_archived, original_created_at, snapshot_version, snapshot_json, trashed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice.id,
          invoice.invoice_number,
          invoice.outlet_id,
          invoice.total_price,
          invoice.payment_status,
          invoice.shipping_status,
          invoice.archived_at ? 1 : 0,
          invoice.created_at,
          SNAPSHOT_VERSION,
          JSON.stringify(snapshot),
          userId
        ]
      );
      const productIds = [...new Set(snapshot.invoiceItems.map(item => item.product_id))];
      for (const productId of productIds) {
        await db.run('INSERT INTO invoice_trash_products (trash_id, product_id) VALUES (?, ?)', [result.lastID, productId]);
      }
      await removeSnapshotFromOperationalTables(snapshot);
      snapshots.push(snapshot);
      trashRows.push({ invoice_id: invoice.id, invoice_number: invoice.invoice_number, total_price: invoice.total_price });
    }
    await writeAudit({ userId, action: 'trash_invoices', invoiceRows: trashRows, ipAddress });
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    if (!(error instanceof InvoiceTrashError) && String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw new InvoiceTrashError(
        `The invoice selection could not be moved to trash because related data changed: ${error.message}`,
        409,
        'TRASH_CONFLICT'
      );
    }
    throw error;
  }

  await refreshDerivedState(snapshots);
  return trashRows;
}

function parseSnapshot(row) {
  try {
    const snapshot = JSON.parse(row.snapshot_json);
    if (snapshot.version !== row.snapshot_version) throw new Error('Snapshot version mismatch');
    return snapshot;
  } catch (error) {
    throw new InvoiceTrashError(
      `Stored snapshot for invoice ${row.invoice_number} is invalid: ${error.message}`,
      409,
      'INVALID_SNAPSHOT'
    );
  }
}

async function restoreTrashedInvoices({ invoiceIds, userId, ipAddress = null }) {
  const normalizedIds = normalizeInvoiceIds(invoiceIds);
  const snapshots = [];
  const restoredRows = [];

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    for (const invoiceId of normalizedIds) {
      const trashRow = await db.get('SELECT * FROM invoice_trash WHERE invoice_id = ?', [invoiceId]);
      if (!trashRow) {
        throw new InvoiceTrashError(`Trashed invoice with ID ${invoiceId} was not found.`, 404, 'TRASH_NOT_FOUND');
      }
      const conflict = await db.get(
        'SELECT id FROM invoices WHERE id = ? OR invoice_number = ?',
        [invoiceId, trashRow.invoice_number]
      );
      if (conflict) {
        throw new InvoiceTrashError(
          `Invoice ${trashRow.invoice_number} cannot be restored because its ID or number is already in use.`,
          409,
          'RESTORE_CONFLICT'
        );
      }
      const snapshot = parseSnapshot(trashRow);
      await restoreSnapshot(snapshot);
      await db.run('DELETE FROM invoice_trash WHERE id = ?', [trashRow.id]);
      snapshots.push(snapshot);
      restoredRows.push(trashRow);
    }
    await writeAudit({ userId, action: 'restore_trashed_invoices', invoiceRows: restoredRows, ipAddress });
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    if (!(error instanceof InvoiceTrashError) && String(error.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw new InvoiceTrashError(
        `The invoice selection could not be restored because related data conflicts with current records: ${error.message}`,
        409,
        'RESTORE_CONFLICT'
      );
    }
    throw error;
  }

  await refreshDerivedState(snapshots);
  return restoredRows;
}

async function getTrashedInvoices({ limit = 50, offset = 0, search = '' } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const params = [];
  let where = 'WHERE 1=1';
  if (search) {
    where += ' AND (it.invoice_number LIKE ? OR o.name LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }
  const totalRow = await db.get(
    `SELECT COUNT(*) AS total FROM invoice_trash it JOIN outlets o ON o.id = it.outlet_id ${where}`,
    params
  );
  const items = await db.all(
    `SELECT it.id AS trash_id, it.invoice_id AS id, it.invoice_number, it.outlet_id,
            o.name AS outlet_name, it.total_price, it.payment_status, it.shipping_status,
            it.was_archived, it.original_created_at AS created_at, it.trashed_at,
            datetime(it.trashed_at, '+${RETENTION_DAYS} days') AS purge_at,
            u.full_name AS trashed_by_name
     FROM invoice_trash it
     JOIN outlets o ON o.id = it.outlet_id
     LEFT JOIN users u ON u.id = it.trashed_by
     ${where}
     ORDER BY it.trashed_at DESC
     LIMIT ? OFFSET ?`,
    [...params, safeLimit, safeOffset]
  );
  return { items, total: totalRow ? totalRow.total : 0 };
}

async function getTrashedInvoice(invoiceId) {
  const id = Number(invoiceId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new InvoiceTrashError('Invoice ID must be a positive integer.');
  }
  const row = await db.get(
    `SELECT it.*, o.name AS outlet_name, u.full_name AS trashed_by_name,
            datetime(it.trashed_at, '+${RETENTION_DAYS} days') AS purge_at
     FROM invoice_trash it
     JOIN outlets o ON o.id = it.outlet_id
     LEFT JOIN users u ON u.id = it.trashed_by
     WHERE it.invoice_id = ?`,
    [id]
  );
  if (!row) return null;
  const snapshot = parseSnapshot(row);
  delete row.snapshot_json;
  return { ...row, snapshot };
}

function receiptPathsFromSnapshot(snapshot) {
  return [...new Set((snapshot.invoicePayments || [])
    .map(payment => payment.receipt_stored_path)
    .filter(Boolean))];
}

async function permanentlyDeleteTrashedInvoices({ invoiceIds, userId = null, ipAddress = null, automatic = false }) {
  const normalizedIds = normalizeInvoiceIds(invoiceIds);
  const deletedRows = [];

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    for (const invoiceId of normalizedIds) {
      const trashRow = await db.get('SELECT * FROM invoice_trash WHERE invoice_id = ?', [invoiceId]);
      if (!trashRow) {
        throw new InvoiceTrashError(`Trashed invoice with ID ${invoiceId} was not found.`, 404, 'TRASH_NOT_FOUND');
      }
      const snapshot = parseSnapshot(trashRow);
      for (const storedPath of receiptPathsFromSnapshot(snapshot)) {
        if (!isSafeUploadPath(storedPath)) {
          throw new InvoiceTrashError(
            `Receipt path for invoice ${trashRow.invoice_number} is outside the configured uploads directory.`,
            409,
            'UNSAFE_RECEIPT_PATH'
          );
        }
        await db.run(
          `INSERT OR IGNORE INTO invoice_trash_file_cleanup (stored_path)
           VALUES (?)`,
          [storedPath]
        );
      }
      await db.run('DELETE FROM invoice_trash WHERE id = ?', [trashRow.id]);
      deletedRows.push(trashRow);
    }
    await writeAudit({
      userId,
      action: automatic ? 'auto_purge_trashed_invoices' : 'permanently_delete_trashed_invoices',
      invoiceRows: deletedRows,
      ipAddress
    });
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }

  await processFileCleanupQueue();
  return deletedRows;
}

function isSafeUploadPath(storedPath) {
  const uploadsRoot = path.resolve(config.uploadsDir);
  const resolved = path.resolve(storedPath);
  return resolved.startsWith(`${uploadsRoot}${path.sep}`);
}

async function processFileCleanupQueue() {
  const queued = await db.all('SELECT * FROM invoice_trash_file_cleanup ORDER BY id');
  let cleaned = 0;
  for (const item of queued) {
    try {
      if (!isSafeUploadPath(item.stored_path)) {
        throw new Error('Refusing to delete a receipt path outside the configured uploads directory.');
      }
      if (fs.existsSync(item.stored_path)) fs.unlinkSync(item.stored_path);
      await db.run('DELETE FROM invoice_trash_file_cleanup WHERE id = ?', [item.id]);
      cleaned += 1;
    } catch (error) {
      await db.run(
        `UPDATE invoice_trash_file_cleanup
         SET attempts = attempts + 1, last_error = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [error.message, item.id]
      );
      console.error(`Failed to clean trashed invoice receipt ${item.stored_path}:`, error);
    }
  }
  return { cleaned, pending: queued.length - cleaned };
}

async function purgeExpiredTrash({ retentionDays = RETENTION_DAYS } = {}) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days < 0) throw new Error('Retention days must be a non-negative number.');
  const rows = await db.all(
    "SELECT invoice_id FROM invoice_trash WHERE trashed_at <= datetime('now', ?) ORDER BY trashed_at ASC",
    [`-${days} days`]
  );
  const results = { deleted: 0, failed: 0 };
  for (const row of rows) {
    try {
      await permanentlyDeleteTrashedInvoices({ invoiceIds: [row.invoice_id], automatic: true });
      results.deleted += 1;
    } catch (error) {
      results.failed += 1;
      console.error(`Automatic purge failed for invoice ${row.invoice_id}:`, error);
    }
  }
  await processFileCleanupQueue();
  return results;
}

module.exports = {
  SNAPSHOT_VERSION,
  RETENTION_DAYS,
  InvoiceTrashError,
  normalizeInvoiceIds,
  snapshotInvoice,
  trashInvoices,
  restoreTrashedInvoices,
  getTrashedInvoices,
  getTrashedInvoice,
  permanentlyDeleteTrashedInvoices,
  processFileCleanupQueue,
  purgeExpiredTrash
};
