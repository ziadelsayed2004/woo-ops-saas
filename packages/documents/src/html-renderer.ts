import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { documentStyles } from './document-styles.js';
import { PDFDocument } from 'pdf-lib';

import type { DocumentRequest } from './index.js';

const require = createRequire(import.meta.url);
const embeddedFonts = [400, 700]
  .flatMap((weight) =>
    ['arabic', 'latin'].map((subset) => {
      const bytes = readFileSync(
        require.resolve(
          `@fontsource/noto-sans-arabic/files/noto-sans-arabic-${subset}-${weight}-normal.woff2`,
        ),
      );
      return `@font-face{font-family:Invoice;src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');font-weight:${weight};font-display:block;unicode-range:${subset === 'arabic' ? 'U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF' : 'U+0000-00FF,U+2000-206F'};}`;
    }),
  )
  .join('\n');
const MM_TO_POINTS = 72 / 25.4;
const SUPPORT_PHONE = '01055127111';
const SUPPORT_EMAIL = 'info@wasatalbalad.store';
const STORE_URL = 'https://wasatalbalad.store/';
const COLOR_LOGO = new Uint8Array(
  readFileSync(new URL('../assets/wasat-al-balad-horizontal.svg', import.meta.url)),
);
const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const nested = (source: unknown, path: string): unknown => {
  let current = source;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
};

