import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { egyptianGovernorateName } from '@woo-ops/domain';

export type ExportState = 'never-exported' | 'exported' | 'changed-after-export';
export type ExportFormat = 'csv' | 'xlsx';
export type ExportRowMode = 'order' | 'line' | 'package' | 'carrier';
export type ExportColumnType = 'text' | 'number' | 'date' | 'money';

export type ExportColumn = Readonly<{
  key: string;
  label: string;
  type?: ExportColumnType;
}>;

export type ExportProfile = Readonly<{
  id?: string;
  name: string;
  description?: string;
  version: number;
  format: ExportFormat;
  rowMode: ExportRowMode;
  columns: readonly ExportColumn[];
  filenameTemplate: string;
  config?: Readonly<Record<string, unknown>>;
}>;

export type ExportOrder = Readonly<Record<string, unknown>>;
export type ExportRequest = Readonly<{
  profile: ExportProfile;
  orders: readonly ExportOrder[];
  snapshotId?: string;
  snapshotHash?: string;
  maxRows?: number;
}>;

export type ExportResult = Readonly<{
  bytes: Uint8Array;
  format: ExportFormat;
  filename: string;
  orderCount: number;
  rowCount: number;
  checksum: string;
  snapshotHash: string | null;
}>;

export type ExportChunkResult = Readonly<{
  result: ExportResult;
  cursor: string | null;
  hasMore: boolean;
}>;

export type ExportValidationIssue = Readonly<{
  code: 'required-field-missing';
  key: string;
  rowIndex: number;
}>;

export type ExportPreview = Readonly<{
  columns: readonly ExportColumn[];
  rows: readonly (readonly (string | number)[])[];
  orderCount: number;
  rowCount: number;
  errors: readonly ExportValidationIssue[];
  warnings: readonly string[];
}>;

export const MAX_EXPORT_COLUMNS = 100;
export const MAX_EXPORT_ORDERS = 100_000;
export const MAX_EXPORT_ROWS = 200_000;
export const MAX_EXPORT_CHUNK_ORDERS = 5_000;

const FORMAT_VALUES: readonly ExportFormat[] = ['csv', 'xlsx'];
const ROW_MODE_VALUES: readonly ExportRowMode[] = ['order', 'line', 'package', 'carrier'];
const COLUMN_TYPES: readonly ExportColumnType[] = ['text', 'number', 'date', 'money'];
const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const DANGEROUS_SPREADSHEET_START = /^[=+\-@]/;
const FILE_NAME_PATTERN = /^[\p{L}\p{N}._{}-]+$/u;
const TRANSFORM_VALUES = new Set(['trim', 'uppercase', 'lowercase', 'integer']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value) ?? '';
};

const latinDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));

const assertText = (value: unknown, code: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength)
    throw new Error(code);
  return value.trim();
};

const assertSafePath = (path: string): string => {
  const normalized = assertText(path, 'EXPORT_COLUMN_KEY_INVALID', 180);
  const segments = normalized.split('.');
  if (segments.some((segment) => !/^[A-Za-z0-9_\u0600-\u06ff-]+$/u.test(segment)))
    throw new Error('EXPORT_COLUMN_KEY_INVALID');
  if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment)))
    throw new Error('EXPORT_COLUMN_KEY_INVALID');
  return normalized;
};

const pathValue = (source: unknown, path: string): unknown => {
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return '';
    current = current[segment];
  }
  return current;
};

const majorUnits = (minor: unknown): string => {
  const value = text(minor);
  if (!/^-?\d+$/u.test(value)) return '';
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};

const addMinor = (...values: unknown[]): string => {
  const amounts = values.map(text);
  return amounts.every((value) => /^-?\d+$/u.test(value))
    ? majorUnits(amounts.reduce((sum, value) => sum + BigInt(value), 0n))
    : '';
};

