const pdf = require('html-pdf-node');
const db = require('../../db');
const reportsService = require('../reports/reportsService');
const ExcelJS = require('exceljs');
const { formatEgyptDateTime, formatEgyptDate } = require('../../utils/formatters');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');

function applyInvoiceVisibilityFilters(sql, params, options = {}, invoiceAlias = 'i', invoiceItemAlias = null) {
  const { allowedShippingStatuses, excludeCancelled, authorIds, outletIds } = options;

  if (Array.isArray(allowedShippingStatuses)) {
    if (allowedShippingStatuses.length === 0) {
      sql += ' AND 1=0';
    } else {
      const placeholders = allowedShippingStatuses.map(() => '?').join(', ');
      sql += ` AND ${invoiceAlias}.shipping_status IN (${placeholders})`;
      params.push(...allowedShippingStatuses);
    }
  }

  if (excludeCancelled) {
    sql += ` AND ${invoiceAlias}.payment_status != ?`;
    params.push('cancelled');
  }

  if (Array.isArray(outletIds)) {
    if (outletIds.length === 0) {
      sql += ' AND 1=0';
    } else {
      sql += ` AND ${invoiceAlias}.outlet_id IN (${outletIds.map(() => '?').join(', ')})`;
      params.push(...outletIds);
    }
  }

  if (Array.isArray(authorIds)) {
    if (authorIds.length === 0) {
      sql += ' AND 1=0';
    } else if (invoiceItemAlias) {
      sql += ` AND EXISTS (
        SELECT 1 FROM product_authors scope_pa
        WHERE scope_pa.product_id = ${invoiceItemAlias}.product_id
          AND scope_pa.author_id IN (${authorIds.map(() => '?').join(', ')})
      )`;
      params.push(...authorIds);
    } else {
      sql += ` AND EXISTS (
        SELECT 1
        FROM invoice_items scope_ii
        JOIN product_authors scope_pa ON scope_pa.product_id = scope_ii.product_id
        WHERE scope_ii.invoice_id = ${invoiceAlias}.id
          AND scope_pa.author_id IN (${authorIds.map(() => '?').join(', ')})
      )`;
      params.push(...authorIds);
    }
  }

  return sql;
}

/**
 * Escapes CSV values and wraps them in double quotes.
 */
function escapeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let stringVal = String(val).trim();
  stringVal = stringVal.replace(/"/g, '""');
  return `"${stringVal}"`;
}

/**
 * Converts a list of JSON objects into an Arabic CSV report with UTF-8 BOM, report headers, and totals.
 */
function jsonToCsvArabic({ title, filters = [], arabicHeaders, englishKeys, rows, summaryKeys = [] }) {
  const lines = [];

  // 1. Report Title and Filters
  if (title) {
    lines.push(escapeCsvValue(title));
  }
  if (filters && filters.length > 0) {
    lines.push(escapeCsvValue('الفلاتر المطبقة: ' + filters.join(' | ')));
  }
  if (title || (filters && filters.length > 0)) {
    lines.push(''); // blank row separator
  }

  // 2. Localized Arabic headers
  lines.push(arabicHeaders.map(escapeCsvValue).join(','));

  // 3. Data rows
  rows.forEach(row => {
    const rowCsv = englishKeys.map(key => escapeCsvValue(row[key])).join(',');
    lines.push(rowCsv);
  });

  // 4. Totals Row at the bottom
  if (summaryKeys && summaryKeys.length > 0 && rows.length > 0) {
    lines.push(''); // blank separator row
    const totalRow = englishKeys.map((key, idx) => {
      if (idx === 0) {
        return 'الإجمالي الكلي';
      }
      if (summaryKeys.includes(key)) {
        const sum = rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0);
        return parseFloat(sum.toFixed(2));
      }
      return '';
    });
    lines.push(totalRow.map(escapeCsvValue).join(','));
  }

  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Converts a list of JSON objects into a professional styled Excel file using ExcelJS.
 */

/**
 * Converts a list of JSON objects into a professional styled PDF document using html-pdf-node.
 */
