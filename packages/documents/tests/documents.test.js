import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import test from 'node:test';
import { htmlDocument } from '../dist/html-renderer.js';
import {
  documentPageSize,
  createZipArchive,
  generateDocument,
  generateDocumentBatch,
  mergeDocumentPdfs,
  renderSafeTemplate,
  validateSafeTemplate,
} from '../dist/index.js';
import {
  documentBrowserCacheDirectory,
  documentBrowserLaunchOptions,
  documentBrowserProvider,
  preparePortableBrowserEnvironment,
} from '../runtime/browser.mjs';

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

const applicationTempDirectory = (name) => mkdtemp(resolve(`.woo-ops-${name}-`));

test('document browser provider is portable on Linux and managed elsewhere', () => {
  assert.equal(documentBrowserProvider('linux'), 'portable-linux');
  assert.equal(documentBrowserProvider('win32'), 'playwright');
  assert.equal(documentBrowserProvider('darwin'), 'playwright');
});

test('portable browser cache avoids the system temp mount and enforces a private directory', async () => {
  const root = await applicationTempDirectory('browser-cache');
  const env = {};
  try {
    const expected = join(root, '.cache', 'woo-ops-browser');
    assert.equal(documentBrowserCacheDirectory({ cwd: root, env }), expected);
    assert.equal(await preparePortableBrowserEnvironment({ cwd: root, env }), expected);
    assert.equal(env.TMPDIR, expected);
    assert.equal(env.TMP, expected);
    assert.equal(env.TEMP, expected);
    assert.ok(existsSync(expected));
    if (process.platform !== 'win32') assert.equal(statSync(expected).mode & 0o777, 0o700);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('portable Linux launch extracts and executes only from the application cache', async () => {
  const root = await applicationTempDirectory('browser-launch');
  const originalTempEnvironment = {
    TMPDIR: process.env.TMPDIR,
    TMP: process.env.TMP,
    TEMP: process.env.TEMP,
  };
  const env = process.env;
  const expectedCache = join(root, '.cache', 'woo-ops-browser');
  const expectedExecutable = join(expectedCache, 'chromium');
  try {
    // Postinstall reports/prepares the cache, then the shared launcher prepares
    // it again. This exact sequence previously treated the cache as system temp.
    assert.equal(await preparePortableBrowserEnvironment({ cwd: root, env }), expectedCache);
    const options = await documentBrowserLaunchOptions({
      platform: 'linux',
      cwd: root,
      env,
      loadPortableChromium: async () => {
        assert.equal(env.TMPDIR, expectedCache);
        await writeFile(expectedExecutable, '#!/bin/sh\n', { mode: 0o600 });
        return {
          default: {
            args: ['--no-sandbox'],
            executablePath: async () => expectedExecutable,
          },
        };
      },
    });
    assert.equal(options.executablePath, expectedExecutable);
    assert.notEqual(options.executablePath, '/tmp/chromium');
    if (process.platform !== 'win32')
      assert.equal(statSync(expectedExecutable).mode & 0o777, 0o700);
  } finally {
    for (const [key, value] of Object.entries(originalTempEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { force: true, recursive: true });
  }
});

test('portable Linux launch rejects an executable outside its private cache', async () => {
  const root = await applicationTempDirectory('browser-escape');
  try {
    await assert.rejects(
      documentBrowserLaunchOptions({
        platform: 'linux',
        cwd: root,
        env: {},
        loadPortableChromium: async () => ({
          default: { args: [], executablePath: async () => join(root, 'outside-chromium') },
        }),
      }),
      /DOCUMENT_BROWSER_EXECUTABLE_OUTSIDE_CACHE/,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('portable browser cache requires an absolute configured path', () => {
  assert.throws(
    () => documentBrowserCacheDirectory({ env: { WOO_OPS_BROWSER_CACHE_DIR: '../shared' } }),
    /WOO_OPS_BROWSER_CACHE_DIR_MUST_BE_ABSOLUTE/,
  );
  assert.throws(
    () =>
      documentBrowserCacheDirectory({
        cwd: resolve('application'),
        env: { WOO_OPS_BROWSER_CACHE_DIR: join(tmpdir(), 'woo-ops-browser') },
      }),
    /WOO_OPS_BROWSER_CACHE_DIR_UNSAFE/,
  );
});

test('brand HTML isolates identifiers and uses a dedicated shipping contents table', () => {
  const html = htmlDocument(
    {
      order: { ...order, billing: { name: '<script>bad</script>', phone: '+201001234567' } },
      format: 'a4',
      template,
    },
    {},
  );
  assert.match(html, /dir="rtl"/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html, /<bdi dir="ltr">\+201001234567<\/bdi>/);
  assert.match(html, /#1e4899/);
  assert.match(html, /#f8af28/);
  assert.match(html, /data:image\/svg\+xml;base64/);
  const shipping = htmlDocument({ order, format: 'label-100x150mm', template }, {});
  assert.match(shipping, /بيانات المستلم/);
  assert.match(shipping, /class="roll shipping-label"/);
  assert.doesNotMatch(shipping, /<th class="amount">/);
});

test('document page presets use exact physical dimensions', () => {
  const mm = 72 / 25.4;
  assert.deepEqual(documentPageSize('a4'), [210 * mm, 297 * mm]);
  assert.deepEqual(documentPageSize('a5'), [148 * mm, 210 * mm]);
  assert.deepEqual(documentPageSize('thermal-80mm'), [80 * mm, 150 * mm]);
  assert.deepEqual(documentPageSize('label-100x150mm'), [80 * mm, 150 * mm]);
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
  assert.equal(pdf.getSubject(), 'Woo Ops a4');
  assert.equal(pdf.getAuthor(), template.companyName);
  assert.equal(
    pdf.context
      .enumerateIndirectObjects()
      .some(
        ([, object]) =>
          object instanceof PDFDict && object.get(PDFName.of('Type')) === PDFName.of('Font'),
      ),
    true,
  );
  const uncompressed = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
  assert.ok(
    first.bytes.length < uncompressed.length,
    `compressed=${first.bytes.length} uncompressed=${uncompressed.length}`,
  );
  assert.match(first.checksum, /^[a-f0-9]{64}$/);
});

test('document identity kind is allowlisted and included in deterministic snapshots', async () => {
  const simpleTemplate = {
    id: 'identity-template',
    version: 1,
    name: 'Identity template',
    companyName: 'Woo Ops',
    locale: 'en-US',
    direction: 'ltr',
  };
  const orderDocument = await generateDocument({
    order: { id: 'identity-1', orderNumber: 'ID-1', grandTotalMinor: '100' },
    format: 'a5',
    template: simpleTemplate,
    orderId: 'identity-1',
    documentNumber: 'ORD-1',
  });
  const invoiceDocument = await generateDocument({
    order: { id: 'identity-1', orderNumber: 'ID-1', grandTotalMinor: '100' },
    format: 'a5',
    template: simpleTemplate,
    orderId: 'identity-1',
    documentNumber: 'INV-1',
    documentKind: 'invoice',
  });
  assert.notEqual(orderDocument.snapshot.sourceHash, invoiceDocument.snapshot.sourceHash);
  await assert.rejects(
    () =>
      generateDocument({
        order: { id: 'identity-1', orderNumber: 'ID-1', grandTotalMinor: '100' },
        format: 'a5',
        template: simpleTemplate,
        documentKind: 'credit-note',
      }),
    /DOCUMENT_KIND_INVALID/,
  );
});

test('thermal receipts and shipping labels use an exact 80mm width with content height', async (t) => {
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
    if (format === 'thermal-80mm' || format === 'label-100x150mm') {
      assert.ok(page.getHeight() >= 50 * (72 / 25.4));
      assert.ok(page.getHeight() <= 500 * (72 / 25.4));
      assert.equal(page.getHeight(), result.heightPoints);
    } else assert.ok(Math.abs(page.getHeight() - expectedHeight) < 0.01);
    assert.equal(result.pageCount, 1);
  }
});

test('thermal accepts an explicit physical height for fixed printer media', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  const result = await generateDocument({
    order,
    format: 'thermal-80mm',
    template,
    orderId: 'thermal-fixed',
    thermalHeightMm: 180,
  });
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 80 * (72 / 25.4)) < 0.01);
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - 180 * (72 / 25.4)) < 0.01);
});

test('legacy portable setting cannot bypass the branded HTML renderer', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  const previous = process.env.WOO_OPS_DOCUMENT_RENDERER;
  process.env.WOO_OPS_DOCUMENT_RENDERER = 'portable';
  try {
    for (const format of ['a4', 'thermal-80mm', 'label-100x150mm']) {
      const result = await generateDocument({
        order,
        format,
        template,
        orderId: `portable-${format}`,
        barcodeValue: '100',
        qrValue: 'https://wasatalbalad.store/',
      });
      const pdf = await PDFDocument.load(result.bytes);
      assert.equal(pdf.getCreator(), 'Woo Ops HTML layouts v4');
      assert.equal(pdf.getPageCount(), 1);
      assert.ok(result.bytes.length > 1_000);
      assert.equal(pdf.getPage(0).getWidth(), result.widthPoints);
      assert.equal(pdf.getPage(0).getHeight(), result.heightPoints);
      if (format === 'a4') {
        assert.ok(Math.abs(result.widthPoints - 210 * (72 / 25.4)) < 0.01);
        assert.ok(Math.abs(result.heightPoints - 297 * (72 / 25.4)) < 0.01);
      } else {
        assert.ok(Math.abs(result.widthPoints - 80 * (72 / 25.4)) < 0.01);
        assert.ok(result.heightPoints >= 100 * (72 / 25.4));
        assert.ok(result.heightPoints <= 500 * (72 / 25.4));
      }
    }
  } finally {
    if (previous === undefined) delete process.env.WOO_OPS_DOCUMENT_RENDERER;
    else process.env.WOO_OPS_DOCUMENT_RENDERER = previous;
  }
});

test('missing HTML browser fails explicitly instead of returning the old layout', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  const previousRenderer = process.env.WOO_OPS_DOCUMENT_RENDERER;
  const previousUnavailable = process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST;
  delete process.env.WOO_OPS_DOCUMENT_RENDERER;
  process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST = '1';
  try {
    await assert.rejects(
      generateDocument({
        order,
        format: 'thermal-80mm',
        template,
        orderId: 'automatic-fallback',
      }),
      /browser executable unavailable/,
    );
  } finally {
    if (previousRenderer === undefined) delete process.env.WOO_OPS_DOCUMENT_RENDERER;
    else process.env.WOO_OPS_DOCUMENT_RENDERER = previousRenderer;
    if (previousUnavailable === undefined)
      delete process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST;
    else process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST = previousUnavailable;
  }
});

test('long orders paginate A4 and expand roll height without dropping lines', async () => {
  const longOrder = {
    ...order,
    lines: Array.from({ length: 70 }, (_, i) => ({
      name: `منتج طويل للمراجعة النهائية للصف الثالث الثانوي ${i + 1}`,
      quantity: 1,
      totalMinor: '1250',
    })),
  };
  const a4 = await generateDocument({ order: longOrder, format: 'a4', template });
  assert.ok(a4.pageCount > 1);
  const roll = await generateDocument({ order: longOrder, format: 'thermal-80mm', template });
  assert.equal(roll.pageCount, 1);
  assert.ok(roll.heightPoints > 500 * (72 / 25.4));
});

test('batch generation isolates invalid documents and merges successful pages', async (t) => {
  if (!fontBytes) {
    t.skip('No font is available in this test environment');
    return;
  }
  const result = await generateDocumentBatch([
    { order, format: 'a4', template, orderId: 'valid-1' },
    { order: null, format: 'a4', template, orderId: 'invalid-1' },
    { order, format: 'a4', template, orderId: 'valid-2' },
  ]);
  assert.equal(result.documents.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].orderId, 'invalid-1');
  const merged = await PDFDocument.load(result.mergedPdf);
  assert.equal(merged.getPageCount(), 2);
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
});

test('batch generation reuses one bounded renderer session and compressed PDFs', async () => {
  const source = await PDFDocument.create();
  source.addPage([100, 100]);
  const sourceBytes = await source.save({ useObjectStreams: true });
  let sessions = 0;
  let renders = 0;
  let closes = 0;
  const result = await generateDocumentBatch(
    [
      { order, format: 'a4', template, orderId: 'bounded-1' },
      { order, format: 'a4', template, orderId: 'bounded-2' },
      { order, format: 'a4', template, orderId: 'bounded-3' },
    ],
    async () => {
      sessions += 1;
      return {
        render: async () => {
          renders += 1;
          return {
            bytes: sourceBytes,
            pageCount: 1,
            widthPoints: 100,
            heightPoints: 100,
          };
        },
        close: async () => {
          closes += 1;
        },
      };
    },
  );
  assert.equal(sessions, 1);
  assert.equal(renders, 3);
  assert.equal(closes, 1);
  assert.equal(result.documents.length, 3);
  assert.equal(Buffer.from(result.mergedPdf).includes(Buffer.from('/ObjStm')), true);
});

test('merged PDFs and private ZIP bundles are deterministic and path safe', async () => {
  const simpleTemplate = {
    id: 'zip-template',
    version: 1,
    name: 'Zip template',
    companyName: 'Woo Ops',
    locale: 'en-US',
    direction: 'ltr',
  };
  const first = await generateDocument({
    order: { id: 'zip-1', orderNumber: 'ZIP-1', grandTotalMinor: '100' },
    format: 'a5',
    template: simpleTemplate,
    orderId: 'zip-1',
  });
  const second = await generateDocument({
    order: { id: 'zip-2', orderNumber: 'ZIP-2', grandTotalMinor: '200' },
    format: 'a5',
    template: simpleTemplate,
    orderId: 'zip-2',
  });
  const merged = await mergeDocumentPdfs([first.bytes, second.bytes]);
  const mergedPdf = await PDFDocument.load(merged);
  assert.equal(mergedPdf.getPageCount(), 2);
  const entries = [
    { name: 'manifest.json', bytes: new TextEncoder().encode('{"version":1}\n') },
    { name: 'order-1.pdf', bytes: first.bytes },
    { name: 'order-2.pdf', bytes: second.bytes },
  ];
  const zip = createZipArchive(entries);
  assert.equal(zip[0], 0x50);
  assert.equal(zip[1], 0x4b);
  assert.deepEqual(zip, createZipArchive(entries));
  assert.throws(
    () => createZipArchive([{ name: '../outside.pdf', bytes: first.bytes }]),
    /DOCUMENT_ZIP_ENTRY_INVALID/,
  );
  assert.throws(
    () =>
      createZipArchive([
        { name: 'order.pdf', bytes: first.bytes },
        { name: 'order.pdf', bytes: second.bytes },
      ]),
    /DOCUMENT_ZIP_ENTRY_INVALID/,
  );
});
