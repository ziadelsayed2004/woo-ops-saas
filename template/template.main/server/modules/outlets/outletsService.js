const db = require('../../db');
const notificationsService = require('../notifications/notificationsService');

/**
 * Create a new outlet.
 */
async function createOutlet({ name, outletTypeId, governorate, addressDetails = '', phone = '', creditLimit = 0, status = 'active', notes = '', userId = null, code = '' }) {
  if (!name || !outletTypeId || !governorate) {
    throw new Error('Name, outlet type ID, and governorate are required');
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    let finalCode = code ? code.trim() : '';
    if (!finalCode) {
      // Generate default sequential code
      const row = await db.get("SELECT code as val FROM outlets WHERE code LIKE 'OUT-%' ORDER BY code DESC LIMIT 1");
      let nextNum = 1;
      if (row && row.val) {
        const match = row.val.match(/\d+$/);
        if (match) {
          nextNum = parseInt(match[0], 10) + 1;
        }
      }
      finalCode = `OUT-${String(nextNum).padStart(7, '0')}`;
    }

    const result = await db.run(
      `INSERT INTO outlets (name, outlet_type_id, governorate, address_details, phone, credit_limit, status, notes, code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), outletTypeId, governorate.trim(), addressDetails, phone, creditLimit, status, notes, finalCode]
    );
    const outletId = result.lastID;
    if (userId) {
      await db.run('INSERT INTO outlet_users (outlet_id, user_id) VALUES (?, ?)', [outletId, userId]);
    }
    await db.exec('COMMIT;');
    return { id: outletId, name, outletTypeId, governorate, addressDetails, phone, creditLimit, status, notes, userId, code: finalCode };
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }
}

/**
 * Update an existing outlet.
 */
async function updateOutlet(id, { name, outletTypeId, governorate, addressDetails, phone, creditLimit, status, notes, userId, code = '' }) {
  if (!name || !outletTypeId || !governorate) {
    throw new Error('Name, outlet type ID, and governorate are required');
  }
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('Invalid status');
  }

  await db.exec('BEGIN IMMEDIATE TRANSACTION;');
  let result;
  try {
    let finalCode = code ? code.trim() : '';
    if (!finalCode) {
      // Check if current outlet already has a code
      const current = await db.get("SELECT code FROM outlets WHERE id = ?", [id]);
      if (current && current.code) {
        finalCode = current.code;
      } else {
        const row = await db.get("SELECT code as val FROM outlets WHERE code LIKE 'OUT-%' ORDER BY code DESC LIMIT 1");
        let nextNum = 1;
        if (row && row.val) {
          const match = row.val.match(/\d+$/);
          if (match) {
            nextNum = parseInt(match[0], 10) + 1;
          }
        }
        finalCode = `OUT-${String(nextNum).padStart(7, '0')}`;
      }
    }

    result = await db.run(
      `UPDATE outlets
       SET name = ?, outlet_type_id = ?, governorate = ?, address_details = ?, phone = ?, credit_limit = ?, status = ?, notes = ?, code = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [name.trim(), outletTypeId, governorate.trim(), addressDetails, phone, creditLimit, status, notes, finalCode, id]
    );

    // Preserve the existing account association unless it was explicitly
    // supplied by an account administrator.
    if (userId !== undefined) {
      await db.run('DELETE FROM outlet_users WHERE outlet_id = ?', [id]);
      if (userId) {
        await db.run('INSERT INTO outlet_users (outlet_id, user_id) VALUES (?, ?)', [id, userId]);
      }
    }
    await db.exec('COMMIT;');
  } catch (error) {
    await db.exec('ROLLBACK;');
    throw error;
  }

  // Trigger notification check for the outlet credit limit after update
  try {
    await notificationsService.checkOutletCreditLimitNotifications(id);
  } catch (e) {
    console.error('Error running checkOutletCreditLimitNotifications on outlet update:', e);
  }

  return result.changes > 0;
}

/**
 * Find outlet by ID (joining with outlet_types to return type name).
 */
async function findById(id) {
  const sql = `
    SELECT o.*, ot.name as outlet_type_name, ou.user_id, u.username as linked_username
    FROM outlets o
    JOIN outlet_types ot ON ot.id = o.outlet_type_id
    LEFT JOIN outlet_users ou ON ou.outlet_id = o.id
    LEFT JOIN users u ON u.id = ou.user_id
    WHERE o.id = ?
  `;
  const row = await db.get(sql, [id]);
  if (row) {
    row.userId = row.user_id;
    delete row.user_id;
  }
  return row;
}

/**
 * Retrieve all outlets with filters.
 */
