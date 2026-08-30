import bwipjs from 'bwip-js';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';

export type DocumentFormat = 'a4' | 'a5' | 'thermal-80mm' | 'label-100x150mm';
export type DocumentDirection = 'rtl' | 'ltr';
export type DocumentLocale = 'ar-EG' | 'en-US';
export type DocumentOrder = Readonly<Record<string, unknown>>;
export type DocumentTemplate = Readonly<{
  id?: string;
  version: number;
  name: string;
  companyName: string;
  companyAddress?: string;
  footerText?: string;
  locale?: DocumentLocale;
  direction?: DocumentDirection;
  fontBytes?: Uint8Array;
  body?: string;
}>;
export type DocumentRequest = Readonly<{
  order: DocumentOrder;
  format: DocumentFormat;
  template: DocumentTemplate;
  orderId?: string;
  documentNumber?: string;
  barcodeValue?: string;
  qrValue?: string;
  thermalHeightMm?: number;
}>;
export type DocumentSnapshot = Readonly<{
  orderId: string;
  format: DocumentFormat;
  templateVersion: number;
  sourceHash: string;
  generatedAt: string;
  checksum?: string;
}>;
export type DocumentResult = Readonly<{
  bytes: Uint8Array;
  format: DocumentFormat;
  pageCount: number;
  widthPoints: number;
  heightPoints: number;
  checksum: string;
  snapshot: DocumentSnapshot;
}>;
export type DocumentFailure = Readonly<{ orderId: string; error: string }>;
export type DocumentBatchResult = Readonly<{
  documents: readonly DocumentResult[];
  failures: readonly DocumentFailure[];
  mergedPdf: Uint8Array;
  checksum: string;
}>;

const MM_TO_POINTS = 72 / 25.4;
const PAGE_SIZES: Readonly<Record<DocumentFormat, readonly [number, number]>> = {
  a4: [210 * MM_TO_POINTS, 297 * MM_TO_POINTS],
  a5: [148 * MM_TO_POINTS, 210 * MM_TO_POINTS],
  'thermal-80mm': [80 * MM_TO_POINTS, 150 * MM_TO_POINTS],
  'label-100x150mm': [100 * MM_TO_POINTS, 150 * MM_TO_POINTS],
};
const DOCUMENT_FORMATS: readonly DocumentFormat[] = ['a4', 'a5', 'thermal-80mm', 'label-100x150mm'];
const DOCUMENT_LOCALES: readonly DocumentLocale[] = ['ar-EG', 'en-US'];
const DOCUMENT_DIRECTIONS: readonly DocumentDirection[] = ['rtl', 'ltr'];
const MAX_BATCH_DOCUMENTS = 500;
const MAX_LINES = 100;
const MAX_TEMPLATE_BODY = 5_000;
const templateTokenPattern = /\{\{\s*([A-Za-z][A-Za-z0-9_.-]*)\s*\}\}/gu;
const allowedTemplateTokens = new Set([
  'order.id',
  'order.number',
  'order.orderNumber',
  'order.currency',
  'order.totalMinor',
  'order.grandTotalMinor',
  'customer.name',
  'customer.email',
  'customer.phone',
  'billing.address',
  'billing.address_1',
  'billing.city',
  'billing.postcode',
  'shipping.address',
  'shipping.address_1',
  'shipping.city',
  'shipping.postcode',
  'shipping.country',
  'document.number',
  'document.format',
  'company.name',
  'company.address',
  'footer',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const valueText = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value) ?? '';
};
const nestedValue = (source: unknown, path: string): unknown => {
  let current = source;
  for (const part of path.split('.')) {
    if (!isRecord(current)) return '';
    current = current[part];
  }
  return current;
};
const orderValue = (order: DocumentOrder, ...paths: string[]): string => {
  for (const path of paths) {
    const value = nestedValue(order, path);
    if (value !== undefined && value !== null && valueText(value).trim()) return valueText(value);
  }
  return '';
};
export type SafeTemplateAnalysis = Readonly<{
  source: string;
  tokens: readonly string[];
}>;