const text = (source: unknown, ...paths: string[]): string => {
  for (const path of paths) {
    const value = nested(source, path);
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return '';
};

const money = (minor: string, currency: string, locale: string): string => {
  if (!/^-?\d+$/u.test(minor)) return `${minor} ${currency}`.trim();
  const value = BigInt(minor);
  const absolute = value < 0n ? -value : value;
  const whole = new Intl.NumberFormat(locale, { numberingSystem: 'latn' }).format(absolute / 100n);
  return `${value < 0n ? '-' : ''}${whole}.${String(absolute % 100n).padStart(2, '0')} ${currency || 'EGP'}`;
};

const dataUrl = (mime: string, bytes: Uint8Array): string =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

type RenderAssets = Readonly<{ barcode?: Uint8Array; qr?: Uint8Array }>;

const translations = (arabic: boolean) =>
  arabic
    ? {
        invoice: 'فاتورة طلب',
        receipt: 'إيصال طلب',
        label: 'بوليصة شحن',
        order: 'رقم الطلب',
        date: 'التاريخ',
        customer: 'العميل',
        phone: 'الهاتف',
        email: 'البريد الإلكتروني',
        address: 'عنوان الشحن',
        governorate: 'المحافظة',
        payment: 'طريقة الدفع',
        shipping: 'طريقة الشحن',
        items: 'تفاصيل الطلب',
        item: 'المنتج',
        qty: 'الكمية',
        unit: 'سعر الوحدة',
        total: 'الإجمالي',
        subtotal: 'إجمالي المنتجات',
        discount: 'الخصم',
        shippingFee: 'الشحن',
        tax: 'الضريبة',
        fees: 'الرسوم',
        grandTotal: 'الإجمالي المستحق',
        thankYou: 'شكرًا لتعاملكم معنا',
      }
    : {
        invoice: 'ORDER INVOICE',
        receipt: 'ORDER RECEIPT',
        label: 'SHIPPING LABEL',
        order: 'Order number',
        date: 'Date',
        customer: 'Customer',
        phone: 'Phone',
        email: 'Email',
        address: 'Shipping address',
        governorate: 'Governorate',
        payment: 'Payment method',
        shipping: 'Shipping method',
        items: 'Order items',
        item: 'Item',
        qty: 'Qty',
        unit: 'Unit price',
        total: 'Total',
        subtotal: 'Items subtotal',
        discount: 'Discount',
        shippingFee: 'Shipping',
        tax: 'Tax',
        fees: 'Fees',
        grandTotal: 'Amount due',
        thankYou: 'Thank you for your order',
      };

const address = (order: Readonly<Record<string, unknown>>): string =>
  [
    text(order, 'shipping.address_1', 'billing.address_1'),
    text(order, 'shipping.address_2', 'billing.address_2'),
    text(order, 'shipping.city', 'billing.city'),
    text(order, 'shipping.postcode', 'billing.postcode'),
  ]
    .filter(Boolean)
    .join('، ');

const htmlDocument = (request: DocumentRequest, assets: RenderAssets): string => {
  const order = request.order;
  const arabic = request.template.direction === 'rtl';
  const locale = request.template.locale ?? (arabic ? 'ar-EG' : 'en-US');
  const t = translations(arabic);
  const currency = text(order, 'currency') || 'EGP';
  const orderNumber = request.documentNumber ?? text(order, 'orderNumber', 'number', 'id');
  const customer =
    [text(order, 'billing.first_name'), text(order, 'billing.last_name')]
      .filter(Boolean)
      .join(' ') || text(order, 'customer.name', 'billing.name');
  const created = text(order, 'createdAt', 'remoteCreatedAt');
  const createdLabel =
    created && !Number.isNaN(Date.parse(created))
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', numberingSystem: 'latn' }).format(
          new Date(created),
        )
      : created;
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const lineRows = lines
    .map((raw, index) => {
      const line = isRecord(raw) ? raw : {};
      const quantity = text(line, 'quantity') || '1';
      const totalMinor = text(line, 'totalMinor', 'total') || '0';
      const unitMinor =
        text(line, 'unitPriceMinor') ||
        (/^\d+$/u.test(totalMinor) && /^\d+$/u.test(quantity) && Number(quantity) > 0
          ? String(BigInt(totalMinor) / BigInt(quantity))
          : totalMinor);
      return `<tr><td class="index">${index + 1}</td><td class="product"><strong>${escapeHtml(text(line, 'name', 'title'))}</strong></td><td>${escapeHtml(quantity)}</td><td>${escapeHtml(money(unitMinor, currency, locale))}</td><td>${escapeHtml(money(totalMinor, currency, locale))}</td></tr>`;
    })
    .join('');
  const facts = [
    [t.customer, customer],
    [t.phone, text(order, 'billing.phone', 'customer.phone')],
    [t.email, text(order, 'billing.email', 'customer.email')],
    [t.address, address(order)],
    [
      t.governorate,
      text(
        order,
        'shipping.governorateNameAr',
        'shipping.governorateNameEn',
        'shipping.state',
        'billing.state',
      ),
    ],
    [t.payment, text(order, 'paymentMethodTitle', 'payment.title')],
    [t.shipping, text(order, 'shippingMethodTitle', 'shippingMethod.title')],
  ].filter(([, value]) => value);
  const factCards = facts
    .map(
      ([label, value]) =>
        `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join('');
  const totals = [
    [t.subtotal, text(order, 'amounts.merchandiseNetMinor', 'subtotalMinor')],
    [t.discount, text(order, 'amounts.discountMinor')],
    [t.shippingFee, text(order, 'amounts.shippingCollectedMinor')],
    [t.tax, text(order, 'amounts.taxMinor')],
    [t.fees, text(order, 'amounts.feesMinor')],
    [t.grandTotal, text(order, 'grandTotalMinor', 'amounts.collectedMinor', 'total')],
  ].filter(([, value], index) => value && (index === 5 || value !== '0'));
  const totalRows = totals
    .map(
      ([label, value], index) =>
        `<div class="total-row ${index === totals.length - 1 ? 'grand' : ''}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(money(value ?? '0', currency, locale))}</strong></div>`,
    )
    .join('');
  const title =
    request.format === 'thermal-80mm'
      ? t.receipt
      : request.format === 'label-100x150mm'
        ? t.label
        : t.invoice;
  const compact = request.format === 'thermal-80mm' || request.format === 'label-100x150mm';
  const logo = dataUrl('image/svg+xml', COLOR_LOGO);
  const formatClass = request.format.replaceAll('-', '_');
  return `<!doctype html><html lang="${arabic ? 'ar' : 'en'}" dir="${arabic ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
${embeddedFonts}\n${documentStyles}\n${compact ? '@page{margin:0}' : ''}\n</style></head><body class="${formatClass} ${compact ? 'roll' : ''}"><main class="page"><header class="brand"><div class="brand-identity"><div class="logo-window"><img class="brand-logo" src="${logo}" alt="${escapeHtml(request.template.companyName)}"></div>${request.template.companyAddress ? `<p>${escapeHtml(request.template.companyAddress)}</p>` : ''}</div><div class="doc-title"><h2>${escapeHtml(title)}</h2><span class="pill">#${escapeHtml(orderNumber)}</span>${createdLabel ? `<p>${escapeHtml(createdLabel)}</p>` : ''}</div></header><section class="facts">${factCards}</section><section><h3 class="section-title">${escapeHtml(t.items)}</h3><table class="items"><thead><tr><th>#</th><th>${escapeHtml(t.item)}</th><th>${escapeHtml(t.qty)}</th><th>${escapeHtml(t.unit)}</th><th>${escapeHtml(t.total)}</th></tr></thead><tbody>${lineRows}</tbody></table></section><section class="summary">${totalRows}</section><section class="codes"><div>${assets.barcode ? `<img class="barcode" src="${dataUrl('image/png', assets.barcode)}"><div class="code-caption">#${escapeHtml(orderNumber)}</div>` : ''}</div>${assets.qr ? `<div><img class="qr" src="${dataUrl('image/png', assets.qr)}"><div class="code-caption">${STORE_URL}</div></div>` : ''}</section><section class="support"><span>${escapeHtml(SUPPORT_PHONE)}</span><span>${escapeHtml(SUPPORT_EMAIL)}</span></section>${request.template.body ? `<div class="footer">${escapeHtml(request.template.body)}</div>` : ''}<footer class="footer">${escapeHtml(request.template.footerText || t.thankYou)}</footer></main></body></html>`;
};

