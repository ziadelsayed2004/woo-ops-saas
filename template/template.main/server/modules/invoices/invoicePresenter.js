const db = require('../../db');

const FINANCIAL_FIELDS = Object.freeze([
  'subtotal', 'discount', 'shipping_cost', 'total_price', 'payment_status',
  'payment_type', 'payment_date', 'paid_amount', 'returned_amount', 'net_amount', 'remaining_amount', 'payments'
]);
const ITEM_FINANCIAL_FIELDS = Object.freeze(['unit_price', 'total_price']);

function roleMode(roleNames = []) {
  if (roleNames.includes('super_admin') || roleNames.includes('assistant') || roleNames.includes('readonly_viewer') || roleNames.includes('outlet')) return 'full';
  if (roleNames.includes('author')) return 'author';
  if (roleNames.includes('shipping_user')) return 'shipping';
  return 'standard';
}

function stripFields(target, fields) {
  for (const field of fields) delete target[field];
}

async function linkedAuthorProductIds(userId) {
  const rows = await db.all(`
    SELECT DISTINCT pa.product_id
    FROM product_authors pa
    JOIN author_users au ON au.author_id = pa.author_id
    WHERE au.user_id = ?
  `, [userId]);
  return new Set(rows.map(row => row.product_id));
}

async function presentInvoice(invoice, { roleNames = [], userId, authorProductIds = null } = {}) {
  if (!invoice) return invoice;
  const result = { ...invoice };
  if (Array.isArray(invoice.items)) result.items = invoice.items.map(item => ({ ...item }));
  if (Array.isArray(invoice.history)) result.history = invoice.history.map(entry => ({ ...entry }));
  const mode = roleMode(roleNames);

  if (mode === 'shipping') {
    stripFields(result, FINANCIAL_FIELDS);
    result.history = Array.isArray(result.history)
      ? result.history.filter(entry => entry.status_type !== 'payment')
      : result.history;
    if (Array.isArray(result.items)) result.items.forEach(item => stripFields(item, ITEM_FINANCIAL_FIELDS));
  }

  if (mode === 'author') {
    const allowed = authorProductIds || await linkedAuthorProductIds(userId);
    if (Array.isArray(result.items)) {
      result.items = result.items.filter(item => allowed.has(item.product_id));
      result.author_subtotal = result.items.reduce((sum, item) => sum + Number(item.total_price || 0), 0);
    }
    stripFields(result, FINANCIAL_FIELDS);
    delete result.outlet_phone;
    result.history = Array.isArray(result.history)
      ? result.history.filter(entry => entry.status_type !== 'payment')
      : result.history;
  }
  return result;
}

async function presentInvoices(invoices, context) {
  const mode = roleMode(context.roleNames);
  const authorProductIds = mode === 'author' ? await linkedAuthorProductIds(context.userId) : null;
  const presented = await Promise.all(invoices.map(invoice => presentInvoice(invoice, { ...context, authorProductIds })));
  if (mode === 'author' && presented.length) {
    const invoiceIds = presented.map(invoice => invoice.id);
    const rows = await db.all(`
      SELECT ii.invoice_id, COALESCE(SUM(ii.total_price), 0) AS author_subtotal
      FROM invoice_items ii
      WHERE ii.invoice_id IN (${invoiceIds.map(() => '?').join(',')})
        AND ii.product_id IN (
          SELECT pa.product_id FROM product_authors pa
          JOIN author_users au ON au.author_id = pa.author_id
          WHERE au.user_id = ?
        )
      GROUP BY ii.invoice_id
    `, [...invoiceIds, context.userId]);
    const totals = new Map(rows.map(row => [row.invoice_id, row.author_subtotal]));
    presented.forEach(invoice => { invoice.author_subtotal = Number(totals.get(invoice.id) || 0); });
  }
  return presented;
}

module.exports = { FINANCIAL_FIELDS, ITEM_FINANCIAL_FIELDS, roleMode, presentInvoice, presentInvoices };