const templateTokenValue = (order: DocumentOrder, token: string): string => {
  const direct: Record<string, readonly string[]> = {
    'order.id': ['id', 'orderId'],
    'order.number': ['orderNumber', 'number', 'id'],
    'order.orderNumber': ['orderNumber', 'number', 'id'],
    'order.currency': ['currency'],
    'order.totalMinor': ['grandTotalMinor', 'total'],
    'order.grandTotalMinor': ['grandTotalMinor', 'total'],
    'customer.name': ['customer.name', 'billing.name', 'billing.first_name'],
    'customer.email': ['customer.email', 'billing.email'],
    'customer.phone': ['customer.phone', 'billing.phone'],
    'billing.address': ['billing.address', 'billing.address_1'],
    'billing.address_1': ['billing.address_1', 'billing.address'],
    'billing.city': ['billing.city'],
    'billing.postcode': ['billing.postcode'],
    'shipping.address': ['shipping.address', 'shipping.address_1'],
    'shipping.address_1': ['shipping.address_1', 'shipping.address'],
    'shipping.city': ['shipping.city'],
    'shipping.postcode': ['shipping.postcode'],
    'shipping.country': ['shipping.country'],
  };
  return orderValue(order, ...(direct[token] ?? []));
};

export const validateSafeTemplate = (source: string): SafeTemplateAnalysis => {
  if (
    typeof source !== 'string' ||
    source.length > MAX_TEMPLATE_BODY ||
    /[<>]|javascript\s*:|data\s*:|https?\s*:|url\s*\(|@import|expression\s*\(/iu.test(source) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(source)
  )
    throw new Error('DOCUMENT_TEMPLATE_UNSAFE');
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = templateTokenPattern.exec(source)) !== null) {
    const token = match[1];
    if (!token) throw new Error('DOCUMENT_TEMPLATE_TOKEN_INVALID');
    if (!allowedTemplateTokens.has(token)) throw new Error('DOCUMENT_TEMPLATE_TOKEN_INVALID');
    tokens.push(token);
  }
  templateTokenPattern.lastIndex = 0;
  if (source.replace(templateTokenPattern, '').includes('{{'))
    throw new Error('DOCUMENT_TEMPLATE_TOKEN_INVALID');
  return { source: source.trim(), tokens: [...new Set(tokens)] };
};

