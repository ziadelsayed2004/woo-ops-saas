import { chromium } from 'playwright-chromium';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

import type { DocumentRequest } from './index.js';

const MM_TO_POINTS = 72 / 25.4;
const SUPPORT_PHONE = '01055127111';
const SUPPORT_EMAIL = 'info@wasatalbalad.store';
const STORE_URL = 'https://wasatalbalad.store/';
const COLOR_LOGO = new Uint8Array(
  readFileSync(new URL('../assets/wasat-al-balad-horizontal.svg', import.meta.url)),
);
const MONO_LOGO = new Uint8Array(
  readFileSync(new URL('../assets/wasat-al-balad-mark.svg', import.meta.url)),
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
  const amount = Number(BigInt(minor)) / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || 'EGP',
    currencyDisplay: 'code',
    numberingSystem: 'latn',
    minimumFractionDigits: 2,
  }).format(amount);
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
  const lines = Array.isArray(order.lines) ? order.lines.slice(0, 100) : [];
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
      return `<tr><td class="index">${index + 1}</td><td class="product"><strong>${escapeHtml(text(line, 'name', 'title'))}</strong>${text(line, 'sku') ? `<small>${escapeHtml(text(line, 'sku'))}</small>` : ''}</td><td>${escapeHtml(quantity)}</td><td>${escapeHtml(money(unitMinor, currency, locale))}</td><td>${escapeHtml(money(totalMinor, currency, locale))}</td></tr>`;
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
  const logo = dataUrl('image/svg+xml', compact ? MONO_LOGO : COLOR_LOGO);
  const fontFace = request.template.fontBytes
    ? `@font-face{font-family:DocumentFont;src:url('${dataUrl('font/ttf', request.template.fontBytes)}') format('truetype');font-weight:100 900}`
    : '';
  const formatClass = request.format.replaceAll('-', '_');
  return `<!doctype html><html lang="${arabic ? 'ar' : 'en'}" dir="${arabic ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><style>
${fontFace} @page{margin:0} *{box-sizing:border-box} html,body{margin:0;padding:0;background:#fff;color:#152033;font-family:DocumentFont,Arial,"Noto Sans Arabic",sans-serif;font-variant-numeric:lining-nums tabular-nums} body{direction:${arabic ? 'rtl' : 'ltr'}} .page{min-height:100%;padding:12mm 13mm;display:flex;flex-direction:column;gap:6mm}.a4 .page{width:210mm;min-height:297mm}.a5 .page{width:148mm;min-height:210mm}.brand{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #720eec;padding-bottom:5mm}.brand-identity{display:flex;align-items:center;gap:4mm}.brand-logo{display:block;width:50mm;max-height:19mm;object-fit:contain}.brand p,.meta p{margin:1mm 0;color:#56657a}.doc-title{text-align:${arabic ? 'left' : 'right'}}.doc-title h2{font-size:22px;margin:0 0 2mm}.pill{display:inline-block;background:#f1e8ff;color:#4d0a9e;border-radius:999px;padding:1.5mm 4mm;font-weight:700}.facts{display:grid;grid-template-columns:1fr 1fr;gap:3mm}.fact{border:1px solid #ded4ee;border-radius:3mm;padding:3mm;min-height:17mm}.fact span{display:block;color:#64748b;font-size:10px;margin-bottom:1mm}.fact strong{font-size:12px;line-height:1.55;overflow-wrap:anywhere}.section-title{font-size:15px;margin:0 0 2mm}.items{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #ded4ee;border-radius:3mm;overflow:hidden}.items th{background:#720eec;color:white;font-size:10px;padding:3mm 2mm}.items td{padding:3mm 2mm;border-bottom:1px solid #eee8f6;font-size:10px;text-align:center;vertical-align:top}.items tr:last-child td{border-bottom:0}.items .product{text-align:${arabic ? 'right' : 'left'};width:42%}.product small{display:block;color:#64748b;margin-top:1mm;direction:ltr}.index{width:7%}.summary{margin-${arabic ? 'right' : 'left'}:auto;width:78mm;border:1px solid #ded4ee;border-radius:3mm;padding:3mm}.total-row{display:flex;justify-content:space-between;padding:1.7mm 0;border-bottom:1px dashed #ded4ee;font-size:11px}.total-row:last-child{border-bottom:0}.total-row.grand{font-size:14px;color:#4d0a9e;padding-top:3mm}.codes{display:flex;align-items:flex-end;justify-content:space-between;gap:6mm;margin-top:auto;padding-top:4mm;border-top:1px solid #ded4ee}.barcode{max-width:62mm;height:13mm;object-fit:fill}.qr{width:22mm;height:22mm}.code-caption{font-size:7px;color:#475569;margin-top:1mm;direction:ltr}.support{display:flex;justify-content:center;gap:5mm;flex-wrap:wrap;text-align:center;font-size:9px;color:#334155}.support span{direction:ltr}.footer{text-align:center;font-size:9px;color:#64748b;margin-top:2mm}
.thermal_80mm .page,.label_100x150mm .page{width:80mm;min-height:0;padding:4mm;gap:3mm}.thermal_80mm .brand,.label_100x150mm .brand{display:block;text-align:center;padding-bottom:3mm;border-color:#111}.thermal_80mm .brand-identity,.label_100x150mm .brand-identity{display:block}.thermal_80mm .brand-logo,.label_100x150mm .brand-logo{width:18mm;height:18mm;margin:0 auto 1mm;filter:grayscale(1) contrast(2)}.thermal_80mm .brand p,.label_100x150mm .brand p{font-size:8px}.thermal_80mm .doc-title,.label_100x150mm .doc-title{text-align:center;margin-top:2mm}.thermal_80mm .doc-title h2,.label_100x150mm .doc-title h2{font-size:15px}.thermal_80mm .facts,.label_100x150mm .facts{display:block}.thermal_80mm .fact,.label_100x150mm .fact{border:0;border-bottom:1px dashed #9aa5b1;border-radius:0;min-height:0;padding:2mm 0}.thermal_80mm .fact span,.thermal_80mm .fact strong,.label_100x150mm .fact span,.label_100x150mm .fact strong{display:inline;font-size:10px}.thermal_80mm .fact span::after,.label_100x150mm .fact span::after{content:": "}.thermal_80mm .items th,.label_100x150mm .items th{background:#eee;color:#152033;padding:2mm 1mm}.thermal_80mm .items td,.label_100x150mm .items td{padding:2mm 1mm;font-size:9px}.thermal_80mm .items th:nth-child(1),.thermal_80mm .items td:nth-child(1),.thermal_80mm .items th:nth-child(4),.thermal_80mm .items td:nth-child(4),.label_100x150mm .items th:nth-child(1),.label_100x150mm .items td:nth-child(1),.label_100x150mm .items th:nth-child(4),.label_100x150mm .items td:nth-child(4){display:none}.thermal_80mm .items .product,.label_100x150mm .items .product{width:auto}.thermal_80mm .summary{width:100%;padding:2mm}.label_100x150mm .summary{display:none}.thermal_80mm .codes,.label_100x150mm .codes{display:grid;grid-template-columns:1fr 19mm;align-items:end;gap:2mm;text-align:center;margin-top:2mm;border-color:#aaa}.thermal_80mm .barcode,.label_100x150mm .barcode{width:100%;max-width:100%;height:12mm}.thermal_80mm .qr,.label_100x150mm .qr{display:block;width:18mm;height:18mm}.thermal_80mm .support,.label_100x150mm .support{display:block;font-size:7.5px}.thermal_80mm .support span,.label_100x150mm .support span{display:block;margin:.8mm 0}.thermal_80mm .footer,.label_100x150mm .footer{font-size:7px;margin-top:0}
</style></head><body class="${formatClass}"><main class="page"><header class="brand"><div class="brand-identity"><img class="brand-logo" src="${logo}" alt="${escapeHtml(request.template.companyName)}">${request.template.companyAddress ? `<p>${escapeHtml(request.template.companyAddress)}</p>` : ''}</div><div class="doc-title"><h2>${escapeHtml(title)}</h2><span class="pill">#${escapeHtml(orderNumber)}</span>${createdLabel ? `<p>${escapeHtml(createdLabel)}</p>` : ''}</div></header><section class="facts">${factCards}</section><section><h3 class="section-title">${escapeHtml(t.items)}</h3><table class="items"><thead><tr><th>#</th><th>${escapeHtml(t.item)}</th><th>${escapeHtml(t.qty)}</th><th>${escapeHtml(t.unit)}</th><th>${escapeHtml(t.total)}</th></tr></thead><tbody>${lineRows}</tbody></table></section><section class="summary">${totalRows}</section><section class="codes"><div>${assets.barcode ? `<img class="barcode" src="${dataUrl('image/png', assets.barcode)}"><div class="code-caption">#${escapeHtml(orderNumber)}</div>` : ''}</div>${assets.qr ? `<div><img class="qr" src="${dataUrl('image/png', assets.qr)}"><div class="code-caption">${STORE_URL}</div></div>` : ''}</section><section class="support"><span>${escapeHtml(SUPPORT_PHONE)}</span><span>${escapeHtml(SUPPORT_EMAIL)}</span></section>${request.template.body ? `<div class="footer">${escapeHtml(request.template.body)}</div>` : ''}<footer class="footer">${escapeHtml(request.template.footerText || t.thankYou)}</footer></main></body></html>`;
};

export const renderHtmlPdf = async (
  request: DocumentRequest,
  assets: RenderAssets,
): Promise<{ bytes: Uint8Array; pageCount: number; widthPoints: number; heightPoints: number }> => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(htmlDocument(request, assets), { waitUntil: 'load' });
    await page.emulateMedia({ media: 'print' });
    let widthMm =
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
      heightMm =
        request.thermalHeightMm ??
        Math.min(500, Math.max(50, Math.ceil((contentPx * 25.4) / 96) + 2));
    }
    const raw = await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm}mm`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: false,
      displayHeaderFooter: false,
    });
    const pdf = await PDFDocument.load(new Uint8Array(raw));
    const exactWidth = widthMm * MM_TO_POINTS;
    const exactHeight = heightMm * MM_TO_POINTS;
    for (const pdfPage of pdf.getPages()) pdfPage.setSize(exactWidth, exactHeight);
    pdf.setTitle(request.template.name);
    pdf.setAuthor(request.template.companyName);
    pdf.setSubject(`Woo Ops ${request.format}`);
    pdf.setProducer('Woo Ops HTML PDF renderer');
    pdf.setCreator('Woo Ops');
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