/** Woo's order/line export columns, using immutable normalized order snapshots. */
const wooColumnValue = (row: ExportOrder, key: string): unknown => {
  const line = pathValue(row, 'line');
  const quantity = Number(pathValue(line, 'quantity'));
  const subtotal = pathValue(line, 'subtotalMinor');
  const coupon = Array.isArray(row.couponLines) ? row.couponLines[0] : undefined;
  const fields: Record<string, () => unknown> = {
    orderNumber: () => row.orderNumber,
    orderStatus: () => row.remoteStatus,
    orderDate: () => row.createdAt,
    customerNote: () => row.customerNote,
    billingFirstName: () => pathValue(row, 'billing.first_name'),
    billingLastName: () => pathValue(row, 'billing.last_name'),
    billingCompany: () => pathValue(row, 'billing.company'),
    billingAddress: () =>
      [pathValue(row, 'billing.address_1'), pathValue(row, 'billing.address_2')]
        .filter(Boolean)
        .join(' '),
    billingCity: () => pathValue(row, 'billing.city'),
    billingState: () => pathValue(row, 'billing.state'),
    billingStateName: () => egyptianGovernorateName(pathValue(row, 'billing.state'), 'ar'),
    billingPostcode: () => pathValue(row, 'billing.postcode'),
    billingCountry: () => pathValue(row, 'billing.country'),
    billingEmail: () => pathValue(row, 'billing.email'),
    billingPhone: () => pathValue(row, 'billing.phone'),
    shippingFirstName: () => pathValue(row, 'shipping.first_name'),
    shippingLastName: () => pathValue(row, 'shipping.last_name'),
    shippingAddress: () =>
      [pathValue(row, 'shipping.address_1'), pathValue(row, 'shipping.address_2')]
        .filter(Boolean)
        .join(' '),
    shippingCity: () => pathValue(row, 'shipping.city'),
    shippingState: () => pathValue(row, 'shipping.state'),
    shippingStateName: () => egyptianGovernorateName(pathValue(row, 'shipping.state'), 'ar'),
    shippingPostcode: () => pathValue(row, 'shipping.postcode'),
    shippingCountry: () => pathValue(row, 'shipping.country'),
    paymentTitle: () => row.paymentMethodTitle,
    cartDiscount: () => majorUnits(pathValue(row, 'amounts.discountMinor')),
    cartDiscountInclTax: () =>
      addMinor(
        pathValue(row, 'amounts.discountMinor'),
        Array.isArray(row.couponLines)
          ? row.couponLines.reduce(
              (sum, item) => sum + BigInt(text(pathValue(item, 'discountTaxMinor')) || '0'),
              0n,
            )
          : 0n,
      ),
    orderSubtotal: () => majorUnits(pathValue(row, 'amounts.merchandiseSubtotalMinor')),
    shippingTitle: () => row.shippingMethodTitle,
    shippingAmount: () => majorUnits(pathValue(row, 'amounts.shippingCollectedMinor')),
    refundAmount: () => majorUnits(pathValue(row, 'amounts.refundMinor')),
    orderTotal: () => majorUnits(row.grandTotalMinor),
    orderTax: () => majorUnits(pathValue(row, 'amounts.taxMinor')),
    sku: () => pathValue(line, 'sku'),
    itemNumber: () => pathValue(line, 'externalLineId'),
    itemName: () => pathValue(line, 'name'),
    quantity: () => pathValue(line, 'quantity'),
    itemCost: () =>
      Number.isSafeInteger(quantity) && quantity > 0 && /^-?\d+$/u.test(text(subtotal))
        ? majorUnits(BigInt(text(subtotal)) / BigInt(quantity))
        : '',
    couponCode: () => pathValue(coupon, 'code'),
    discountAmount: () => majorUnits(pathValue(coupon, 'discountMinor')),
    discountTax: () => majorUnits(pathValue(coupon, 'discountTaxMinor')),
  };
  return fields[key]?.() ?? '';
};

/** Prefixes spreadsheet formula-like values while keeping phone/SKU/IDs as text. */
export const sanitizeSpreadsheetValue = (value: unknown): string => {
  const stringValue = latinDigits(text(value));
  return DANGEROUS_SPREADSHEET_START.test(stringValue) ? `'${stringValue}` : stringValue;
};

const cellText = (value: unknown, type: ExportColumnType): string => {
  const valueText = sanitizeSpreadsheetValue(value);
  if (type === 'date' && value instanceof Date) return value.toISOString();
  return valueText;
};