export const renderSafeTemplate = (source: string, order: DocumentOrder): string => {
  const analysis = validateSafeTemplate(source);
  return analysis.source.replace(templateTokenPattern, (_match, token: string) =>
    templateTokenValue(order, token),
  );
};
const assertText = (value: unknown, code: string, max: number, required = true): string => {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error(code);
  return value.trim();
};
const normalizeTemplate = (template: DocumentTemplate): DocumentTemplate => {
  if (!Number.isInteger(template.version) || template.version < 1)
    throw new Error('DOCUMENT_TEMPLATE_VERSION_INVALID');
  const locale = template.locale ?? 'ar-EG';
  const direction = template.direction ?? (locale === 'ar-EG' ? 'rtl' : 'ltr');
  if (!DOCUMENT_LOCALES.includes(locale)) throw new Error('DOCUMENT_LOCALE_INVALID');
  if (!DOCUMENT_DIRECTIONS.includes(direction)) throw new Error('DOCUMENT_DIRECTION_INVALID');
  return {
    ...(template.id === undefined
      ? {}
      : { id: assertText(template.id, 'DOCUMENT_TEMPLATE_ID_INVALID', 256) }),
    version: template.version,
    name: assertText(template.name, 'DOCUMENT_TEMPLATE_NAME_INVALID', 120),
    companyName: assertText(template.companyName, 'DOCUMENT_COMPANY_INVALID', 240),
    ...(template.companyAddress === undefined
      ? {}
      : {
          companyAddress: assertText(
            template.companyAddress,
            'DOCUMENT_COMPANY_ADDRESS_INVALID',
            500,
          ),
        }),
    ...(template.footerText === undefined
      ? {}
      : { footerText: assertText(template.footerText, 'DOCUMENT_FOOTER_INVALID', 500) }),
    ...(template.body === undefined ? {} : { body: validateSafeTemplate(template.body).source }),
    locale,
    direction,
    ...(template.fontBytes === undefined ? {} : { fontBytes: template.fontBytes }),
  };
};
const normalizeRequest = (request: DocumentRequest): DocumentRequest => {
  const template = normalizeTemplate(request.template);
  if (!DOCUMENT_FORMATS.includes(request.format)) throw new Error('DOCUMENT_FORMAT_INVALID');
  if (!isRecord(request.order)) throw new Error('DOCUMENT_ORDER_INVALID');
  const height = request.thermalHeightMm ?? 150;
  if (!Number.isFinite(height) || height < 50 || height > 500)
    throw new Error('DOCUMENT_THERMAL_HEIGHT_INVALID');
  return {
    ...request,
    template,
    thermalHeightMm: height,
    ...(request.orderId === undefined
      ? {}
      : { orderId: assertText(request.orderId, 'DOCUMENT_ORDER_ID_INVALID', 256) }),
    ...(request.documentNumber === undefined
      ? {}
      : { documentNumber: assertText(request.documentNumber, 'DOCUMENT_NUMBER_INVALID', 120) }),
    ...(request.barcodeValue === undefined
      ? {}
      : { barcodeValue: assertText(request.barcodeValue, 'DOCUMENT_BARCODE_INVALID', 120) }),
    ...(request.qrValue === undefined
      ? {}
      : { qrValue: assertText(request.qrValue, 'DOCUMENT_QR_INVALID', 500) }),
  };
};
const snapshotSource = (request: DocumentRequest): string =>
  JSON.stringify({
    orderId: request.orderId ?? orderValue(request.order, 'id', 'orderId', 'orderNumber'),
    format: request.format,
    template: {
      id: request.template.id ?? null,
      version: request.template.version,
      name: request.template.name,
      companyName: request.template.companyName,
      companyAddress: request.template.companyAddress ?? null,
      footerText: request.template.footerText ?? null,
      body: request.template.body ?? null,
      locale: request.template.locale ?? null,
      direction: request.template.direction ?? null,
    },
    order: request.order,
  }) ?? '{}';
const rtlText = (value: string, direction: DocumentDirection): string =>
  direction === 'rtl' && /[\u0600-\u06ff]/u.test(value) ? `\u202B${value}\u202C` : value;
const pdfBytes = (value: Uint8Array): Uint8Array => value;
const drawWrapped = (
  page: PDFPage,
  value: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  direction: DocumentDirection,
  color = rgb(0.08, 0.1, 0.15),
): number => {
  const words = rtlText(value, direction).split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  const visible = lines.length > 0 ? lines : [''];
  visible.forEach((item, index) =>
    page.drawText(item, { x, y: y - index * (size + 3), size, font, color }),
  );
  return visible.length * (size + 3);
};
const drawPair = (
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  direction: DocumentDirection,
  size: number,
): number => {
  const labelText = direction === 'rtl' ? `${value} :${label}` : `${label}: ${value}`;
  return drawWrapped(page, labelText, x, y, width, font, size, direction);
};
const imageBytes = (dataUrl: string): Uint8Array => {
  const encoded = dataUrl.substring(dataUrl.indexOf(',') + 1);
  return Uint8Array.from(Buffer.from(encoded, 'base64'));
};
const barcodePng = async (value: string): Promise<Uint8Array> =>
  new Uint8Array(
    await bwipjs.toBuffer({
      bcid: 'code128',
      text: value,
      scale: 2,
      height: 12,
      includetext: false,
    }),
  );
const qrPng = async (value: string): Promise<Uint8Array> =>
  imageBytes(await QRCode.toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 180 }));

const preparePdf = async (
  request: DocumentRequest,
): Promise<{ pdf: PDFDocument; font: PDFFont; width: number; height: number }> => {
  const normalized = normalizeRequest(request);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const [width, configuredHeight] = PAGE_SIZES[normalized.format];
  const height =
    normalized.format === 'thermal-80mm'
      ? normalized.thermalHeightMm! * MM_TO_POINTS
      : configuredHeight;
  const font = normalized.template.fontBytes
    ? await pdf.embedFont(normalized.template.fontBytes, { subset: false })
    : await pdf.embedFont(StandardFonts.Helvetica);
  if (normalized.template.direction === 'rtl' && !normalized.template.fontBytes)
    throw new Error('DOCUMENT_ARABIC_FONT_REQUIRED');
  pdf.setTitle(normalized.template.name);
  pdf.setAuthor(normalized.template.companyName);
  pdf.setSubject(`Woo Ops ${normalized.format}`);
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  return { pdf, font, width, height };
};

