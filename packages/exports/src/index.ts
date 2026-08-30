import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value) ?? '';
};

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

/** Prefixes spreadsheet formula-like values while keeping phone/SKU/IDs as text. */
export const sanitizeSpreadsheetValue = (value: unknown): string => {
  const stringValue = text(value);
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

const rowValues = (
  row: ExportOrder,
  columns: readonly ExportColumn[],
): Array<string | number | Date> =>
  columns.map((column) => cellValue(pathValue(row, column.key), column));

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
  const body = rows.map((row) => rowValues(row, normalized.columns).map(csvEscape).join(','));
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
  const sheet = workbook.addWorksheet(worksheetName(normalized.name));
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  const headers = normalized.columns.map((column) => sanitizeSpreadsheetValue(column.label));
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };
  for (const [index, column] of normalized.columns.entries()) {
    const cell = headerRow.getCell(index + 1);
    cell.numFmt = '@';
    if (column.type === 'text' || /phone|sku/i.test(column.key)) cell.numFmt = '@';
  }
  for (const row of rows) {
    const excelRow = sheet.addRow(rowValues(row, normalized.columns));
    normalized.columns.forEach((column, index) => {
      const cell = excelRow.getCell(index + 1);
      if (column.type === 'text' || /phone|sku|id|orderNumber/i.test(column.key)) cell.numFmt = '@';
      if (typeof cell.value === 'string') cell.value = sanitizeSpreadsheetValue(cell.value);
    });
  }
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
