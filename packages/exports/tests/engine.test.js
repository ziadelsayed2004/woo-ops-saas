import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  generateExport,
  generateExportChunk,
  materializeRows,
  previewExport,
  sanitizeSpreadsheetValue,
} from '../dist/index.js';

const order = {
  id: 'order-1',
  orderNumber: '1001',
  currency: 'EGP',
  grandTotalMinor: '125050',
  billing: { phone: '01001234567', email: 'buyer@example.test' },
  lines: [
    { name: 'Safe product', sku: '00123', quantity: 2, totalMinor: '100000' },
    { name: '=2+2', sku: '+danger', quantity: 1, totalMinor: '25050' },
  ],
};

const profile = (format) => ({
  name: 'Shipping export',
  version: 1,
  format,
  rowMode: 'line',
  filenameTemplate: 'shipping-{date}',
  columns: [
    { key: 'orderNumber', label: 'Order', type: 'text' },
    { key: 'billing.phone', label: 'Phone', type: 'text' },
    { key: 'line.sku', label: 'SKU', type: 'text' },
    { key: 'line.name', label: 'Product', type: 'text' },
    { key: 'line.quantity', label: 'Qty', type: 'number' },
    { key: 'grandTotalMinor', label: 'Total minor', type: 'money' },
  ],
});

test('formula-like values are prefixed without changing safe text', () => {
  assert.equal(sanitizeSpreadsheetValue('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(sanitizeSpreadsheetValue('+20100000000'), "'+20100000000");
  assert.equal(sanitizeSpreadsheetValue('00123'), '00123');
  assert.equal(sanitizeSpreadsheetValue('طلب ١٢٣۴'), 'طلب 1234');
});

test('Arabic labels and values remain UTF-8 export data', async () => {
  const result = await generateExport({
    profile: {
      ...profile('csv'),
      rowMode: 'order',
      filenameTemplate: 'arabic-{format}',
      columns: [{ key: 'customerName', label: 'اسم العميل', type: 'text' }],
    },
    orders: [{ ...order, customerName: 'أحمد' }],
  });
  const csv = new TextDecoder().decode(result.bytes);
  assert.match(csv, /اسم العميل/);
  assert.match(csv, /أحمد/);
});

test('CSV export materializes line rows, preserves text, and records checksum', async () => {
  const result = await generateExport({
    profile: profile('csv'),
    orders: [order],
    snapshotId: 'selection-1',
  });
  assert.deepEqual([...result.bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  const csv = new TextDecoder().decode(result.bytes.slice(3));
  assert.equal(result.orderCount, 1);
  assert.equal(result.rowCount, 2);
  assert.equal(result.filename, 'shipping-export.csv');
  assert.match(csv, /^Order,Phone,SKU,Product,Qty,Total minor\r\n/);
  assert.match(csv, /1001,01001234567,00123,Safe product,2,125050/);
  assert.match(csv, /1001,01001234567,'\+danger,'=2\+2,1,125050/);
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
  assert.equal(result.snapshotHash.length, 64);
});

test('XLSX export has a frozen header, text formatting, and no formula cells', async () => {
  const result = await generateExport({ profile: profile('xlsx'), orders: [order] });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.bytes);
  const sheet = workbook.worksheets[0];
  assert.ok(sheet);
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell('A2').value, '1001');
  assert.equal(sheet.getCell('B2').value, '01001234567');
  assert.equal(sheet.getCell('C2').value, '00123');
  assert.equal(sheet.getCell('C2').numFmt, '@');
  assert.equal(sheet.getCell('D3').value, "'=2+2");
  assert.equal(sheet.getCell('D3').type, ExcelJS.ValueType.String);
  assert.equal(sheet.views[0]?.state, 'frozen');
});

test('Egypt governorate codes are exported as readable Arabic names', async () => {
  const result = await generateExport({
    profile: {
      ...profile('xlsx'),
      rowMode: 'order',
      columns: [{ key: 'shipping.state', label: 'المحافظة', type: 'text' }],
    },
    orders: [{ ...order, shipping: { state: 'EGSHR' } }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.bytes);
  assert.equal(workbook.worksheets[0].getCell('A2').value, 'الشرقية');
});

test('row modes and chunking are bounded and resumable', async () => {
  const orderWithPackages = { ...order, packages: [{ tracking: 'A' }, { tracking: 'B' }] };
  assert.equal(materializeRows([order], { ...profile('csv'), rowMode: 'line' }).length, 2);
  assert.equal(
    materializeRows([orderWithPackages], { ...profile('csv'), rowMode: 'package' }).length,
    2,
  );
  assert.throws(
    () => materializeRows([order], { ...profile('csv'), rowMode: 'line' }, 1),
    /EXPORT_ROW_LIMIT_EXCEEDED/,
  );
  const first = await generateExportChunk(
    { profile: profile('csv'), orders: [order, order] },
    0,
    1,
  );
  assert.equal(first.result.orderCount, 1);
  assert.equal(first.hasMore, true);
  assert.equal(first.cursor, '1');
  const second = await generateExportChunk(
    { profile: profile('csv'), orders: [order, order] },
    1,
    1,
  );
  assert.equal(second.hasMore, false);
  assert.equal(second.cursor, null);
});

test('profile defaults, transforms, required fields, and preview stay bounded', async () => {
  const configured = {
    ...profile('csv'),
    rowMode: 'order',
    config: {
      required: ['billing.phone'],
      defaults: { currency: 'EGP' },
      transforms: { orderNumber: 'trim' },
    },
  };
  const preview = previewExport(
    { profile: configured, orders: [{ ...order, orderNumber: ' 1001 ', billing: {} }] },
    1,
    10,
  );
  assert.equal(preview.orderCount, 1);
  assert.equal(preview.rowCount, 1);
  assert.equal(preview.errors.length, 1);
  assert.equal(preview.errors[0].key, 'billing.phone');
  assert.equal(preview.rows[0][0], '1001');
  assert.equal(preview.rows[0][1], '');
  await assert.rejects(
    () => generateExport({ profile: configured, orders: [{ ...order, billing: {} }] }),
    /EXPORT_REQUIRED_FIELD_MISSING/,
  );
  assert.throws(
    () => previewExport({ profile: configured, orders: [order] }, 1, 0),
    /EXPORT_PREVIEW_LIMIT_INVALID/,
  );
});
