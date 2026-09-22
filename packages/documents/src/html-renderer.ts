import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { documentStyles } from './document-styles.js';
import { PDFDocument } from 'pdf-lib';
import { launchDocumentBrowser } from '../runtime/browser.mjs';
import type { Browser, Page } from 'playwright-chromium';

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

export type RenderAssets = Readonly<{ barcode?: Uint8Array; qr?: Uint8Array }>;
export type HtmlPdfResult = Readonly<{
  bytes: Uint8Array;
  pageCount: number;
  widthPoints: number;
  heightPoints: number;
}>;
export type HtmlPdfRenderSession = Readonly<{
  render: (request: DocumentRequest, assets: RenderAssets) => Promise<HtmlPdfResult>;
  close: () => Promise<void>;
}>;

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

export const htmlDocument = (request: DocumentRequest, assets: RenderAssets): string => {
  const order = request.order;
  const arabic = request.template.direction === 'rtl';
  const locale = request.template.locale ?? (arabic ? 'ar-EG' : 'en-US');
  const t = translations(arabic);
  const currency = text(order, 'currency') || 'EGP';
  const compact = request.format === 'thermal-80mm' || request.format === 'label-100x150mm';
  const thermalReceipt = request.format === 'thermal-80mm';
  const shippingLabel = request.format === 'label-100x150mm';
  const orderNumber = request.documentNumber ?? text(order, 'orderNumber', 'number', 'id');
  const customer =
    [text(order, 'billing.first_name'), text(order, 'billing.last_name')]
      .filter(Boolean)
      .join(' ') || text(order, 'customer.name', 'billing.name');
  const recipient =
    [text(order, 'shipping.first_name'), text(order, 'shipping.last_name')]
      .filter(Boolean)
      .join(' ') || customer;
  const created = text(order, 'remoteCreatedAt', 'createdAt');
  const createdLabel =
    created && !Number.isNaN(Date.parse(created))
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          numberingSystem: 'latn',
          timeZone: 'Africa/Cairo',
        }).format(new Date(created))
      : created;
  const governorate = text(
    order,
    arabic ? 'shipping.governorateNameAr' : 'shipping.governorateNameEn',
    'shipping.state',
    'billing.state',
  );
  const phone = text(order, 'shipping.phone', 'billing.phone', 'customer.phone');
  const email = text(order, 'billing.email', 'customer.email');
  const payment = text(order, 'paymentMethodTitle', 'payment.title');
  const shipping = text(order, 'shippingMethodTitle', 'shippingMethod.title');
  const field = (label: string, value: string, direction = 'auto') =>
    value
      ? `<div class="detail"><dt>${escapeHtml(label)}</dt><dd><bdi dir="${direction}">${escapeHtml(value)}</bdi></dd></div>`
      : '';
  const title = shippingLabel ? t.label : compact ? t.receipt : t.invoice;
  const lines = Array.isArray(order.lines) ? order.lines : [];
  const rows = lines
    .map((raw, index) => {
      const line = isRecord(raw) ? raw : {};
      const quantity = text(line, 'quantity') || '1';
      const total = text(line, 'totalMinor', 'total') || '0';
      const unit =
        text(line, 'unitPriceMinor') ||
        (/^\d+$/u.test(total) && /^\d+$/u.test(quantity) && BigInt(quantity) > 0n
          ? String(BigInt(total) / BigInt(quantity))
          : total);
      return `<tr><td class="index">${index + 1}</td><td class="product"><bdi>${escapeHtml(text(line, 'name', 'title'))}</bdi></td><td class="quantity"><bdi dir="ltr">${escapeHtml(quantity)}</bdi></td>${compact ? '' : `<td class="amount"><bdi dir="ltr">${escapeHtml(money(unit, currency, locale))}</bdi></td>`}${shippingLabel ? '' : `<td class="amount"><bdi dir="ltr">${escapeHtml(money(total, currency, locale))}</bdi></td>`}</tr>`;
    })
    .join('');
  const totals = [
    [t.subtotal, text(order, 'amounts.merchandiseNetMinor', 'subtotalMinor')],
    [t.discount, text(order, 'amounts.discountMinor')],
    [t.shippingFee, text(order, 'amounts.shippingCollectedMinor')],
    [t.tax, text(order, 'amounts.taxMinor')],
    [t.fees, text(order, 'amounts.feesMinor')],
  ].filter(([, value]) => value && value !== '0');
  const totalRows = totals
    .map(
      ([label, value]) =>
        `<div class="total-row"><span>${escapeHtml(label)}</span><bdi dir="ltr">${escapeHtml(money(value ?? '0', currency, locale))}</bdi></div>`,
    )
    .join('');
  const total = money(
    text(order, 'grandTotalMinor', 'amounts.collectedMinor', 'total') || '0',
    currency,
    locale,
  );
  const logo = dataUrl('image/svg+xml', COLOR_LOGO);
  const customerTitle = shippingLabel
    ? arabic
      ? 'بيانات المستلم'
      : 'Recipient'
    : arabic
      ? 'بيانات العميل'
      : 'Customer details';
  const addressTitle = arabic ? 'التوصيل والدفع' : 'Delivery & payment';
  const notes = text(order, 'customerNote', 'notesSummary');
  const customerInfo = `<section class="info-card"><h3>${customerTitle}</h3><p class="customer-name"><bdi>${escapeHtml(shippingLabel ? recipient : customer)}</bdi></p><dl>${field(t.phone, phone, 'ltr')}${!shippingLabel ? field(t.email, email, 'ltr') : ''}</dl></section>`;
  const deliveryInfo = `<section class="info-card delivery"><h3>${addressTitle}</h3><dl>${field(t.governorate, governorate)}${field(t.address, address(order))}${field(t.shipping, shipping)}${field(t.payment, payment)}</dl></section>`;
  const codes = `<section class="document-footer"><div class="scan">${assets.qr ? `<img class="qr" src="${dataUrl('image/png', assets.qr)}" alt="Store QR">` : ''}<div class="contact"><strong>${escapeHtml(arabic ? 'للاستفسارات وخدمة العملاء' : 'Questions & customer care')}</strong><bdi dir="ltr">${SUPPORT_PHONE}</bdi><bdi dir="ltr">${SUPPORT_EMAIL}</bdi><bdi dir="ltr">wasatalbalad.store</bdi></div></div><div class="tracking">${assets.barcode ? `<img class="barcode" src="${dataUrl('image/png', assets.barcode)}" alt="Order barcode">` : ''}<bdi dir="ltr">#${escapeHtml(orderNumber)}</bdi></div></section>`;
  return `<!doctype html><html lang="${arabic ? 'ar' : 'en'}" dir="${arabic ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>${embeddedFonts}\n${documentStyles}\n${compact ? '@page{margin:0}' : ''}</style></head><body class="${compact ? 'roll' : 'invoice'}${thermalReceipt ? ' thermal-receipt' : ''}${shippingLabel ? ' shipping-label' : ''}"><main class="page">
    <header class="brand"><div class="brand-identity"><img class="brand-logo" src="${logo}" alt="${escapeHtml(request.template.companyName)}"><p class="brand-site" dir="ltr">wasatalbalad.store</p></div><div class="document-identity"><span class="eyebrow">${arabic ? 'وسط البلد ستور' : 'WASAT AL BALAD STORE'}</span><h1>${escapeHtml(title)}</h1><div class="order-reference"><span>${t.order}</span><bdi dir="ltr">#${escapeHtml(orderNumber)}</bdi></div>${createdLabel ? `<p class="date"><bdi>${escapeHtml(createdLabel)}</bdi></p>` : ''}</div></header>
    <div class="information">${customerInfo}${deliveryInfo}</div>
    <section class="order-items"><div class="section-heading"><h2>${t.items}</h2><span>${lines.length} ${arabic ? 'صنف' : 'items'}</span></div><table class="items"><thead><tr><th class="index">#</th><th class="product">${t.item}</th><th class="quantity">${t.qty}</th>${compact ? '' : `<th class="amount">${t.unit}</th>`}${shippingLabel ? '' : `<th class="amount">${t.total}</th>`}</tr></thead><tbody>${rows}</tbody></table></section>
    <section class="closing"><div class="order-note"><h3>${arabic ? 'ملاحظات الطلب' : 'Order notes'}</h3><p><bdi>${escapeHtml(notes || (arabic ? 'شكرًا لاختياركم وسط البلد ستور.' : 'Thank you for choosing Wasat Al Balad Store.'))}</bdi></p></div><div class="summary">${shippingLabel ? '' : totalRows}<div class="grand"><span>${arabic ? 'إجمالي الطلب' : 'Order total'}</span><bdi dir="ltr">${escapeHtml(total)}</bdi></div></div></section>
    ${codes}${request.template.body ? `<p class="custom-note">${escapeHtml(request.template.body)}</p>` : ''}<footer class="thanks">${escapeHtml(request.template.footerText || t.thankYou)}</footer>
  </main></body></html>`;
};