const cellValue = (value: unknown, column: ExportColumn): string | number | Date => {
  const type = column.type ?? 'text';
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'number' && typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  // Money and identifiers remain text. This avoids precision loss and preserves leading zeros.
  return cellText(value, type);
};

const normalizeColumn = (input: ExportColumn): ExportColumn => {
  const type = input.type;
  if (type !== undefined && !COLUMN_TYPES.includes(type))
    throw new Error('EXPORT_COLUMN_TYPE_INVALID');
  return {
    key: assertSafePath(input.key),
    label: assertText(input.label, 'EXPORT_COLUMN_LABEL_INVALID', 160),
    ...(type === undefined ? {} : { type }),
  };
};

const normalizeFileName = (value: string): string => {
  const filename = assertText(value, 'EXPORT_FILENAME_INVALID', 180);
  if (!FILE_NAME_PATTERN.test(filename) || filename.includes('..'))
    throw new Error('EXPORT_FILENAME_INVALID');
  return filename;
};

const normalizeConfigKey = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('EXPORT_CONFIG_INVALID');
  return assertSafePath(value);
};

const normalizeConfigFieldList = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length > MAX_EXPORT_COLUMNS)
    throw new Error('EXPORT_CONFIG_INVALID');
  const keys = value.map(normalizeConfigKey);
  if (new Set(keys).size !== keys.length) throw new Error('EXPORT_CONFIG_INVALID');
  return keys;
};

const normalizeConfigMap = (value: unknown): Record<string, string> => {
  if (!isRecord(value) || Object.keys(value).length > MAX_EXPORT_COLUMNS)
    throw new Error('EXPORT_CONFIG_INVALID');
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeConfigKey(key);
    if (typeof item !== 'string' || item.length > 500) throw new Error('EXPORT_CONFIG_INVALID');
    result[normalizedKey] = item;
  }
  return result;
};

const normalizeTransforms = (value: unknown): Record<string, string> => {
  if (!isRecord(value) || Object.keys(value).length > MAX_EXPORT_COLUMNS)
    throw new Error('EXPORT_CONFIG_INVALID');
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = normalizeConfigKey(key);
    if (typeof item !== 'string' || !TRANSFORM_VALUES.has(item))
      throw new Error('EXPORT_CONFIG_INVALID');
    result[normalizedKey] = item;
  }
  return result;
};

const normalizeConfig = (
  value: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value) || Object.keys(value).length > 8) throw new Error('EXPORT_CONFIG_INVALID');
  const allowed = new Set(['required', 'defaults', 'transforms', 'carrierRequired']);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('EXPORT_CONFIG_INVALID');
  const result: Record<string, unknown> = {};
  if (value.required !== undefined) result.required = normalizeConfigFieldList(value.required);
  if (value.carrierRequired !== undefined)
    result.carrierRequired = normalizeConfigFieldList(value.carrierRequired);
  if (value.defaults !== undefined) result.defaults = normalizeConfigMap(value.defaults);
  if (value.transforms !== undefined) result.transforms = normalizeTransforms(value.transforms);
  const serialized = JSON.stringify(result);
  if (serialized === undefined || serialized.length > 32 * 1024)
    throw new Error('EXPORT_CONFIG_TOO_LARGE');
  return result;
};

export const normalizeExportProfile = (input: ExportProfile): ExportProfile => {
  if (!FORMAT_VALUES.includes(input.format)) throw new Error('EXPORT_FORMAT_INVALID');
  if (!ROW_MODE_VALUES.includes(input.rowMode)) throw new Error('EXPORT_ROW_MODE_INVALID');
  if (!Number.isInteger(input.version) || input.version < 1)
    throw new Error('EXPORT_VERSION_INVALID');
  if (
    !Array.isArray(input.columns) ||
    input.columns.length < 1 ||
    input.columns.length > MAX_EXPORT_COLUMNS
  )
    throw new Error('EXPORT_COLUMNS_INVALID');
  const columns = input.columns.map(normalizeColumn);
  if (new Set(columns.map((column) => column.key)).size !== columns.length)
    throw new Error('EXPORT_COLUMNS_DUPLICATE');
  const config = normalizeConfig(input.config);
  return {
    ...(input.id === undefined ? {} : { id: assertText(input.id, 'EXPORT_ID_INVALID', 256) }),
    name: assertText(input.name, 'EXPORT_PROFILE_NAME_INVALID', 120),
    ...(input.description === undefined
      ? {}
      : { description: assertText(input.description, 'EXPORT_DESCRIPTION_INVALID', 500) }),
    version: input.version,
    format: input.format,
    rowMode: input.rowMode,
    columns,
    filenameTemplate: normalizeFileName(input.filenameTemplate),
    ...(config === undefined ? {} : { config }),
  };
};

