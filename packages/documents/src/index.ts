import bwipjs from 'bwip-js';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import QRCode from 'qrcode';
import { renderHtmlPdf } from './html-renderer.js';

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
  /** Legal invoice wording is opt-in from the account document policy. */
  documentKind?: 'order' | 'invoice';
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

export type ZipEntry = Readonly<{
  name: string;
  bytes: Uint8Array;
}>;

const MM_TO_POINTS = 72 / 25.4;
const PAGE_SIZES: Readonly<Record<DocumentFormat, readonly [number, number]>> = {
  a4: [210 * MM_TO_POINTS, 297 * MM_TO_POINTS],
  a5: [148 * MM_TO_POINTS, 210 * MM_TO_POINTS],
  'thermal-80mm': [80 * MM_TO_POINTS, 150 * MM_TO_POINTS],
  // Legacy persisted identifier; the operator-facing shipping roll is now 80mm wide.
  'label-100x150mm': [80 * MM_TO_POINTS, 150 * MM_TO_POINTS],
};
const DOCUMENT_FORMATS: readonly DocumentFormat[] = ['a4', 'a5', 'thermal-80mm', 'label-100x150mm'];
const DOCUMENT_LOCALES: readonly DocumentLocale[] = ['ar-EG', 'en-US'];
const DOCUMENT_DIRECTIONS: readonly DocumentDirection[] = ['rtl', 'ltr'];
const MAX_BATCH_DOCUMENTS = 500;
const MAX_ZIP_ENTRIES = 501;
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_BYTES = 100 * 1024 * 1024;
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
const displayMoney = (minor: string, currency: string): string => {
  if (!/^-?\d+$/u.test(minor)) return minor;
  const value = BigInt(minor);
  const positive = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${positive / 100n}.${String(positive % 100n).padStart(2, '0')} ${currency}`;
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
  const documentKind = request.documentKind ?? 'order';
  if (!['order', 'invoice'].includes(documentKind)) throw new Error('DOCUMENT_KIND_INVALID');
  const height = request.thermalHeightMm;
  if (height !== undefined && (!Number.isFinite(height) || height < 50 || height > 500))
    throw new Error('DOCUMENT_THERMAL_HEIGHT_INVALID');
  return {
    ...request,
    template,
    ...(height === undefined ? {} : { thermalHeightMm: height }),
    documentKind,
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
    documentKind: request.documentKind ?? 'order',
    documentNumber: request.documentNumber ?? null,
    thermalHeightMm: request.thermalHeightMm ?? 150,
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
const pdfBytes = (value: Uint8Array): Uint8Array => value;
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

export const generateDocument = async (request: DocumentRequest): Promise<DocumentResult> => {
  const normalized = normalizeRequest(request);
  const source = snapshotSource(normalized);
  const sourceHash = createHash('sha256').update(source).digest('hex');
  const orderNumber =
    normalized.documentNumber ?? orderValue(normalized.order, 'orderNumber', 'number', 'id');
  const code = normalized.barcodeValue ?? orderNumber;
  const qrValue = normalized.qrValue ?? 'https://wasatalbalad.store/';
  const renderRequest: DocumentRequest = {
    ...normalized,
    template: {
      ...normalized.template,
      body: normalized.template.body?.replace(/\{\{[^}]+\}\}/gu, '').trim()
        ? renderSafeTemplate(normalized.template.body, normalized.order)
        : '',
    },
  };
  const assets = {
    ...(code ? { barcode: await barcodePng(code) } : {}),
    ...(qrValue ? { qr: await qrPng(qrValue) } : {}),
  };
  // Never silently change the customer's print layout when Chromium is unavailable.
  const rendered = await renderHtmlPdf(renderRequest, assets);
  const bytes = pdfBytes(rendered.bytes);
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
    pageCount: rendered.pageCount,
    widthPoints: rendered.widthPoints,
    heightPoints: rendered.heightPoints,
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
  const mergedPdf = await mergeDocumentPdfs(documents.map((document) => document.bytes));
  return {
    documents,
    failures,
    mergedPdf,
    checksum: createHash('sha256').update(mergedPdf).digest('hex'),
  };
};

/** Merge already-rendered PDFs without re-reading mutable order or template data. */
export const mergeDocumentPdfs = async (documents: readonly Uint8Array[]): Promise<Uint8Array> => {
  if (!Array.isArray(documents) || documents.length > MAX_BATCH_DOCUMENTS)
    throw new Error('DOCUMENT_BATCH_SIZE_INVALID');
  const merged = await PDFDocument.create();
  for (const bytes of documents) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > MAX_ZIP_ENTRY_BYTES)
      throw new Error('DOCUMENT_FILE_SIZE_INVALID');
    const source = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  merged.setTitle('Woo Ops document batch');
  merged.setCreator('Woo Ops HTML layouts v4');
  merged.setProducer('Woo Ops HTML PDF renderer');
  merged.setCreationDate(new Date(0));
  merged.setModificationDate(new Date(0));
  return pdfBytes(await merged.save({ useObjectStreams: false, addDefaultPage: false }));
};

const zipName = (name: string): Uint8Array => {
  if (
    typeof name !== 'string' ||
    name.length < 1 ||
    name.length > 180 ||
    /[\u0000-\u001f\u007f]/u.test(name) ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '' || part === '.' || part === '..')
  )
    throw new Error('DOCUMENT_ZIP_ENTRY_INVALID');
  return new TextEncoder().encode(name);
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeU16 = (view: DataView, offset: number, value: number): void =>
  view.setUint16(offset, value, true);
const writeU32 = (view: DataView, offset: number, value: number): void =>
  view.setUint32(offset, value >>> 0, true);

/** Create a deterministic, path-safe, uncompressed ZIP suitable for private download bundles. */
export const createZipArchive = (entries: readonly ZipEntry[]): Uint8Array => {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > MAX_ZIP_ENTRIES)
    throw new Error('DOCUMENT_ZIP_ENTRY_COUNT_INVALID');
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;
  let totalSize = 0;
  const names = new Set<string>();
  for (const entry of entries) {
    if (!entry || names.has(entry.name)) throw new Error('DOCUMENT_ZIP_ENTRY_INVALID');
    names.add(entry.name);
    const name = zipName(entry.name);
    const bytes = entry.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.length > MAX_ZIP_ENTRY_BYTES)
      throw new Error('DOCUMENT_ZIP_ENTRY_SIZE_INVALID');
    totalSize += bytes.length;
    if (totalSize > MAX_ZIP_BYTES) throw new Error('DOCUMENT_ZIP_SIZE_INVALID');
    const crc = crc32(bytes);
    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);
    writeU32(localView, 0, 0x04034b50);
    writeU16(localView, 4, 20);
    writeU16(localView, 6, 0x800);
    writeU16(localView, 8, 0);
    writeU16(localView, 10, 0);
    writeU16(localView, 12, 0);
    writeU32(localView, 14, crc);
    writeU32(localView, 18, bytes.length);
    writeU32(localView, 22, bytes.length);
    writeU16(localView, 26, name.length);
    writeU16(localView, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, bytes);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);
    writeU32(centralView, 0, 0x02014b50);
    writeU16(centralView, 4, 20);
    writeU16(centralView, 6, 20);
    writeU16(centralView, 8, 0x800);
    writeU16(centralView, 10, 0);
    writeU16(centralView, 12, 0);
    writeU16(centralView, 14, 0);
    writeU32(centralView, 16, crc);
    writeU32(centralView, 20, bytes.length);
    writeU32(centralView, 24, bytes.length);
    writeU16(centralView, 28, name.length);
    writeU16(centralView, 30, 0);
    writeU16(centralView, 32, 0);
    writeU16(centralView, 34, 0);
    writeU16(centralView, 36, 0);
    writeU32(centralView, 38, 0);
    writeU32(centralView, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + bytes.length;
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeU32(endView, 0, 0x06054b50);
  writeU16(endView, 8, entries.length);
  writeU16(endView, 10, entries.length);
  writeU32(endView, 12, centralSize);
  writeU32(endView, 16, localOffset);
  const output = new Uint8Array(localOffset + centralSize + end.length);
  let offset = 0;
  for (const part of localParts) {
    output.set(part, offset);
    offset += part.length;
  }
  for (const part of centralParts) {
    output.set(part, offset);
    offset += part.length;
  }
  output.set(end, offset);
  return output;
};

export const documentPageSize = (
  format: DocumentFormat,
  thermalHeightMm = 150,
): readonly [number, number] => {
  if (!DOCUMENT_FORMATS.includes(format)) throw new Error('DOCUMENT_FORMAT_INVALID');
  if (!Number.isFinite(thermalHeightMm) || thermalHeightMm < 50 || thermalHeightMm > 500)
    throw new Error('DOCUMENT_THERMAL_HEIGHT_INVALID');
  if (format === 'thermal-80mm' || format === 'label-100x150mm')
    return [80 * MM_TO_POINTS, thermalHeightMm * MM_TO_POINTS];
  return PAGE_SIZES[format];
};
