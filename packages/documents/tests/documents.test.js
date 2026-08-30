import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import test from 'node:test';
import {
  documentPageSize,
  generateDocument,
  generateDocumentBatch,
  renderSafeTemplate,
  validateSafeTemplate,
} from '../dist/index.js';

const fontPath = [
  'C:\\Windows\\Fonts\\arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
].find(existsSync);
const fontBytes = fontPath ? new Uint8Array(readFileSync(fontPath)) : undefined;
const order = {
  id: 'order-100',
  orderNumber: '100',
  grandTotalMinor: '125050',
  billing: { name: 'عميل تجريبي', phone: '01001234567' },
  shipping: { address_1: 'شارع الاختبار، القاهرة' },
  lines: [{ name: 'منتج تجريبي', quantity: 2, totalMinor: '125050' }],
};
const template = {
  id: 'invoice-default',
  version: 2,
  name: 'فاتورة افتراضية',
  companyName: 'شركة Woo Ops',
  companyAddress: 'القاهرة',
  footerText: 'شكراً لتعاملكم معنا',
  locale: 'ar-EG',
  direction: 'rtl',
  ...(fontBytes ? { fontBytes } : {}),
};

test('document page presets use exact physical dimensions', () => {
  const mm = 72 / 25.4;
  assert.deepEqual(documentPageSize('a4'), [210 * mm, 297 * mm]);
  assert.deepEqual(documentPageSize('a5'), [148 * mm, 210 * mm]);
  assert.deepEqual(documentPageSize('thermal-80mm'), [80 * mm, 150 * mm]);
  assert.deepEqual(documentPageSize('label-100x150mm'), [100 * mm, 150 * mm]);
  assert.throws(() => documentPageSize('thermal-80mm', 20), /DOCUMENT_THERMAL_HEIGHT_INVALID/);
});

test('safe templates allowlisted tokens only and never evaluate markup or URLs', () => {
  const input = {
    id: 'order-100',
    orderNumber: '100',
    currency: 'EGP',
    grandTotalMinor: '125050',
    billing: { first_name: 'Template Customer', phone: '0100' },
  };
  const analysis = validateSafeTemplate('Order {{order.number}} — {{customer.name}}');
  assert.deepEqual(analysis.tokens, ['order.number', 'customer.name']);
  assert.equal(renderSafeTemplate(analysis.source, input), 'Order 100 — Template Customer');
  assert.throws(
    () => validateSafeTemplate('{{order.password}}'),
    /DOCUMENT_TEMPLATE_TOKEN_INVALID/,
  );
  assert.throws(
    () => validateSafeTemplate('<img src="https://evil.test">'),
    /DOCUMENT_TEMPLATE_UNSAFE/,
  );
  assert.throws(() => validateSafeTemplate('{{order.number}'), /DOCUMENT_TEMPLATE_TOKEN_INVALID/);
});

test('Arabic A4 document embeds a font, QR/barcode assets, and is reproducible', async (t) => {
  if (!fontBytes) {
    t.skip('No Arabic-capable system font is available in this test environment');
    return;
  }
  const request = {
    order,
    format: 'a4',
    template,
    orderId: 'order-100',
    qrValue: 'https://example.test/o/100',
  };
  const first = await generateDocument(request);
  const second = await generateDocument(request);
  assert.equal(first.pageCount, 1);
  assert.equal(first.widthPoints, 210 * (72 / 25.4));
  assert.equal(first.heightPoints, 297 * (72 / 25.4));
  assert.equal(first.checksum, second.checksum);
  assert.deepEqual(first.snapshot, second.snapshot);
  const pdf = await PDFDocument.load(first.bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.match(new TextDecoder().decode(first.bytes), /\/Type \/Font/);
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
});

test('thermal and label PDFs retain physical page boxes', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  for (const format of ['thermal-80mm', 'label-100x150mm']) {
    const result = await generateDocument({ order, format, template, orderId: `order-${format}` });
    const pdf = await PDFDocument.load(result.bytes);
    const page = pdf.getPage(0);
    const [expectedWidth, expectedHeight] = documentPageSize(format);
    assert.ok(Math.abs(page.getWidth() - expectedWidth) < 0.01);
    assert.ok(Math.abs(page.getHeight() - expectedHeight) < 0.01);
    assert.equal(result.pageCount, 1);
  }
});

test('batch generation isolates invalid documents and merges successful pages', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  const result = await generateDocumentBatch([
    { order, format: 'a5', template, orderId: 'valid-1' },
    { order: null, format: 'a5', template, orderId: 'invalid-1' },
    { order, format: 'a5', template, orderId: 'valid-2' },
  ]);
  assert.equal(result.documents.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].orderId, 'invalid-1');
  const merged = await PDFDocument.load(result.mergedPdf);
  assert.equal(merged.getPageCount(), 2);
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
});
