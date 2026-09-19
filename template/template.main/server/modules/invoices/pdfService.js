const db = require('../../db');
const pdf = require('html-pdf-node');

const { formatEgyptDateTime, formatCurrencyEGP } = require('../../utils/formatters');

function translatePaymentStatus(status) {
  switch (status) {
    case 'paid': return 'مدفوع كلياً';
    case 'unpaid': return 'مؤجل كلياً';
    case 'partially_paid': return 'مدفوع جزئياً';
    case 'cancelled': return 'ملغاة';
    default: return status || 'غير معروف';
  }
}

function translatePaymentType(type) {
  switch (type) {
    case 'cash': return 'نقدي';
    case 'deferred': return 'آجل';
    default: return type || 'غير معروف';
  }
}

function translateShippingStatus(status) {
  switch (status) {
    case 'pending': return 'قيد الانتظار';
    case 'partially_shipped': return 'شحن جزئي';
    case 'shipped': return 'تم الشحن';
    default: return status || 'غير معروف';
  }
}

/**
 * Format datetime string into readable Arabic format.
 */
function formatDateTime(dateString) {
  const formatted = formatEgyptDateTime(dateString);
  return formatted === '-' ? 'N/A' : formatted;
}

/**
 * Formats numbers into standard currency formatting.
 */
function formatCurrency(val) {
  return formatCurrencyEGP(val);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[character]);
}