const renderHtmlPdfPage = async (
  page: Page,
  request: DocumentRequest,
  assets: RenderAssets,
): Promise<HtmlPdfResult> => {
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
  pdf.setCreator('Woo Ops HTML layouts v4');
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const bytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false });
  return {
    bytes,
    pageCount: pdf.getPageCount(),
    widthPoints: exactWidth,
    heightPoints: exactHeight,
  };
};

export const createHtmlPdfRenderSession = async (): Promise<HtmlPdfRenderSession> => {
  if (process.env.WOO_OPS_DOCUMENT_BROWSER_UNAVAILABLE_FOR_TEST === '1')
    throw new Error('Playwright browser executable unavailable');
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
    browser = await launchDocumentBrowser();
    page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
  } catch (error) {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    throw error;
  }
  const activeBrowser = browser;
  const activePage = page;
  let closed = false;
  return {
    render: async (request, assets) => {
      if (closed) throw new Error('DOCUMENT_RENDER_SESSION_CLOSED');
      return renderHtmlPdfPage(activePage, request, assets);
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await activePage.close().catch(() => undefined);
      await activeBrowser.close();
    },
  };
};

export const renderHtmlPdf = async (
  request: DocumentRequest,
  assets: RenderAssets,
): Promise<HtmlPdfResult> => {
  const session = await createHtmlPdfRenderSession();
  try {
    return await session.render(request, assets);
  } finally {
    await session.close();
  }
};