const drawDocument = async (
  request: DocumentRequest,
): Promise<{ pdf: PDFDocument; width: number; height: number }> => {
  const normalized = normalizeRequest(request);
  const { pdf, font, width, height } = await preparePdf(normalized);
  const page = pdf.addPage([width, height]);
  const direction = normalized.template.direction!;
  const margin = normalized.format === 'thermal-80mm' ? 14 : 32;
  const size =
    normalized.format === 'thermal-80mm' ? 8 : normalized.format === 'label-100x150mm' ? 10 : 10;
  let y = height - margin;
  const title =
    normalized.format === 'label-100x150mm'
      ? direction === 'rtl'
        ? 'بوليصة الشحن'
        : 'SHIPPING LABEL'
      : normalized.format === 'thermal-80mm'
        ? normalized.template.companyName
        : direction === 'rtl'
          ? 'فاتورة'
          : 'INVOICE';
  page.drawText(rtlText(title, direction), {
    x: direction === 'rtl' ? margin : margin,
    y,
    size: size + 6,
    font,
    color: rgb(0.04, 0.28, 0.58),
  });
  y -= size + 12;
  page.drawText(rtlText(normalized.template.companyName, direction), { x: margin, y, size, font });
  y -= size + 4;
  if (normalized.template.companyAddress) {
    y -= drawWrapped(
      page,
      normalized.template.companyAddress,
      margin,
      y,
      width - margin * 2,
      font,
      size,
      direction,
    );
  }
  if (normalized.template.body) {
    y -= drawWrapped(
      page,
      renderSafeTemplate(normalized.template.body, normalized.order),
      margin,
      y,
      width - margin * 2,
      font,
      size,
      direction,
    );
  }
  y -= 8;
  const orderNumber =
    normalized.documentNumber ?? orderValue(normalized.order, 'orderNumber', 'number', 'id');
  y -= drawPair(
    page,
    direction === 'rtl' ? 'رقم الطلب' : 'Order',
    orderNumber,
    margin,
    y,
    width - margin * 2,
    font,
    direction,
    size,
  );
  const customer = orderValue(
    normalized.order,
    'billing.name',
    'customer.name',
    'billing.first_name',
  );
  if (customer)
    y -= drawPair(
      page,
      direction === 'rtl' ? 'العميل' : 'Customer',
      customer,
      margin,
      y,
      width - margin * 2,
      font,
      direction,
      size,
    );
  const phone = orderValue(normalized.order, 'billing.phone', 'customer.phone');
  if (phone)
    y -= drawPair(
      page,
      direction === 'rtl' ? 'الهاتف' : 'Phone',
      phone,
      margin,
      y,
      width - margin * 2,
      font,
      direction,
      size,
    );
  const address = orderValue(
    normalized.order,
    'shipping.address_1',
    'shipping.address',
    'billing.address_1',
  );
  if (address)
    y -= drawPair(
      page,
      direction === 'rtl' ? 'العنوان' : 'Address',
      address,
      margin,
      y,
      width - margin * 2,
      font,
      direction,
      size,
    );
  y -= 8;
  const lines = Array.isArray(normalized.order.lines)
    ? normalized.order.lines.slice(0, MAX_LINES)
    : [];
  page.drawText(direction === 'rtl' ? 'الأصناف' : 'Items', { x: margin, y, size: size + 1, font });
  y -= size + 5;
  for (const line of lines) {
    const item = isRecord(line) ? line : {};
    const textLine = `${orderValue(item, 'name', 'title')} × ${orderValue(item, 'quantity')}  ${orderValue(item, 'totalMinor', 'total')}`;
    y -= drawWrapped(page, textLine, margin, y, width - margin * 2, font, size, direction);
    if (y < margin + 80) break;
  }
  const total = orderValue(normalized.order, 'grandTotalMinor', 'amounts.grandTotalMinor', 'total');
  y -= 5;
  y -= drawPair(
    page,
    direction === 'rtl' ? 'الإجمالي' : 'Total',
    total,
    margin,
    y,
    width - margin * 2,
    font,
    direction,
    size + 1,
  );
  const code = normalized.barcodeValue ?? orderNumber;
  if (code) {
    const barcode = await barcodePng(code);
    const image = await pdf.embedPng(barcode);
    const imageWidth = Math.min(
      width - margin * 2,
      normalized.format === 'thermal-80mm' ? 145 : 220,
    );
    page.drawImage(image, { x: margin, y: margin + 28, width: imageWidth, height: 38 });
  }
  const qrValue = normalized.qrValue ?? orderNumber;
  if (qrValue && normalized.format !== 'thermal-80mm') {
    const qr = await pdf.embedPng(await qrPng(qrValue));
    const qrSize = Math.min(70, width / 4);
    page.drawImage(qr, { x: width - margin - qrSize, y: margin, width: qrSize, height: qrSize });
  }
  if (normalized.template.footerText)
    page.drawText(rtlText(normalized.template.footerText, direction), {
      x: margin,
      y: margin,
      size: 7,
      font,
    });
  return { pdf, width, height };
};