function buildShippingHtmlContent(invoices) {
  const cards = invoices.map((invoice, index) => `
    ${index ? '<div class="page-break"></div>' : ''}
    <section class="invoice">
      <h2>فاتورة شحن رقم: ${escapeHtml(invoice.invoice_number)}</h2>
      <div class="meta">
        <div><b>المنفذ:</b> ${escapeHtml(invoice.outlet_name)}</div>
        <div><b>التاريخ:</b> ${escapeHtml(formatDateTime(invoice.created_at))}</div>
        <div><b>العنوان:</b> ${escapeHtml([invoice.governorate, invoice.address_details].filter(Boolean).join(' - ') || 'غير محدد')}</div>
        <div><b>الهاتف:</b> ${escapeHtml(invoice.outlet_phone || 'غير محدد')}</div>
        <div><b>حالة الشحن:</b> ${escapeHtml(translateShippingStatus(invoice.shipping_status))}</div>
      </div>
      <table><thead><tr><th>الكتاب / المنتج</th><th>المؤلف</th><th>الكمية</th><th>المجاني</th></tr></thead>
      <tbody>${invoice.items.map(item => `<tr><td>${escapeHtml(item.product_title)}</td><td>${escapeHtml(item.authors || 'غير محدد')}</td><td>${escapeHtml(item.quantity)}</td><td>${escapeHtml(item.free_quantity || 0)}</td></tr>`).join('')}</tbody></table>
      ${invoice.notes ? `<div class="notes"><b>ملاحظات:</b> ${escapeHtml(invoice.notes)}</div>` : ''}
    </section>
  `).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><style>
    @page{size:A4;margin:15mm}body{font-family:Arial,sans-serif;direction:rtl;color:#1f2937;font-size:13px}
    h1{color:#1e3a8a;border-bottom:2px solid #1e3a8a;padding-bottom:10px}.invoice{page-break-inside:avoid;margin-bottom:24px}
    h2{background:#1e3a8a;color:white;padding:12px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;background:#f8fafc;padding:14px}
    table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #cbd5e1;padding:9px;text-align:right}th{background:#e2e8f0}.notes{margin-top:14px}.page-break{page-break-before:always}
  </style></head><body><h1>تقرير تجهيز وشحن الفواتير</h1>${cards}</body></html>`;
}

/**
 * Generates dynamic HTML representing selected invoices with RTL support and Arabic language markup.
 */
function buildHtmlContent(invoices) {
  let html = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>تقرير الفواتير</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">
      <style>
        @page {
          size: A4;
          margin: 15mm;
        }
        body {
          font-family: 'Tajawal', sans-serif;
          direction: rtl;
          text-align: right;
          background-color: #ffffff;
          color: #2c3e50;
          margin: 0;
          padding: 0;
          font-size: 13px;
          line-height: 1.5;
        }
        .container {
          width: 100%;
        }
        .report-header-main {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 15px;
          border-bottom: 2px solid #e2e8f0;
        }
        .report-title {
          font-size: 22px;
          font-weight: 800;
          color: #1e3a8a;
          margin: 0;
        }
        .report-date {
          font-size: 11px;
          color: #64748b;
        }
        .invoice-card {
          margin-bottom: 30px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background-color: #ffffff;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
          overflow: hidden;
          page-break-inside: avoid;
        }
        .invoice-header {
          background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%);
          color: #ffffff;
          padding: 16px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .invoice-number-title {
          font-size: 18px;
          font-weight: 700;
          margin: 0;
        }
        .invoice-body {
          padding: 24px;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          margin-bottom: 24px;
          background-color: #f8fafc;
          padding: 16px;
          border-radius: 8px;
          border: 1px solid #f1f5f9;
        }
        .meta-item {
          display: flex;
          align-items: baseline;
          font-size: 13px;
        }
        .meta-label {
          font-weight: 700;
          color: #475569;
          width: 120px;
          flex-shrink: 0;
        }
        .meta-value {
          color: #0f172a;
          flex-grow: 1;
        }
        
        /* Status Badges */
        .badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 700;
          text-align: center;
        }
        .badge-paid { background-color: #dcfce7; color: #15803d; }
        .badge-unpaid { background-color: #fee2e2; color: #b91c1c; }
        .badge-partially { background-color: #fef3c7; color: #d97706; }
        .badge-cancelled { background-color: #f1f5f9; color: #475569; }
        
        .badge-shipping-pending { background-color: #f1f5f9; color: #475569; }
        .badge-shipping-partial { background-color: #fef3c7; color: #d97706; }
        .badge-shipping-shipped { background-color: #e0f2fe; color: #0369a1; }

        .section-title {
          font-size: 14px;
          font-weight: 700;
          color: #1e3a8a;
          margin-top: 0;
          margin-bottom: 12px;
          border-bottom: 1px solid #e2e8f0;
          padding-bottom: 6px;
        }
        
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .items-table th, .items-table td {
          padding: 10px 14px;
          text-align: right;
          border-bottom: 1px solid #e2e8f0;
        }
        .items-table th {
          background-color: #f1f5f9;
          color: #334155;
          font-weight: 700;
          font-size: 12px;
        }
        .items-table tr:last-child td {
          border-bottom: none;
        }
        .items-table .number-col {
          text-align: left;
          direction: ltr;
        }
        
        .totals-section {
          display: flex;
          justify-content: flex-start;
          margin-top: 16px;
        }
        .totals-table {
          width: 300px;
          border-collapse: collapse;
        }
        .totals-table td {
          padding: 6px 12px;
          border-bottom: 1px solid #f1f5f9;
        }
        .totals-table tr:last-child td {
          border-bottom: none;
        }
        .totals-label {
          font-weight: 500;
          color: #475569;
        }
        .totals-value {
          text-align: left;
          font-weight: 700;
          color: #0f172a;
        }
        .grand-total-row {
          background-color: #f8fafc;
          border-top: 2px solid #e2e8f0;
        }
        .grand-total-row td {
          padding: 10px 12px !important;
          color: #1e3a8a !important;
          font-size: 14px;
          font-weight: 800 !important;
        }
        .page-break {
          page-break-before: always;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="report-header-main">
          <div class="report-title">تقرير الفواتير التفصيلي</div>
          <div class="report-date">تاريخ إنشاء التقرير: ${formatDateTime(new Date())}</div>
        </div>
  `;

  invoices.forEach((inv, index) => {
    if (index > 0) {
      html += '<div class="page-break"></div>';
    }

    const address = [inv.governorate, inv.address_details].filter(Boolean).join(' - ');
    
    // Determine payment status badge class
    let paymentBadgeClass = 'badge-unpaid';
    if (inv.payment_status === 'paid') paymentBadgeClass = 'badge-paid';
    if (inv.payment_status === 'partially_paid') paymentBadgeClass = 'badge-partially';
    if (inv.payment_status === 'cancelled') paymentBadgeClass = 'badge-cancelled';

    // Determine shipping status badge class
    let shippingBadgeClass = 'badge-shipping-pending';
    if (inv.shipping_status === 'partially_shipped') shippingBadgeClass = 'badge-shipping-partial';
    if (inv.shipping_status === 'shipped') shippingBadgeClass = 'badge-shipping-shipped';

    html += `
      <div class="invoice-card">
        <div class="invoice-header">
          <div class="invoice-number-title">فاتورة مبيعات رقم: ${inv.invoice_number}</div>
          <div style="font-size: 12px; opacity: 0.9;">التاريخ: ${formatDateTime(inv.created_at)}</div>
        </div>
        
        <div class="invoice-body">
          <div class="section-title">بيانات الفاتورة والعميل</div>
          <div class="meta-grid">
            <div class="meta-item">
              <span class="meta-label">اسم المنفذ:</span>
              <span class="meta-value">${inv.outlet_name}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">تاريخ الفاتورة:</span>
              <span class="meta-value">${formatDateTime(inv.created_at)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">العنوان:</span>
              <span class="meta-value">${address || 'غير محدد'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">تاريخ الدفع:</span>
              <span class="meta-value">${inv.payment_date ? formatDateTime(inv.payment_date) : 'غير مدفوع'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">الهاتف:</span>
              <span class="meta-value">${inv.outlet_phone || 'غير محدد'}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">حالة الدفع:</span>
              <span class="meta-value">
                <span class="badge ${paymentBadgeClass}">${translatePaymentStatus(inv.payment_status)}</span>
              </span>
            </div>
            <div class="meta-item">
              <span class="meta-label">نوع الدفع:</span>
              <span class="meta-value">${translatePaymentType(inv.payment_type)}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">حالة الشحن:</span>
              <span class="meta-value">
                <span class="badge ${shippingBadgeClass}">${translateShippingStatus(inv.shipping_status)}</span>
              </span>
            </div>
          </div>

          <div class="section-title">تفاصيل المواد المباعة</div>
          <table class="items-table">
            <thead>
              <tr>
                <th style="width: 40%;">الكتاب / المنتج</th>
                <th style="width: 25%;">المؤلف</th>
                <th style="width: 10%; text-align: center;">الكمية</th>
                <th style="width: 12%; text-align: left;">سعر الوحدة</th>
                <th style="width: 13%; text-align: left;">الإجمالي</th>
              </tr>
            </thead>
            <tbody>
    `;

    let subtotal = 0;
    inv.items.forEach(item => {
      const itemTotal = item.total_price || (item.quantity * item.unit_price);
      subtotal += itemTotal;
      html += `
        <tr>
          <td style="font-weight: 500;">${item.product_title} <span style="font-size: 10px; color: #64748b; display: block; margin-top: 2px;">كود: ${item.product_code}</span></td>
          <td style="color: #475569;">${item.authors || 'غير محدد'}</td>
          <td style="text-align: center; font-weight: bold;">${item.quantity}</td>
          <td class="number-col">${formatCurrency(item.unit_price)}</td>
          <td class="number-col" style="font-weight: bold;">${formatCurrency(itemTotal)}</td>
        </tr>
      `;
    });

    html += `
            </tbody>
          </table>

          <div class="section-title">الملخص المالي للفاتورة</div>
          <div class="totals-section">
            <table class="totals-table">
              <tr>
                <td class="totals-label">إجمالي المواد:</td>
                <td class="totals-value">${formatCurrency(subtotal)}</td>
              </tr>
              <tr>
                <td class="totals-label">تكلفة الشحن (+):</td>
                <td class="totals-value">${formatCurrency(inv.shipping_cost)}</td>
              </tr>
              <tr>
                <td class="totals-label">الخصم (-):</td>
                <td class="totals-value">${formatCurrency(inv.discount)}</td>
              </tr>
              <tr>
                <td class="totals-label">الإجمالي قبل المرتجعات:</td>
                <td class="totals-value">${formatCurrency(inv.total_price)}</td>
              </tr>
              <tr>
                <td class="totals-label">إجمالي المرتجعات (-):</td>
                <td class="totals-value">${formatCurrency(inv.returned_amount || 0)}</td>
              </tr>
              <tr class="grand-total-row">
                <td class="totals-label">الإجمالي بعد المرتجعات:</td>
                <td class="totals-value">${formatCurrency(inv.net_amount ?? inv.total_price)}</td>
              </tr>
            </table>
          </div>
          
          ${inv.notes ? `
            <div style="margin-top: 20px; padding: 12px; background-color: #f8fafc; border-right: 4px solid #3b82f6; border-radius: 4px; font-size: 11px; color: #475569;">
              <strong>ملاحظات:</strong> ${inv.notes}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </body>
    </html>
  `;

  return html;
}

/**
 * Main function to generate PDF from invoice IDs.
 */
async function generateInvoicesPdf(invoiceIds, { mode = 'full' } = {}) {
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    throw new Error('Invoice IDs must be a non-empty array');
  }

  const placeholders = invoiceIds.map(() => '?').join(',');

  // 1. Fetch invoices
  const invoicesSql = `
    SELECT i.*, o.name as outlet_name, o.governorate, o.address_details, o.phone as outlet_phone
    FROM invoices i
    JOIN outlets o ON o.id = i.outlet_id
    WHERE i.id IN (${placeholders})
    ORDER BY i.created_at DESC
  `;
  const invoices = await db.all(invoicesSql, invoiceIds);

  if (invoices.length === 0) {
    throw new Error('No invoices found matching the provided IDs');
  }

  // 2. Fetch associated items
  for (const inv of invoices) {
    const itemsSql = `
      SELECT ii.*, p.title as product_title, p.code as product_code,
             (SELECT GROUP_CONCAT(a.name, ' | ') 
              FROM authors a 
              JOIN product_authors pa ON pa.author_id = a.id 
              WHERE pa.product_id = p.id) as authors
      FROM invoice_items ii
      JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = ?
    `;
    inv.items = await db.all(itemsSql, [inv.id]);
  }

  // 3. Compile HTML layout
  const htmlContent = mode === 'shipping'
    ? buildShippingHtmlContent(invoices)
    : buildHtmlContent(invoices);

  // 4. Generate PDF buffer using html-pdf-node
  const file = { content: htmlContent };
  const options = { 
    format: 'A4', 
    printBackground: true,
    margin: {
      top: '15mm',
      bottom: '15mm',
      left: '15mm',
      right: '15mm'
    }
  };

  return await pdf.generatePdf(file, options);
}

module.exports = {
  generateInvoicesPdf,
  buildHtmlContent,
  buildShippingHtmlContent
};