export const createExportProfile = (input: Omit<ExportProfile, 'version'>): ExportProfile =>
  normalizeExportProfile({ ...input, version: 1 });

const withRowContext = (order: ExportOrder, line: unknown, index: number): ExportOrder => ({
  ...order,
  line: isRecord(line) ? line : { value: line },
  lineIndex: index,
});

const rowsForOrder = (order: ExportOrder, rowMode: ExportRowMode): ExportOrder[] => {
  if (rowMode === 'order') return [order];
  if (rowMode === 'line') {
    const lines = Array.isArray(order.lines) ? order.lines : [];
    return lines.length === 0
      ? [withRowContext(order, {}, 0)]
      : lines.map((line, i) => withRowContext(order, line, i));
  }
  const packages = Array.isArray(order.packages) ? order.packages : [];
  if (packages.length > 0) return packages.map((item, i) => withRowContext(order, item, i));
  if (rowMode === 'carrier') {
    const carrier = pathValue(order, 'shippingMethod.carrier');
    return [withRowContext(order, isRecord(carrier) ? carrier : { carrier }, 0)];
  }
  return [withRowContext(order, {}, 0)];
};

export const materializeRows = (
  orders: readonly ExportOrder[],
  profile: ExportProfile,
  maxRows = MAX_EXPORT_ROWS,
): ExportOrder[] => {
  const normalized = normalizeExportProfile(profile);
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_EXPORT_ROWS)
    throw new Error('EXPORT_ROW_LIMIT_INVALID');
  if (orders.length > MAX_EXPORT_ORDERS) throw new Error('EXPORT_ORDER_LIMIT_EXCEEDED');
  const rows: ExportOrder[] = [];
  for (const order of orders) {
    if (!isRecord(order)) throw new Error('EXPORT_ORDER_INVALID');
    for (const row of rowsForOrder(order, normalized.rowMode)) {
      rows.push(row);
      if (rows.length > maxRows) throw new Error('EXPORT_ROW_LIMIT_EXCEEDED');
    }
  }
  return rows;
};

const configuredValue = (
  row: ExportOrder,
  column: ExportColumn,
  profile: ExportProfile,
): unknown => {
  let value = column.key.startsWith('woo.')
    ? wooColumnValue(row, column.key.slice(4))
    : pathValue(row, column.key);
  if (/(?:^|\.)(?:state|stateCode|governorate)$/iu.test(column.key)) {
    value = egyptianGovernorateName(value, 'ar');
  }
  const config = profile.config;
  const defaults = config && isRecord(config.defaults) ? config.defaults : undefined;
  if ((value === undefined || value === null || value === '') && defaults)
    value = defaults[column.key];
  const transforms = config && isRecord(config.transforms) ? config.transforms : undefined;
  const transform = transforms?.[column.key];
  const stringValue = typeof value === 'string' ? value : null;
  if (typeof transform === 'string' && stringValue !== null) {
    if (transform === 'trim') value = stringValue.trim();
    if (transform === 'uppercase') value = stringValue.toUpperCase();
    if (transform === 'lowercase') value = stringValue.toLowerCase();
    if (transform === 'integer' && /^-?\d+$/.test(stringValue)) value = stringValue;
  }
  return value;
};

const rowValues = (
  row: ExportOrder,
  columns: readonly ExportColumn[],
  profile: ExportProfile,
): Array<string | number | Date> =>
  columns.map((column) => cellValue(configuredValue(row, column, profile), column));