async function jsonToPdfArabic({ title, filters = [], arabicHeaders, englishKeys, rows, summaryKeys = [] }) {
  const headerHtml = arabicHeaders.map(h => `<th>${h}</th>`).join('');

  let rowsHtml = '';
  rows.forEach((row, idx) => {
    const cellsHtml = englishKeys.map(key => {
      const val = row[key];
      const lowerKey = key.toLowerCase();
      const isMonetary = lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('amount') || lowerKey.includes('sales') || lowerKey.includes('paid') || lowerKey.includes('remaining') || lowerKey.includes('limit') || lowerKey.includes('value');
      
      let formattedVal = val === null || val === undefined ? '' : val;
      if (isMonetary && typeof val === 'number') {
        formattedVal = val.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
      } else if (typeof val === 'number') {
        formattedVal = val.toLocaleString('ar-EG');
      }
      return `<td>${formattedVal}</td>`;
    }).join('');
    
    rowsHtml += `<tr>${cellsHtml}</tr>`;
  });

  let totalsHtml = '';
  if (summaryKeys && summaryKeys.length > 0 && rows.length > 0) {
    const firstSummaryIdx = englishKeys.findIndex(key => summaryKeys.includes(key));
    const cellsHtml = englishKeys.map((key, idx) => {
      if (idx === 0) {
        return `<td colspan="${firstSummaryIdx > 0 ? firstSummaryIdx : 1}" style="font-weight: bold; background: #e2e8f0; text-align: center;">الإجمالي الكلي</td>`;
      }
      if (idx < firstSummaryIdx) {
        return '';
      }
      if (summaryKeys.includes(key)) {
        const sum = rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0);
        const lowerKey = key.toLowerCase();
        const isMonetary = lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('amount') || lowerKey.includes('sales') || lowerKey.includes('paid') || lowerKey.includes('remaining') || lowerKey.includes('limit') || lowerKey.includes('value');
        let formattedSum = sum;
        if (isMonetary) {
          formattedSum = sum.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ج.م';
        } else {
          formattedSum = sum.toLocaleString('ar-EG');
        }
        return `<td style="font-weight: bold; background: #e2e8f0;">${formattedSum}</td>`;
      }
      return `<td style="background: #e2e8f0;"></td>`;
    }).filter(c => c !== '').join('');
    
    totalsHtml = `<tfoot><tr>${cellsHtml}</tr></tfoot>`;
  }

  const filtersText = filters && filters.length > 0 ? `<div class="filters">الفلاتر المطبقة: ${filters.join(' | ')}</div>` : '';

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="UTF-8">
      <title>${title || 'تقرير'}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap');
        body {
          font-family: 'Cairo', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          margin: 20px;
          color: #1e293b;
          direction: rtl;
        }
        .header-container {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 3px solid #1e3a8a;
          padding-bottom: 10px;
        }
        .report-title {
          font-size: 20px;
          font-weight: bold;
          color: #1e3a8a;
          margin: 0 0 5px 0;
        }
        .filters {
          font-size: 11px;
          color: #475569;
          font-style: italic;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          font-size: 10px;
          page-break-inside: auto;
        }
        tr {
          page-break-inside: avoid;
          page-break-after: auto;
        }
        th {
          background-color: #1e3a8a;
          color: white;
          font-weight: bold;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          text-align: center;
        }
        td {
          padding: 6px 10px;
          border: 1px solid #e2e8f0;
          text-align: center;
        }
        tr:nth-child(even) {
          background-color: #f8fafc;
        }
        tfoot td {
          border-top: 2px solid #94a3b8;
          border-bottom: 3px double #94a3b8;
        }
        .footer {
          margin-top: 20px;
          text-align: left;
          font-size: 9px;
          color: #64748b;
        }
      </style>
    </head>
    <body>
      <div class="header-container">
        <h1 class="report-title">${title || 'تقرير النظام'}</h1>
        ${filtersText}
      </div>
      <table>
        <thead>
          <tr>
            ${headerHtml}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
        ${totalsHtml}
      </table>
      <div class="footer">
        تم استخراج التقرير تلقائياً بتاريخ: ${new Date().toLocaleString('ar-EG')} - مطبعة حمزة
      </div>
    </body>
    </html>
  `;

  const options = {
    format: 'A4',
    margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
  };
  const file = { content: htmlContent };
  return await pdf.generatePdf(file, options);
}

async function jsonToExcelArabic({ title, filters = [], arabicHeaders, englishKeys, rows, summaryKeys = [] }) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(title ? title.substring(0, 31) : 'تقرير', {
    views: [{ rightToLeft: true, showGridLines: true }]
  });

  let currentRowNum = 1;

  // 1. Title Row
  if (title) {
    const titleCell = worksheet.getCell(`A${currentRowNum}`);
    titleCell.value = title;
    titleCell.font = { name: 'Segoe UI', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F172A' } // Slate 900
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.mergeCells(currentRowNum, 1, currentRowNum, arabicHeaders.length);
    worksheet.getRow(currentRowNum).height = 42;
    currentRowNum += 2;
  }

  // 2. Filters
  if (filters && filters.length > 0) {
    const filterCell = worksheet.getCell(`A${currentRowNum}`);
    filterCell.value = 'الفلاتر المطبقة: ' + filters.join(' | ');
    filterCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF475569' } };
    worksheet.mergeCells(currentRowNum, 1, currentRowNum, arabicHeaders.length);
    worksheet.getRow(currentRowNum).height = 20;
    currentRowNum++;
  }

  currentRowNum++; // spacer

  // 3. Headers
  const headerRowIndex = currentRowNum;
  const headerRow = worksheet.getRow(headerRowIndex);
  headerRow.values = arabicHeaders;
  headerRow.height = 32;
  headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };

  for (let col = 1; col <= arabicHeaders.length; col++) {
    const cell = headerRow.getCell(col);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E3A8A' } // Deep Navy Blue
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  }
  currentRowNum++;

  // 4. Data
  rows.forEach((row) => {
    const dataRow = worksheet.getRow(currentRowNum);
    const rowValues = englishKeys.map(key => {
      const val = row[key];
      if (val !== null && val !== undefined && !isNaN(Number(val)) && String(val).trim() !== '' && typeof val !== 'string') {
        return Number(val);
      }
      return val === null || val === undefined ? '' : val;
    });
    dataRow.values = rowValues;
    dataRow.height = 24;
    dataRow.font = { name: 'Segoe UI', size: 10 };

    for (let col = 1; col <= englishKeys.length; col++) {
      const cell = dataRow.getCell(col);
      const key = englishKeys[col - 1];
      const val = rowValues[col - 1];

      // Smart alignment & formatting based on key name
      const lowerKey = key.toLowerCase();
      const isMonetary = lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('amount') || lowerKey.includes('sales') || lowerKey.includes('paid') || lowerKey.includes('remaining') || lowerKey.includes('limit') || lowerKey.includes('value');
      const isQuantity = lowerKey.includes('quantity') || lowerKey.includes('count') || lowerKey.includes('copies') || lowerKey.includes('totalbooks') || lowerKey.includes('totalquantity') || lowerKey.includes('totalreceipts') || lowerKey.includes('shipped_quantity');

      cell.alignment = { horizontal: 'center', vertical: 'middle' };

      if (isMonetary && typeof val === 'number') {
        cell.numFmt = '#,##0.00" ج.م"';
      } else if (isQuantity && typeof val === 'number') {
        cell.numFmt = '#,##0';
      }

      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };

      // Zebra striping
      if (currentRowNum % 2 === 0) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' } // Slate 50
        };
      }
    }
    currentRowNum++;
  });

  // 5. Totals
  if (summaryKeys && summaryKeys.length > 0 && rows.length > 0) {
    const totalsRow = worksheet.getRow(currentRowNum);
    totalsRow.height = 28;
    totalsRow.font = { name: 'Segoe UI', size: 10, bold: true };

    const firstSummaryIdx = englishKeys.findIndex(key => summaryKeys.includes(key));

    const totalsValues = new Array(englishKeys.length).fill('');
    if (firstSummaryIdx > 0) {
      totalsValues[0] = 'الإجمالي الكلي';
    } else {
      totalsValues[0] = 'الإجمالي الكلي';
    }

    englishKeys.forEach((key, idx) => {
      if (summaryKeys.includes(key)) {
        const sum = rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0);
        totalsValues[idx] = parseFloat(sum.toFixed(2));
      }
    });

    totalsRow.values = totalsValues;

    for (let col = 1; col <= englishKeys.length; col++) {
      const cell = totalsRow.getCell(col);
      const key = englishKeys[col - 1];
      const val = totalsValues[col - 1];

      const lowerKey = key.toLowerCase();
      const isMonetary = lowerKey.includes('price') || lowerKey.includes('cost') || lowerKey.includes('amount') || lowerKey.includes('sales') || lowerKey.includes('paid') || lowerKey.includes('remaining') || lowerKey.includes('limit') || lowerKey.includes('value');
      const isQuantity = lowerKey.includes('quantity') || lowerKey.includes('count') || lowerKey.includes('copies') || lowerKey.includes('totalbooks') || lowerKey.includes('totalquantity') || lowerKey.includes('totalreceipts') || lowerKey.includes('shipped_quantity');

      cell.alignment = { horizontal: 'center', vertical: 'middle' };

      if (isMonetary && typeof val === 'number') {
        cell.numFmt = '#,##0.00" ج.م"';
      } else if (isQuantity && typeof val === 'number') {
        cell.numFmt = '#,##0';
      }

      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' } // Slate 200
      };
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF94A3B8' } },
        left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        bottom: { style: 'double', color: { argb: 'FF94A3B8' } },
        right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    }

    // Merge empty cells before first summary column
    if (firstSummaryIdx > 0) {
      worksheet.mergeCells(currentRowNum, 1, currentRowNum, firstSummaryIdx);
      const mergedCell = totalsRow.getCell(1);
      mergedCell.value = 'الإجمالي الكلي';
      mergedCell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  // Auto-fit column widths
  worksheet.columns.forEach(column => {
    let maxLen = 12;
    column.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      if (rowNumber >= headerRowIndex && cell.value) {
        let displayVal = String(cell.value);
        if (cell.numFmt && cell.numFmt.includes('ج.م') && typeof cell.value === 'number') {
          displayVal += ' ج.م';
        }
        const valueLength = displayVal.length;
        if (valueLength > maxLen) {
          maxLen = valueLength;
        }
      }
    });
    // Add extra padding for Cairo / Segoe UI Arabic fonts which need more room
    column.width = Math.max(12, Math.min(50, Math.ceil(maxLen * 1.25) + 3));
  });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Export products catalog.
 */
async function exportProducts(format = 'xlsx') {
  const sql = `
    SELECT p.id, p.title, p.code, p.category, p.status, p.stock_policy,
           (SELECT GROUP_CONCAT(a.name, ' | ') 
            FROM authors a 
            JOIN product_authors pa ON pa.author_id = a.id 
            WHERE pa.product_id = p.id) as authors,
           (SELECT GROUP_CONCAT(ot.name || ': ' || pp.price, ' | ') 
            FROM product_prices pp 
            JOIN outlet_types ot ON ot.id = pp.outlet_type_id 
            WHERE pp.product_id = p.id) as prices
    FROM products p
    ORDER BY p.title ASC
  `;
  const rows = await db.all(sql);
  const config = {
    title: 'دليل المنتجات والكتب المسجلة',
    arabicHeaders: ['المعرف', 'الاسم/العنوان', 'الرمز/الكود', 'التصنيف', 'الحالة', 'سياسة المخزون', 'المؤلفون', 'الأسعار بمنافذ التوزيع'],
    englishKeys: ['id', 'title', 'code', 'category', 'status', 'stock_policy', 'authors', 'prices'],
    rows
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export product prices matrix.
 */
async function exportPrices(format = 'xlsx') {
  const sql = `
    SELECT pp.id, p.title as product_title, p.code as product_code, ot.name as outlet_type_name, pp.price
    FROM product_prices pp
    JOIN products p ON p.id = pp.product_id
    JOIN outlet_types ot ON ot.id = pp.outlet_type_id
    ORDER BY p.title ASC, ot.name ASC
  `;
  const rows = await db.all(sql);
  const config = {
    title: 'قائمة أسعار المنتجات حسب فئة المنفذ',
    arabicHeaders: ['المعرف', 'اسم الكتاب', 'رمز الكتاب', 'فئة منفذ التوزيع', 'السعر (ج.م)'],
    englishKeys: ['id', 'product_title', 'product_code', 'outlet_type_name', 'price'],
    rows,
    summaryKeys: ['price']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export authors list.
 */
async function exportAuthors(format = 'xlsx') {
  const sql = `
    SELECT a.id, a.name, a.phone, a.status,
           (SELECT GROUP_CONCAT(user_id, ' | ') FROM author_users au WHERE au.author_id = a.id) as user_ids
    FROM authors a
    ORDER BY a.name ASC
  `;
  const rows = await db.all(sql);
  const config = {
    title: 'قائمة أسماء وبيانات المؤلفين',
    arabicHeaders: ['المعرف', 'الاسم', 'الهاتف', 'الحالة', 'معرفات المستخدمين'],
    englishKeys: ['id', 'name', 'phone', 'status', 'user_ids'],
    rows
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export outlets listing.
 */
async function exportOutlets(format = 'xlsx') {
  const sql = `
    SELECT o.id, o.name, ot.name as outlet_type_name, o.governorate, o.address_details, o.phone, o.credit_limit, o.status, o.notes
    FROM outlets o
    JOIN outlet_types ot ON ot.id = o.outlet_type_id
    ORDER BY o.name ASC
  `;
  const rows = await db.all(sql);
  const config = {
    title: 'دليل منافذ البيع ومراكز التوزيع',
    arabicHeaders: ['المعرف', 'اسم منفذ التوزيع', 'الفئة', 'المحافظة', 'تفاصيل العنوان', 'الهاتف', 'الحد الائتماني (ج.م)', 'الحالة', 'ملاحظات'],
    englishKeys: ['id', 'name', 'outlet_type_name', 'governorate', 'address_details', 'phone', 'credit_limit', 'status', 'notes'],
    rows,
    summaryKeys: ['credit_limit']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export invoices list with financial breakdowns.
 */
async function exportInvoices(query = {}, format = 'xlsx', accessOptions = {}) {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      i.id, i.invoice_number, o.name as outlet_name,
      (
        SELECT GROUP_CONCAT(p.title || ' (x' || ii.quantity || ')', ' | ')
        FROM invoice_items ii
        JOIN products p ON p.id = ii.product_id
        WHERE ii.invoice_id = i.id
      ) as invoice_contents,
      i.subtotal, i.discount, i.shipping_cost, i.total_price,
      COALESCE(p.paid_amount, 0) as paid_amount,
      MAX(0, i.total_price - COALESCE(r.returned_amount, 0) - COALESCE(p.paid_amount, 0)) as remaining_amount,
      i.payment_status, i.shipping_status, i.payment_type, i.notes, i.created_at
    FROM invoices i
    JOIN outlets o ON o.id = i.outlet_id
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
    WHERE 1=1
  `;
  sql = applyInvoiceVisibilityFilters(sql, params, accessOptions);
  if (query.outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.paymentStatus) {
    sql += ` AND i.payment_status = ?`;
    params.push(query.paymentStatus);
    filtersApplied.push(`حالة الدفع: ${query.paymentStatus}`);
  }
  if (query.shippingStatus) {
    sql += ` AND i.shipping_status = ?`;
    params.push(query.shippingStatus);
    filtersApplied.push(`حالة الشحن: ${query.shippingStatus}`);
  }
  if (query.paymentType) {
    sql += ` AND i.payment_type = ?`;
    params.push(query.paymentType);
    filtersApplied.push(`نوع الدفع: ${query.paymentType}`);
  }
  if (query.startDate) {
    sql += ` AND i.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND i.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY i.created_at DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => ({
    ...r,
    created_at: formatEgyptDateTime(r.created_at)
  }));

  const config = {
    title: 'سجل مبيعات الفواتير والتحليلات المالية',
    filters: filtersApplied,
    arabicHeaders: [
      'المعرف', 'رقم الفاتورة', 'اسم المنفذ', 'محتويات الفاتورة', 'المجموع الفرعي (ج.م)', 'الخصم (ج.م)', 'تكلفة الشحن (ج.م)', 'المجموع الكلي (ج.م)',
      'المبلغ المدفوع (ج.م)', 'المبلغ المتبقي (ج.م)', 'حالة الدفع', 'حالة الشحن', 'نوع الدفع', 'الملاحظات', 'تاريخ الإنشاء'
    ],
    englishKeys: [
      'id', 'invoice_number', 'outlet_name', 'invoice_contents', 'subtotal', 'discount', 'shipping_cost', 'total_price',
      'paid_amount', 'remaining_amount', 'payment_status', 'shipping_status', 'payment_type', 'notes', 'created_at'
    ],
    rows: formattedRows,
    summaryKeys: ['subtotal', 'discount', 'shipping_cost', 'total_price', 'paid_amount', 'remaining_amount']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export payment receipts history.
 */
async function exportPayments(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT ip.id, i.invoice_number, ip.amount, ip.payment_method, ip.payment_date, ip.reference_number, ip.notes, u.full_name as recorded_by,
           ip.receipt_status, ip.supply_status
    FROM invoice_payments ip
    JOIN invoices i ON i.id = ip.invoice_id
    LEFT JOIN users u ON u.id = ip.recorded_by
    WHERE 1=1
  `;
  if (query.outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.supplyStatus) {
    sql += ` AND ip.supply_status = ?`;
    params.push(query.supplyStatus);
    filtersApplied.push(`حالة التوريد: ${query.supplyStatus}`);
  }
  if (query.startDate) {
    sql += ` AND ip.payment_date >= ?`;
    params.push(query.startDate);
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND ip.payment_date <= ?`;
    params.push(query.endDate);
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY ip.payment_date DESC, ip.created_at DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => {
    let readableReceiptStatus = 'معتمد';
    if (r.receipt_status === 'pending_review') readableReceiptStatus = 'قيد المراجعة';
    else if (r.receipt_status === 'rejected') readableReceiptStatus = 'مرفوض';

    let readableSupplyStatus = 'معلق لم يتم التوريد';
    if (r.supply_status === 'supplied') readableSupplyStatus = 'تم التوريد للمقر';

    return {
      ...r,
      payment_date: formatEgyptDate(r.payment_date),
      receipt_status_ar: readableReceiptStatus,
      supply_status_ar: readableSupplyStatus
    };
  });

  const config = {
    title: 'سجل تحصيل مدفوعات العملاء ومراجعة الإيصالات',
    filters: filtersApplied,
    arabicHeaders: ['المعرف', 'رقم الفاتورة', 'المبلغ المحصل (ج.م)', 'طريقة الدفع', 'تاريخ السداد', 'رقم المرجع', 'حالة مراجعة الإيصال', 'حالة التوريد للمقر', 'الملاحظات', 'سجلت بواسطة'],
    englishKeys: ['id', 'invoice_number', 'amount', 'payment_method', 'payment_date', 'reference_number', 'receipt_status_ar', 'supply_status_ar', 'notes', 'recorded_by'],
    rows: formattedRows,
    summaryKeys: ['amount']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export inventory ledger transactions.
 */
async function exportInventory(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT t.id, p.title as product_title, p.code as product_code, t.transaction_type, t.quantity, t.reference_type, t.reference_id, u.full_name as created_by, t.created_at
    FROM inventory_transactions t
    JOIN products p ON p.id = t.product_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE 1=1
  `;
  if (query.productId) {
    sql += ` AND t.product_id = ?`;
    params.push(query.productId);
    const prod = await db.get('SELECT title FROM products WHERE id = ?', [query.productId]);
    filtersApplied.push(`الكتاب/المنتج: ${prod ? prod.title : query.productId}`);
  }
  if (query.transactionType) {
    sql += ` AND t.transaction_type = ?`;
    params.push(query.transactionType);
    filtersApplied.push(`نوع الحركة: ${query.transactionType}`);
  }
  if (query.startDate) {
    sql += ` AND t.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND t.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY t.created_at DESC`;

  const rows = await db.all(sql, params);
  const transactionTypeLabels = {
    receipt: 'وارد كتب (استلام مخزون)',
    sale: 'مبيعات فواتير',
    adjustment: 'تسوية مستودعية',
    return: 'مرتجع عميل / تصحيح فاتورة',
    supplier_return: 'مرتجع مورد',
    receipt_cancellation: 'إلغاء توريد'
  };
  const formattedRows = rows.map(r => ({
    ...r,
    transaction_type: transactionTypeLabels[r.transaction_type] || r.transaction_type,
    created_at: formatEgyptDateTime(r.created_at)
  }));

  const config = {
    title: 'سجل حركات المخزن التفصيلية',
    filters: filtersApplied,
    arabicHeaders: ['المعرف', 'عنوان الكتاب', 'رمز الكتاب', 'نوع الحركة', 'الكمية', 'نوع المستند المرجعي', 'رقم المستند المرجعي', 'سجلت بواسطة', 'تاريخ الحركة'],
    englishKeys: ['id', 'product_title', 'product_code', 'transaction_type', 'quantity', 'reference_type', 'reference_id', 'created_by', 'created_at'],
    rows: formattedRows,
    summaryKeys: ['quantity']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

const usersService = require('../users/usersService');
const outletsService = require('../outlets/outletsService');
const authorsService = require('../authors/authorsService');

/**
 * Export report to CSV / XLSX.
 */
async function exportReport(reportType, query = {}, sessionUser = null, format = 'xlsx', { includeFinancials = true } = {}) {
  let filterOutletIds = null;
  let filterAuthorIds = null;

  if (sessionUser) {
    const userId = sessionUser.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    if (!isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
      filterAuthorIds = await authorsService.getLinkedAuthorsForUser(userId);
    }
  }

  let config = {};

  if (reportType === 'balances') {
    const rows = await reportsService.getBalancesByOutlet({
      outletIds: filterOutletIds
    });
    config = {
      title: 'تقرير الأرصدة والمبيعات والتحصيلات لمنافذ التوزيع',
      arabicHeaders: ['معرف المنفذ', 'اسم منفذ التوزيع', 'الفئة', 'المحافظة', 'الحد الائتماني (ج.م)', 'إجمالي المبيعات (ج.م)', 'إجمالي المدفوعات (ج.م)', 'الرصيد المتبقي المستحق (ج.م)'],
      englishKeys: ['outletId', 'outletName', 'outletTypeName', 'governorate', 'creditLimit', 'totalSales', 'totalPaid', 'remainingAmount'],
      rows,
      summaryKeys: ['creditLimit', 'totalSales', 'totalPaid', 'remainingAmount']
    };
  } else if (reportType === 'stock') {
    const rows = await reportsService.getStockReport({
      authorIds: filterAuthorIds
    });
    config = {
      title: 'تقرير جرد المخازن وحركة الكتب',
      arabicHeaders: ['معرف الكتاب', 'عنوان الكتاب', 'رمز الكتاب', 'التصنيف', 'الحالة', 'سياسة المخزون', 'صافي الوارد', 'صافي المبيعات', 'المشحون', 'المتبقي من المبيعات', 'رصيد المخزون', 'رصيد الشحن المسجل', 'المتاح للشحن', 'عجز الشحن السابق', 'التوريد المطلوب لتغطية المبيعات', 'إجمالي الوارد', 'مرتجع المورد', 'إلغاء التوريد', 'مرتجع العميل', 'التسويات'],
      englishKeys: ['productId', 'productTitle', 'productCode', 'category', 'status', 'stockPolicy', 'netReceived', 'netSales', 'totalShipped', 'remainingToShip', 'stockBalance', 'shippableStockBalance', 'availableToShip', 'shippingSupplyGap', 'supplyRequiredToFulfill', 'totalReceived', 'totalSupplierReturned', 'totalReceiptCancelled', 'customerReturns', 'totalAdjusted'],
      rows,
      summaryKeys: ['netReceived', 'netSales', 'totalShipped', 'remainingToShip', 'stockBalance', 'shippableStockBalance', 'availableToShip', 'shippingSupplyGap', 'supplyRequiredToFulfill', 'totalReceived', 'totalSupplierReturned', 'totalReceiptCancelled', 'customerReturns', 'totalAdjusted']
    };
  } else if (reportType === 'authors') {
    const rows = await reportsService.getAuthorReport({
      authorIds: filterAuthorIds
    });
    const visibleRows = includeFinancials ? rows : rows.map(({ totalSales: _totalSales, ...row }) => row);
    config = {
      title: 'تقرير مبيعات وأرصدة كتب المؤلفين',
      arabicHeaders: includeFinancials ? ['معرف المؤلف', 'اسم المؤلف', 'الحالة', 'إجمالي عدد الكتب', 'إجمالي المبيعات (ج.م)', 'إجمالي النسخ المباعة', 'الرصيد الحالي بالمخزن'] : ['معرف المؤلف', 'اسم المؤلف', 'الحالة', 'إجمالي عدد الكتب', 'إجمالي النسخ المباعة', 'الرصيد الحالي بالمخزن'],
      englishKeys: includeFinancials ? ['authorId', 'authorName', 'status', 'totalBooks', 'totalSales', 'totalCopiesSold', 'currentStock'] : ['authorId', 'authorName', 'status', 'totalBooks', 'totalCopiesSold', 'currentStock'],
      rows: visibleRows,
      summaryKeys: includeFinancials ? ['totalBooks', 'totalSales', 'totalCopiesSold', 'currentStock'] : ['totalBooks', 'totalCopiesSold', 'currentStock']
    };
  } else if (reportType === 'receipts') {
    const rows = await reportsService.getReceiptReport({
      authorIds: filterAuthorIds
    });
    const visibleRows = includeFinancials ? rows : rows.map(({ totalCost: _totalCost, ...row }) => row);
    config = {
      title: 'تقرير توريد الكتب وأذونات الاستلام من الموردين',
      arabicHeaders: includeFinancials ? ['اسم المورد', 'إجمالي أذونات الاستلام', 'إجمالي الكمية الموردة', 'مرتجع المورد', 'صافي الكمية', 'إجمالي التكلفة الكلية (ج.م)'] : ['اسم المورد', 'إجمالي أذونات الاستلام', 'إجمالي الكمية الموردة', 'مرتجع المورد', 'صافي الكمية'],
      englishKeys: includeFinancials ? ['supplierName', 'totalReceipts', 'totalQuantity', 'totalReturnedQuantity', 'netQuantity', 'totalCost'] : ['supplierName', 'totalReceipts', 'totalQuantity', 'totalReturnedQuantity', 'netQuantity'],
      rows: visibleRows,
      summaryKeys: includeFinancials ? ['totalReceipts', 'totalQuantity', 'totalReturnedQuantity', 'netQuantity', 'totalCost'] : ['totalReceipts', 'totalQuantity', 'totalReturnedQuantity', 'netQuantity']
    };
  } else if (reportType === 'product-sales') {
    const rows = await reportsService.getProductSalesByGovernorate({
      productId: query.productId ? parseInt(query.productId, 10) : null,
      startDate: query.startDate || '',
      endDate: query.endDate || '',
      governorate: query.governorate || '',
      authorIds: filterAuthorIds
    });
    config = {
      title: 'تحليل مبيعات الكتاب حسب المحافظة',
      arabicHeaders: ['المحافظة', 'عدد الفواتير', 'إجمالي الكمية', 'الكمية المسعرة', 'المجاني', 'المرتجع', 'صافي المبيعات', 'المشحون', 'المتبقي للشحن', 'صافي الموجود لدى العملاء', 'على فواتير مدفوعة', 'على فواتير جزئية', 'على فواتير غير مدفوعة'],
      englishKeys: ['governorate', 'invoiceCount', 'totalQuantity', 'billableQuantity', 'freeQuantity', 'returnedQuantity', 'netQuantity', 'shippedQuantity', 'remainingToShip', 'netCustomerQuantity', 'paidQuantity', 'partiallyPaidQuantity', 'unpaidQuantity'],
      rows,
      summaryKeys: ['invoiceCount', 'totalQuantity', 'billableQuantity', 'freeQuantity', 'returnedQuantity', 'netQuantity', 'shippedQuantity', 'remainingToShip', 'netCustomerQuantity', 'paidQuantity', 'partiallyPaidQuantity', 'unpaidQuantity']
    };
  } else if (reportType === 'finance-ledger') {
    const { getLedgerHistory } = require('../finance/financeService');
    const entryTypeTranslations = {
      'invoice_created': 'إنشاء فاتورة مبيعات',
      'invoice_updated': 'تعديل فاتورة مبيعات',
      'invoice_cancelled': 'إلغاء فاتورة مبيعات',
      'payment_recorded': 'تحصيل دفعة نقدية',
      'payment_reversed': 'إلغاء/عكس دفعة نقدية',
      'payment_supplied': 'توريد نقدية تحصيل لمقر الشركة',
      'supply_reversed': 'إلغاء توريد نقدية',
      'return_created': 'تسجيل مرتجع مبيعات',
      'manual_adjustment': 'تسوية يدوية للذمم / الكاش'
    };
    const entryGroupTranslations = {
      payments: 'دفعات فواتير وتوريدات',
      settlements: 'تسويات ومصروفات يدوية'
    };
    const supplyStatusTranslations = {
      supplied: 'مورد / نهائي',
      not_supplied: 'غير مورد'
    };
    const filtersApplied = [];

    if (query.outletId) {
      const outlet = await outletsService.findById(query.outletId);
      filtersApplied.push(`منفذ البيع: ${outlet ? outlet.name : query.outletId}`);
    }
    if (query.entryGroup) {
      filtersApplied.push(`تصنيف العملية: ${entryGroupTranslations[query.entryGroup] || query.entryGroup}`);
    }
    if (query.entryType) {
      filtersApplied.push(`نوع الحركة: ${entryTypeTranslations[query.entryType] || query.entryType}`);
    }
    if (query.supplyStatus) {
      filtersApplied.push(`حالة التوريد: ${supplyStatusTranslations[query.supplyStatus] || query.supplyStatus}`);
    }
    if (query.startDate) filtersApplied.push(`من تاريخ: ${query.startDate}`);
    if (query.endDate) filtersApplied.push(`إلى تاريخ: ${query.endDate}`);

    const rows = await getLedgerHistory({
      limit: 'all',
      outletId: query.outletId,
      entryType: query.entryType,
      entryGroup: query.entryGroup,
      supplyStatus: query.supplyStatus,
      startDate: query.startDate,
      endDate: query.endDate,
      outletIds: filterOutletIds
    });

    const formattedRows = rows.map(r => {
      let supplyStatusAr = '';
      if (r.payment_supply_status === 'supplied') supplyStatusAr = 'مورد';
      else if (r.payment_supply_status === 'not_supplied') supplyStatusAr = 'غير مورد';

      return {
        ...r,
        created_at: formatEgyptDateTime(r.created_at),
        entry_type_ar: entryTypeTranslations[r.entry_type] || r.entry_type,
        outlet_name: r.outlet_name || 'عام',
        base_amount: r.payment_amount ?? r.manual_amount ?? Math.abs(r.cash_amount || r.receivable_amount || r.custody_amount || 0),
        treasury_amount: r.cash_amount || 0,
        custody_amount: r.custody_amount || 0,
        receivable_amount: r.receivable_amount || 0,
        supply_status_ar: supplyStatusAr,
        user_full_name: r.user_full_name || '—'
      };
    });

    config = {
      title: 'سجل حركات الخزينة والحسابات (الدفتر المالي)',
      filters: filtersApplied,
      arabicHeaders: ['التاريخ والوقت', 'منفذ البيع', 'نوع الحركة', 'المبلغ الأساسي (ج.م)', 'تأثير خزينة الشركة (ج.م)', 'تأثير عهدة التحصيل (ج.م)', 'تأثير المديونيات (ج.م)', 'حالة التوريد', 'بواسطة', 'الملاحظات والبيان'],
      englishKeys: ['created_at', 'outlet_name', 'entry_type_ar', 'base_amount', 'treasury_amount', 'custody_amount', 'receivable_amount', 'supply_status_ar', 'user_full_name', 'notes'],
      rows: formattedRows,
      summaryKeys: ['base_amount', 'treasury_amount', 'custody_amount', 'receivable_amount']
    };
  } else {
    throw new Error('Unsupported report type');
  }

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export returns history.
 */
async function exportReturns(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      r.id, r.return_number, i.invoice_number, o.name as outlet_name,
      r.return_value, r.reason, r.status, r.created_at
    FROM returns r
    JOIN invoices i ON i.id = r.invoice_id
    JOIN outlets o ON o.id = r.outlet_id
    WHERE 1=1
  `;
  if (query.outletId) {
    sql += ` AND r.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.startDate) {
    sql += ` AND r.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND r.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY r.created_at DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => ({
    ...r,
    created_at: formatEgyptDateTime(r.created_at)
  }));

  const config = {
    title: 'سجل مرتجعات مبيعات الفواتير',
    filters: filtersApplied,
    arabicHeaders: ['المعرف', 'رقم إذن المرتجع', 'رقم الفاتورة', 'اسم المنفذ', 'قيمة المرتجع (ج.م)', 'السبب', 'الحالة', 'تاريخ التسجيل'],
    englishKeys: ['id', 'return_number', 'invoice_number', 'outlet_name', 'return_value', 'reason', 'status', 'created_at'],
    rows: formattedRows,
    summaryKeys: ['return_value']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export shipments log.
 */
async function exportShipments(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      s.id, s.shipment_number, i.invoice_number, o.name as outlet_name,
      s.shipping_carrier, s.tracking_number, i.shipping_cost, s.status, s.created_at
    FROM shipments s
    JOIN invoices i ON i.id = s.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    WHERE 1=1
  `;
  if (query.outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.status) {
    sql += ` AND s.status = ?`;
    params.push(query.status);
    filtersApplied.push(`الحالة: ${query.status}`);
  }
  if (query.startDate) {
    sql += ` AND s.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND s.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY s.created_at DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => ({
    ...r,
    created_at: formatEgyptDateTime(r.created_at)
  }));

  const config = {
    title: 'سجل شحنات وطرود الكتب الصادرة للمنافذ',
    filters: filtersApplied,
    arabicHeaders: ['المعرف', 'رقم الشحنة', 'رقم الفاتورة', 'اسم المنفذ', 'شركة الشحن', 'رقم التتبع', 'تكلفة الشحن (ج.م)', 'حالة الشحنة', 'تاريخ الشحن'],
    englishKeys: ['id', 'shipment_number', 'invoice_number', 'outlet_name', 'shipping_carrier', 'tracking_number', 'shipping_cost', 'status', 'created_at'],
    rows: formattedRows,
    summaryKeys: ['shipping_cost']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(config);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(config);
  } else {
    return await jsonToExcelArabic(config);
  }
}

/**
 * Export invoice items detailed catalog.
 */
async function exportInvoiceItems(query = {}, format = 'xlsx', accessOptions = {}) {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      ii.id, i.invoice_number, o.name as outlet_name, p.title as product_title, p.code as product_code,
      ii.quantity, ii.free_quantity, ii.unit_price, ii.total_price, i.created_at
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    JOIN products p ON p.id = ii.product_id
    WHERE 1=1
  `;
  sql = applyInvoiceVisibilityFilters(sql, params, accessOptions, 'i', 'ii');
  if (query.outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.productId) {
    sql += ` AND ii.product_id = ?`;
    params.push(query.productId);
    const product = await db.get('SELECT title FROM products WHERE id = ?', [query.productId]);
    filtersApplied.push(`المنتج: ${product ? product.title : query.productId}`);
  }
  if (query.startDate) {
    sql += ` AND i.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND i.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY i.created_at DESC, ii.id DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => ({
    ...r,
    created_at: formatEgyptDateTime(r.created_at),
    billable_quantity: r.quantity - (r.free_quantity || 0)
  }));

  const configObj = {
    title: 'سجل حركات بيع أصناف الفواتير التفصيلي',
    filters: filtersApplied,
    arabicHeaders: ['معرف السطر', 'رقم الفاتورة', 'اسم المنفذ', 'اسم الكتاب', 'رمز الكتاب', 'الكمية الإجمالية', 'الكمية المجانية', 'الكمية المدفوعة', 'سعر الوحدة (ج.م)', 'الإجمالي للسطر (ج.م)', 'تاريخ الفاتورة'],
    englishKeys: ['id', 'invoice_number', 'outlet_name', 'product_title', 'product_code', 'quantity', 'free_quantity', 'billable_quantity', 'unit_price', 'total_price', 'created_at'],
    rows: formattedRows,
    summaryKeys: ['quantity', 'free_quantity', 'billable_quantity', 'total_price']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(configObj);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(configObj);
  } else {
    return await jsonToExcelArabic(configObj);
  }
}

/**
 * Export shipments courier delivery sheet.
 */
async function exportCourierSheet(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      si.id as shipment_item_id, s.shipment_number, s.status as shipment_status, i.invoice_number,
      o.name as outlet_name, o.phone as outlet_phone, o.governorate, o.address_details,
      p.title as product_title, si.quantity as shipped_quantity, s.shipping_carrier, s.tracking_number,
      i.payment_status, i.notes as invoice_notes, s.created_at as shipment_date
    FROM shipment_items si
    JOIN shipments s ON s.id = si.shipment_id
    JOIN invoices i ON i.id = s.invoice_id
    JOIN outlets o ON o.id = i.outlet_id
    JOIN invoice_items ii ON ii.id = si.invoice_item_id
    JOIN products p ON p.id = ii.product_id
    WHERE 1=1
  `;
  if (query.outletId) {
    sql += ` AND i.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.status) {
    sql += ` AND s.status = ?`;
    params.push(query.status);
    filtersApplied.push(`حالة الشحنة: ${query.status}`);
  }
  if (query.governorate) {
    sql += ` AND o.governorate = ?`;
    params.push(query.governorate);
    filtersApplied.push(`المحافظة: ${query.governorate}`);
  }
  if (query.startDate) {
    sql += ` AND s.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND s.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY s.created_at DESC, s.id DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => {
    let statusAr = r.shipment_status;
    if (r.shipment_status === 'pending') statusAr = 'قيد الانتظار / التجهيز';
    else if (r.shipment_status === 'shipped') statusAr = 'تم الشحن';
    else if (r.shipment_status === 'cancelled') statusAr = 'ملغاة';

    let payStatusAr = r.payment_status;
    if (r.payment_status === 'unpaid') payStatusAr = 'آجل / غير مدفوع';
    else if (r.payment_status === 'partially_paid') payStatusAr = 'مدفوع جزئياً';
    else if (r.payment_status === 'paid') payStatusAr = 'مدفوع بالكامل';

    return {
      ...r,
      shipment_status_ar: statusAr,
      payment_status_ar: payStatusAr,
      shipment_date: formatEgyptDateTime(r.shipment_date)
    };
  });

  const configObj = {
    title: 'شيت شحن وتوصيل الطلبيات والطرود (Courier Sheet)',
    filters: filtersApplied,
    arabicHeaders: [
      'رقم الشحنة', 'حالة الشحنة', 'رقم الفاتورة', 'العميل/منفذ التوزيع', 'الهاتف', 'المحافظة',
      'العنوان بالتفصيل', 'اسم الكتاب/المنتج', 'الكمية المشحونة', 'شركة الشحن', 'رقم التتبع',
      'حالة دفع الفاتورة', 'ملاحظات الفاتورة', 'تاريخ الشحن'
    ],
    englishKeys: [
      'shipment_number', 'shipment_status_ar', 'invoice_number', 'outlet_name', 'outlet_phone', 'governorate',
      'address_details', 'product_title', 'shipped_quantity', 'shipping_carrier', 'tracking_number',
      'payment_status_ar', 'invoice_notes', 'shipment_date'
    ],
    rows: formattedRows,
    summaryKeys: ['shipped_quantity']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(configObj);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(configObj);
  } else {
    return await jsonToExcelArabic(configObj);
  }
}

/**
 * Export outlet statement ledger.
 */
async function exportOutletStatement(query = {}, format = 'xlsx') {
  const params = [];
  const filtersApplied = [];
  let sql = `
    SELECT 
      fle.id, o.name as outlet_name, fle.entry_type, fle.reference_type, fle.reference_id,
      fle.cash_amount, fle.receivable_amount, fle.notes, fle.created_at
    FROM finance_ledger_entries fle
    JOIN outlets o ON o.id = fle.outlet_id
    WHERE 1=1
  `;
  if (query.outletId) {
    sql += ` AND fle.outlet_id = ?`;
    params.push(query.outletId);
    const outlet = await db.get('SELECT name FROM outlets WHERE id = ?', [query.outletId]);
    filtersApplied.push(`المنفذ: ${outlet ? outlet.name : query.outletId}`);
  }
  if (query.startDate) {
    sql += ` AND fle.created_at >= ?`;
    params.push(query.startDate + 'T00:00:00');
    filtersApplied.push(`من تاريخ: ${query.startDate}`);
  }
  if (query.endDate) {
    sql += ` AND fle.created_at <= ?`;
    params.push(query.endDate + 'T23:59:59');
    filtersApplied.push(`إلى تاريخ: ${query.endDate}`);
  }
  sql += ` ORDER BY fle.created_at DESC, fle.id DESC`;

  const rows = await db.all(sql, params);
  const formattedRows = rows.map(r => {
    let typeAr = r.entry_type;
    if (r.entry_type === 'invoice_created') typeAr = 'إنشاء فاتورة مبيعات';
    else if (r.entry_type === 'payment_collected') typeAr = 'تحصيل دفعة نقدية';
    else if (r.entry_type === 'return_created') typeAr = 'تسجيل مرتجع مبيعات';
    else if (r.entry_type === 'payment_reversed') typeAr = 'إلغاء/عكس دفعة';
    else if (r.entry_type === 'invoice_cancelled') typeAr = 'إلغاء فاتورة مبيعات';

    return {
      ...r,
      entry_type_ar: typeAr,
      created_at: formatEgyptDateTime(r.created_at)
    };
  });

  const configObj = {
    title: 'كشف حساب الذمم والمعاملات المالية لمنفذ التوزيع',
    filters: filtersApplied,
    arabicHeaders: ['المعرف', 'اسم منفذ التوزيع', 'نوع العملية', 'نوع المستند', 'معرف المستند', 'حركة الخزينة/الكاش (ج.م)', 'حركة أرصدة الذمم (ج.م)', 'الملاحظات وبيان العملية', 'تاريخ المعاملة'],
    englishKeys: ['id', 'outlet_name', 'entry_type_ar', 'reference_type', 'reference_id', 'cash_amount', 'receivable_amount', 'notes', 'created_at'],
    rows: formattedRows,
    summaryKeys: ['cash_amount', 'receivable_amount']
  };

  if (format === 'csv') {
    return jsonToCsvArabic(configObj);
  } else if (format === 'pdf') {
    return await jsonToPdfArabic(configObj);
  } else {
    return await jsonToExcelArabic(configObj);
  }
}

module.exports = {
  exportProducts,
  exportPrices,
  exportAuthors,
  exportOutlets,
  exportInvoices,
  exportPayments,
  exportInventory,
  exportReturns,
  exportShipments,
  exportReport,
  exportInvoiceItems,
  exportCourierSheet,
  exportOutletStatement
};