export const generateDocument = async (request: DocumentRequest): Promise<DocumentResult> => {
  const normalized = normalizeRequest(request);
  const source = snapshotSource(normalized);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const { pdf, width, height } = await drawDocument(normalized);
  const bytes = pdfBytes(await pdf.save({ useObjectStreams: false, addDefaultPage: false }));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const snapshot: DocumentSnapshot = {
    orderId: normalized.orderId ?? orderValue(normalized.order, 'id', 'orderId', 'orderNumber'),
    format: normalized.format,
    templateVersion: normalized.template.version,
    sourceHash,
    generatedAt: new Date(0).toISOString(),
    checksum,
  };
  return {
    bytes,
    format: normalized.format,
    pageCount: 1,
    widthPoints: width,
    heightPoints: height,
    checksum,
    snapshot,
  };
};

export const generateDocumentBatch = async (
  requests: readonly DocumentRequest[],
): Promise<DocumentBatchResult> => {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > MAX_BATCH_DOCUMENTS)
    throw new Error('DOCUMENT_BATCH_SIZE_INVALID');
  const documents: DocumentResult[] = [];
  const failures: DocumentFailure[] = [];
  for (const request of requests) {
    const orderId = request.orderId ?? orderValue(request.order, 'id', 'orderId', 'orderNumber');
    try {
      documents.push(await generateDocument(request));
    } catch (error) {
      failures.push({
        orderId: orderId || 'unknown',
        error: error instanceof Error ? error.message : 'DOCUMENT_GENERATION_FAILED',
      });
    }
  }
  const merged = await PDFDocument.create();
  for (const document of documents) {
    const source = await PDFDocument.load(document.bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  merged.setTitle('Woo Ops document batch');
  merged.setCreationDate(new Date(0));
  merged.setModificationDate(new Date(0));
  const mergedPdf = pdfBytes(await merged.save({ useObjectStreams: false, addDefaultPage: false }));
  return {
    documents,
    failures,
    mergedPdf,
    checksum: createHash('sha256').update(mergedPdf).digest('hex'),
  };
};

export const documentPageSize = (
  format: DocumentFormat,
  thermalHeightMm = 150,
): readonly [number, number] => {
  if (!DOCUMENT_FORMATS.includes(format)) throw new Error('DOCUMENT_FORMAT_INVALID');
  if (!Number.isFinite(thermalHeightMm) || thermalHeightMm < 50 || thermalHeightMm > 500)
    throw new Error('DOCUMENT_THERMAL_HEIGHT_INVALID');
  if (format === 'thermal-80mm') return [80 * MM_TO_POINTS, thermalHeightMm * MM_TO_POINTS];
  return PAGE_SIZES[format];
};