const assertRowCount = (count: number): void => {
  if (!Number.isInteger(count) || count > MAX_EXPORT_ROWS)
    throw new Error('EXPORT_ROW_LIMIT_EXCEEDED');
};

const csvEscape = (value: string | number | Date): string => {
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
};

export const generateCsv = (rows: readonly ExportOrder[], profile: ExportProfile): Uint8Array => {
  const normalized = normalizeExportProfile({ ...profile, format: 'csv' });
  assertRowCount(rows.length);
  const headers = normalized.columns.map((column) =>
    csvEscape(sanitizeSpreadsheetValue(column.label)),
  );
  const body = rows.map((row) =>
    rowValues(row, normalized.columns, normalized).map(csvEscape).join(','),
  );
  return new TextEncoder().encode(`\uFEFF${headers.join(',')}\r\n${body.join('\r\n')}\r\n`);
};

const worksheetName = (name: string): string => {
  const safe = name.replace(/[\\/*?:[\]]/g, ' ').trim();
  return (safe || 'Orders').slice(0, 31);
};

export const generateXlsx = async (
  rows: readonly ExportOrder[],
  profile: ExportProfile,
): Promise<Uint8Array> => {
  const normalized = normalizeExportProfile({ ...profile, format: 'xlsx' });
  assertRowCount(rows.length);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Woo Ops';
  workbook.lastModifiedBy = 'Woo Ops';
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = false;
  const arabic = normalized.columns.some((column) => /[\u0600-\u06ff]/u.test(column.label));
  const arabicSheetName = /shipping|شحن/iu.test(normalized.name) ? 'طلبات الشحن' : 'الطلبات';
  const sheet = workbook.addWorksheet(worksheetName(arabic ? arabicSheetName : normalized.name));
  sheet.views = [{ state: 'frozen', ySplit: 1, rightToLeft: arabic }];
  const headers = normalized.columns.map((column) => sanitizeSpreadsheetValue(column.label));
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.font = { name: 'Arial', bold: true, color: { argb: 'FF263238' }, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  for (const [index, column] of normalized.columns.entries()) {
    const cell = headerRow.getCell(index + 1);
    cell.numFmt = '@';
    if (column.type === 'text' || /phone|sku/i.test(column.key)) cell.numFmt = '@';
  }
  for (const row of rows) {
    const excelRow = sheet.addRow(rowValues(row, normalized.columns, normalized));
    normalized.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      if (column.type === 'text' || /phone|sku|id|orderNumber/i.test(column.key)) cell.numFmt = '@';
      if (typeof cell.value === 'string') cell.value = sanitizeSpreadsheetValue(cell.value);
    });
  }
  normalized.columns.forEach((column, index) => {
    const values = [
      column.label,
      ...rows.slice(0, 500).map((row) => configuredValue(row, column, normalized)),
    ];
    const longest = values.reduce<number>((maximum, value) => {
      const length =
        value instanceof Date ? 20 : String(value ?? '').replace(/[\r\n]+/gu, ' ').length;
      return Math.max(maximum, length);
    }, 0);
    const contentCap = /address|note/iu.test(column.key)
      ? 38
      : /(?:item|line).*name/iu.test(column.key)
        ? 34
        : 26;
    sheet.getColumn(index + 1).width = Math.min(contentCap, Math.max(10, longest + 2));
    sheet.getColumn(index + 1).alignment = {
      vertical: 'top',
      ...(arabic && column.type === 'text' ? { horizontal: 'right' } : {}),
      wrapText: /address|(?:item|line)\.?(?:name)?|note/iu.test(column.key),
    };
  });
  sheet.autoFilter = {
    from: 'A1',
    to: `${columnName(normalized.columns.length)}${rows.length + 1}`,
  };
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
};

const columnName = (index: number): string => {
  let value = index;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result || 'A';
};

const snapshotHash = (request: ExportRequest): string | null => {
  if (request.snapshotHash !== undefined) {
    if (!/^[a-f0-9]{64}$/i.test(request.snapshotHash))
      throw new Error('EXPORT_SNAPSHOT_HASH_INVALID');
    return request.snapshotHash.toLowerCase();
  }
  if (request.snapshotId === undefined) return null;
  return createHash('sha256').update(request.snapshotId).digest('hex');
};

const filename = (template: string, format: ExportFormat): string => {
  const extension = `.${format}`;
  const rendered = template.replaceAll('{format}', format).replaceAll('{date}', 'export');
  return normalizeFileName(rendered.endsWith(extension) ? rendered : `${rendered}${extension}`);
};

export const generateExport = async (request: ExportRequest): Promise<ExportResult> => {
  const profile = normalizeExportProfile(request.profile);
  const maxRows = request.maxRows ?? MAX_EXPORT_ROWS;
  const rows = materializeRows(request.orders, profile, maxRows);
  assertRequiredFields(rows, profile);
  const bytes =
    profile.format === 'csv' ? generateCsv(rows, profile) : await generateXlsx(rows, profile);
  return {
    bytes,
    format: profile.format,
    filename: filename(profile.filenameTemplate, profile.format),
    orderCount: request.orders.length,
    rowCount: rows.length,
    checksum: createHash('sha256').update(bytes).digest('hex'),
    snapshotHash: snapshotHash(request),
  };
};

const requiredKeys = (profile: ExportProfile): readonly string[] => {
  const config = profile.config;
  const configured = config && Array.isArray(config.required) ? config.required : [];
  const carrier = config && Array.isArray(config.carrierRequired) ? config.carrierRequired : [];
  return profile.rowMode === 'carrier' ? [...configured, ...carrier] : configured;
};

const assertRequiredFields = (rows: readonly ExportOrder[], profile: ExportProfile): void => {
  const keys = requiredKeys(profile);
  for (const [rowIndex, row] of rows.entries()) {
    for (const key of keys) {
      const value = configuredValue(row, { key, label: key }, profile);
      if (value === undefined || value === null || String(value).trim() === '')
        throw new Error('EXPORT_REQUIRED_FIELD_MISSING');
    }
  }
};

export const previewExport = (
  request: ExportRequest,
  maxOrders = 100,
  maxRows = 500,
): ExportPreview => {
  if (!Number.isInteger(maxOrders) || maxOrders < 1 || maxOrders > 1_000)
    throw new Error('EXPORT_PREVIEW_LIMIT_INVALID');
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 5_000)
    throw new Error('EXPORT_PREVIEW_LIMIT_INVALID');
  const profile = normalizeExportProfile(request.profile);
  const orders = request.orders.slice(0, maxOrders);
  const rows = materializeRows(orders, profile, maxRows);
  const errors: ExportValidationIssue[] = [];
  const keys = requiredKeys(profile);
  for (const [rowIndex, row] of rows.entries()) {
    for (const key of keys) {
      const value = configuredValue(row, { key, label: key }, profile);
      if (value === undefined || value === null || String(value).trim() === '')
        errors.push({ code: 'required-field-missing', key, rowIndex });
    }
  }
  return {
    columns: profile.columns,
    rows: rows.map((row) =>
      rowValues(row, profile.columns, profile).map((value) =>
        value instanceof Date ? value.toISOString() : value,
      ),
    ),
    orderCount: orders.length,
    rowCount: rows.length,
    errors,
    warnings: request.orders.length > maxOrders ? ['PREVIEW_TRUNCATED'] : [],
  };
};

/** Generate a bounded page that can be resumed with the returned cursor. */
export const generateExportChunk = async (
  request: ExportRequest,
  cursor = 0,
  chunkSize = MAX_EXPORT_CHUNK_ORDERS,
): Promise<ExportChunkResult> => {
  if (!Number.isInteger(cursor) || cursor < 0) throw new Error('EXPORT_CURSOR_INVALID');
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_EXPORT_CHUNK_ORDERS)
    throw new Error('EXPORT_CHUNK_SIZE_INVALID');
  if (cursor > request.orders.length) throw new Error('EXPORT_CURSOR_INVALID');
  const end = Math.min(request.orders.length, cursor + chunkSize);
  const result = await generateExport({ ...request, orders: request.orders.slice(cursor, end) });
  return {
    result,
    cursor: end < request.orders.length ? String(end) : null,
    hasMore: end < request.orders.length,
  };
};