async function getAll({ limit = 50, offset = 0, search = '', governorate = '', outletTypeId = null, status = '', userId = null } = {}) {
  let sql = `
    SELECT o.*, ot.name as outlet_type_name, ou.user_id, u.username as linked_username
    FROM outlets o
    JOIN outlet_types ot ON ot.id = o.outlet_type_id
    LEFT JOIN outlet_users ou ON ou.outlet_id = o.id
    LEFT JOIN users u ON u.id = ou.user_id
    WHERE 1=1
  `;
  const params = [];

  if (search) {
    sql += ` AND (o.name LIKE ? OR o.phone LIKE ? OR o.code LIKE ?)`;
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  if (governorate) {
    sql += ` AND o.governorate = ?`;
    params.push(governorate);
  }
  if (outletTypeId) {
    sql += ` AND o.outlet_type_id = ?`;
    params.push(outletTypeId);
  }
  if (status) {
    sql += ` AND o.status = ?`;
    params.push(status);
  }
  if (userId) {
    sql += ` AND ou.user_id = ?`;
    params.push(userId);
  }

  sql += ` ORDER BY o.name ASC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = await db.all(sql, params);
  return rows.map(r => {
    r.userId = r.user_id;
    delete r.user_id;
    return r;
  });
}

/**
 * Get all outlet IDs linked to a specific user.
 */
async function getLinkedOutletsForUser(userId) {
  const rows = await db.all('SELECT outlet_id FROM outlet_users WHERE user_id = ?', [userId]);
  return rows.map(r => r.outlet_id);
}

/**
 * Update outlet status.
 */
async function updateStatus(id, status) {
  if (!['active', 'disabled'].includes(status)) {
    throw new Error('Invalid status');
  }
  const sql = `UPDATE outlets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  const result = await db.run(sql, [status, id]);
  return result.changes > 0;
}

async function deleteOutlet(id) {
  await db.run('DELETE FROM outlet_users WHERE outlet_id = ?', [id]);
  const result = await db.run('DELETE FROM outlets WHERE id = ?', [id]);
  return result.changes > 0;
}

/**
 * Retrieve comprehensive details for an outlet: its books (purchased vs returned), invoices, and a financial summary.
 */
async function getOutletDetailsReport(outletId) {
  const outlet = await findById(outletId);
  if (!outlet) {
    return null;
  }

  // 1. Invoices list
  const invoices = await db.all(`
    SELECT i.id, i.invoice_number, i.total_price, i.payment_status, i.shipping_status, i.payment_type, i.created_at,
           COALESCE(p.paid_amount, 0) as paid_amount,
           COALESCE(r.returned_amount, 0) as returned_amount,
           MAX(0, i.total_price - COALESCE(r.returned_amount, 0)) as net_amount,
           MAX(0, i.total_price - COALESCE(r.returned_amount, 0) - COALESCE(p.paid_amount, 0)) as remaining_amount
    FROM invoices i
    LEFT JOIN (
      SELECT invoice_id, SUM(amount) as paid_amount
      FROM invoice_payments
      WHERE receipt_status = 'approved' AND reversed_at IS NULL
      GROUP BY invoice_id
    ) p ON p.invoice_id = i.id
    LEFT JOIN (
      SELECT invoice_id, SUM(return_value) as returned_amount
      FROM returns
      WHERE status != 'cancelled'
      GROUP BY invoice_id
    ) r ON r.invoice_id = i.id
    WHERE i.outlet_id = ?
    ORDER BY i.created_at DESC
  `, [outletId]);

  // 2. Books / products purchased by this outlet
  const books = await db.all(`
    SELECT
      p.id as product_id,
      p.title as product_title,
      p.code as product_code,
      SUM(ii.quantity) as total_purchased,
      COALESCE(ri.returned_qty, 0) as total_returned,
      (SUM(ii.quantity) - COALESCE(ri.returned_qty, 0)) as net_quantity,
      AVG(ii.unit_price) as average_price,
      SUM(ii.total_price) as total_amount
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN products p ON p.id = ii.product_id
    LEFT JOIN (
      SELECT ri.product_id, SUM(ri.quantity) as returned_qty
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE r.outlet_id = ? AND r.status != 'cancelled'
      GROUP BY ri.product_id
    ) ri ON ri.product_id = p.id
    WHERE i.outlet_id = ? AND i.payment_status != 'cancelled'
    GROUP BY p.id
    ORDER BY net_quantity DESC
  `, [outletId, outletId]);

  // 3. Summary metrics
  const ledgerRow = await db.get(`
    SELECT 
      COALESCE(SUM(cash_amount), 0) as treasury_balance,
      COALESCE(SUM(receivable_amount), 0) as remaining_receivable
    FROM finance_ledger_entries
    WHERE outlet_id = ?
  `, [outletId]);

  const paidRow = await db.get(`
    SELECT COALESCE(SUM(p.amount), 0) AS total_paid
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE i.outlet_id = ? AND i.payment_status != 'cancelled'
      AND p.receipt_status = 'approved' AND p.reversed_at IS NULL`, [outletId]);

  const returnedRow = await db.get(`
    SELECT COALESCE(SUM(return_value), 0) as total_returned
    FROM returns
    WHERE outlet_id = ? AND status != 'cancelled'
  `, [outletId]);

  const invoicedRow = await db.get(`
    SELECT COALESCE(SUM(total_price), 0) as total_invoiced
    FROM invoices
    WHERE outlet_id = ? AND payment_status != 'cancelled'
  `, [outletId]);

  return {
    outlet,
    invoices,
    books,
    summary: {
      totalInvoiced: invoicedRow.total_invoiced,
      totalPaid: paidRow.total_paid,
      treasuryBalance: ledgerRow.treasury_balance,
      totalReturned: returnedRow.total_returned,
      totalRemaining: ledgerRow.remaining_receivable
    }
  };
}

module.exports = {
  createOutlet,
  updateOutlet,
  findById,
  getAll,
  getLinkedOutletsForUser,
  updateStatus,
  deleteOutlet,
  getOutletDetailsReport
};