export const renderHtmlPdf = async (
  request: DocumentRequest,
  assets: RenderAssets,
): Promise<{ bytes: Uint8Array; pageCount: number; widthPoints: number; heightPoints: number }> => {
  if (process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST === '1')
    throw new Error('Playwright browser executable unavailable');
  // Keep the browser inside the deployed dependency tree so Hostinger release directories do not
  // depend on a user-level Playwright cache that may disappear between build and runtime.
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
  const { chromium } = await import('playwright-chromium');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(htmlDocument(request, assets), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    const widthMm =
      request.format === 'label-100x150mm'
        ? 80
        : request.format === 'thermal-80mm'
          ? 80
          : request.format === 'a5'
            ? 148
            : 210;
    let heightMm = request.format === 'a5' ? 210 : 297;
    if (request.format === 'thermal-80mm' || request.format === 'label-100x150mm') {
      const contentPx = await page
        .locator('.page')
        .evaluate((element) => Math.ceil(element.scrollHeight));
      heightMm = request.thermalHeightMm ?? Math.max(50, Math.ceil((contentPx * 25.4) / 96) + 2);
    }
    if (heightMm > 2000) throw new Error('DOCUMENT_CONTENT_TOO_LONG');
    const raw = await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm}mm`,
      printBackground: true,

      preferCSSPageSize: false,
      displayHeaderFooter: false,
    });
    const pdf = await PDFDocument.load(new Uint8Array(raw), { updateMetadata: false });
    const exactWidth = widthMm * MM_TO_POINTS;
    const exactHeight = heightMm * MM_TO_POINTS;
    for (const pdfPage of pdf.getPages()) pdfPage.setSize(exactWidth, exactHeight);
    pdf.setTitle(request.template.name);
    pdf.setAuthor(request.template.companyName);
    pdf.setSubject(`Woo Ops ${request.format}`);
    pdf.setProducer('Woo Ops HTML PDF renderer');
    pdf.setCreator('Woo Ops HTML layouts v3');
    pdf.setCreationDate(new Date(0));
    pdf.setModificationDate(new Date(0));
    const bytes = await pdf.save({ useObjectStreams: false, addDefaultPage: false });
    return {
      bytes,
      pageCount: pdf.getPageCount(),
      widthPoints: exactWidth,
      heightPoints: exactHeight,
    };
  } finally {
    await browser.close();
  }
};
