import Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { validateSafeTemplate } from '@woo-ops/documents';
import {
  calculateOrderMetrics,
  dateKeyInTimezone,
  dimensionsFingerprint,
  metricDefinitions,
} from '@woo-ops/analytics';
import type {
  AnalyticsSource,
  CostRule,
  CostRuleScope,
  MetricTotals,
  OrderMetricResult,
} from '@woo-ops/analytics';
import { DURABLE_JOB_TYPES } from '@woo-ops/application';
import type { DurableJob, DurableJobType } from '@woo-ops/application';

export type AccountRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type AccountContext = Readonly<{
  accountId: string;
  actorId?: string;
  correlationId: string;
  role?: AccountRole;
}>;
export type JobSummary = Omit<DurableJob, 'payload'>;
export type JobUsage = Readonly<{
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  payloadBytes: number;
  byType: readonly {
    type: string;
    total: number;
    queued: number;
    running: number;
    deadLettered: number;
  }[];
}>;
export type CatalogItem = {
  identity: string;
  kind: 'product' | 'variation' | 'category' | 'tag' | 'shipping_class';
  externalId: string;
  parentExternalId: string | null;
  name: string;
  sku: string | null;
  sourceJson: string;
};
export type NormalizedOrderInput = {
  externalOrderId: string;
  orderNumber: string;
  remoteStatus: string;
  currency: string;
  grandTotalMinor: string;
  createdAt: string | null;
  modifiedAt: string | null;
  customer: unknown;
  billing: unknown;
  shipping: unknown;
  lines: readonly unknown[];
  refunds: readonly { externalRefundId: string; amountMinor: string; reason: unknown }[];
  sourceJson: string;
  sourceHash: string;
};
export type ManualOrderLineInput = {
  name: string;
  sku?: string;
  productId?: string;
  variationId?: string;
  quantity: number;
  unitPriceMinor: string;
  discountMinor?: string;
  taxMinor?: string;
  notes?: string;
};
export type ManualOrderInput = {
  currency: string;
  customer?: Record<string, unknown>;
  billing?: Record<string, unknown>;
  shipping?: Record<string, unknown>;
  payment?: Record<string, unknown>;
  shippingMethod?: Record<string, unknown>;
  lines: readonly ManualOrderLineInput[];
  shippingCollectedMinor?: string;
  taxMinor?: string;
  discountMinor?: string;
  feesMinor?: string;
  localStatus?: string;
  tags?: readonly string[];
  notes?: string;
  assigneeId?: string | null;
};
export type ManualOrderPatch = Partial<Omit<ManualOrderInput, 'lines'>> & {
  lines?: readonly ManualOrderLineInput[];
  version: number;
};
export type CostRuleRecord = CostRule & {
  accountId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type OrderCostSnapshotRecord = {
  id: string;
  accountId: string;
  orderId: string;
  lineId: string;
  ruleId: string | null;
  currency: string;
  source: string;
  effectiveAt: string | null;
  quantity: number;
  unitCostMinor: string;
  totalCostMinor: string;
  sourceHash: string | null;
  createdAt: string;
};
export type DailyAnalyticsFactRecord = {
  accountId: string;
  date: string;
  currency: string;
  source: Exclude<AnalyticsSource, 'combined'>;
  dimensions: Record<string, unknown>;
  orderCount: number;
  lineCount: number;
  totals: MetricTotals;
  metricsVersion: number;
  rebuiltAt: string;
};
export type AnalyticsFilter = {
  from?: string;
  to?: string;
  source?: AnalyticsSource;
  currency?: string;
  store?: string;
  status?: string;
  shippingMethod?: string;
  product?: string;
  category?: string;
  author?: string;
};
export type AnalyticsRebuildResult = {
  from: string | null;
  to: string | null;
  factsWritten: number;
  ordersIncluded: number;
  ordersExcluded: number;
  snapshotsWritten: number;
  rebuiltAt: string;
};
export type OrderFilter =
  | { op: 'and' | 'or'; children: readonly OrderFilter[] }
  | { field: OrderFilterField; operator: string; value?: unknown };
export type OrderFilterField =
  | 'orderNumber'
  | 'externalOrderId'
  | 'remoteStatus'
  | 'localStatus'
  | 'exportState'
  | 'origin'
  | 'currency'
  | 'connectionId'
  | 'remoteCreatedAt'
  | 'grandTotalMinor';
export type OrderQueryInput = {
  search?: string;
  filter?: OrderFilter;
  cursor?: string | null;
  limit?: number;
  sort?: {
    field: 'remoteCreatedAt' | 'updatedAt' | 'orderNumber' | 'grandTotalMinor' | 'id';
    direction: 'asc' | 'desc';
  };
};
export type OrderSort = NonNullable<OrderQueryInput['sort']>;
export type OrderQueryResult = {
  items: readonly Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
};
export type MetadataSensitivity = 'safe' | 'private' | 'unknown';
export type MetadataType = 'text' | 'number' | 'money' | 'boolean' | 'date' | 'enum' | 'entity';
export type MetadataEntry = {
  sourceKey: string;
  scope: string;
  sensitivity: MetadataSensitivity;
  inferredType: MetadataType | 'unknown';
  occurrences: number;
  sample: unknown;
};
export type FieldMapping = {
  id: string;
  sourceKey: string;
  label: string;
  type: MetadataType;
  targetFacet: string | null;
  version: number;
};

export type SelectionMode = 'explicit' | 'query';
export type SelectionQuery = { orderIds: readonly string[] } | OrderQueryInput;
export type SelectionSnapshot = {
  id: string;
  accountId: string;
  createdBy: string;
  mode: SelectionMode;
  query: SelectionQuery;
  exclusions: readonly string[];
  watermark: string;
  estimatedCount: number;
  expiresAt: string;
  createdAt: string;
};
export type SelectionPage = {
  items: readonly string[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount: number;
};
export type SavedViewVisibility = 'private' | 'shared';
export type SavedView = {
  id: string;
  accountId: string;
  userId: string;
  name: string;
  query: OrderQueryInput;
  sort: OrderSort | null;
  columns: readonly string[];
  pageSize: number;
  visibility: SavedViewVisibility;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type BulkAction =
  | 'update-local-status'
  | 'assign'
  | 'add-tag'
  | 'remove-tag'
  | 'mark-export-ready'
  | 'create-export'
  | 'generate-invoice'
  | 'generate-thermal'
  | 'generate-label'
  | 'print-documents'
  | 'resync';
export type BulkJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'partial' | 'cancelled';
export type BulkItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type BulkJobSummary = {
  id: string;
  accountId: string;
  selectionId: string;
  action: BulkAction;
  status: BulkJobStatus;
  progress: number;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  idempotencyKey: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
export type BulkJobItem = {
  jobId: string;
  orderId: string;
  status: BulkItemStatus;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
};
export type BulkPreview = {
  selectionId: string;
  action: BulkAction;
  estimatedCount: number;
  currentCount: number;
  watermark: string;
  expiresAt: string;
  currencies: readonly string[];
  stores: readonly string[];
  warnings: readonly string[];
};
export type ExportFormat = 'csv' | 'xlsx';
export type ExportRowMode = 'order' | 'line' | 'package' | 'carrier';
export type ExportColumn = Readonly<{
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'money';
}>;
export type ExportProfile = Readonly<{
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}>;
export type ExportProfileVersion = Readonly<{
  id: string;
  accountId: string;
  profileId: string;
  version: number;
  format: ExportFormat;
  rowMode: ExportRowMode;
  columns: readonly ExportColumn[];
  filenameTemplate: string;
  config: Readonly<Record<string, unknown>>;
  createdBy: string;
  createdAt: string;
}>;
export type ExportBatchStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ExportBatch = Readonly<{
  id: string;
  accountId: string;
  selectionId: string;
  profileVersionId: string;
  format: ExportFormat;
  rowMode: ExportRowMode;
  status: ExportBatchStatus;
  watermark: string;
  orderCount: number;
  rowCount: number;
  filename: string | null;
  filePath: string | null;
  checksum: string | null;
  createdBy: string;
  idempotencyKey: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}>;
export type ExportEventType = 'exported' | 'unexported';
export type OrderExportEvent = Readonly<{
  id: string;
  accountId: string;
  orderId: string;
  batchId: string | null;
  type: ExportEventType;
  snapshotHash: string | null;
  reason: string | null;
  createdBy: string;
  createdAt: string;
}>;
export type DocumentTemplateFormat = 'a4' | 'a5' | 'thermal-80mm' | 'label-100x150mm';
export type DocumentTemplateRecord = Readonly<{
  id: string;
  accountId: string;
  name: string;
  format: DocumentTemplateFormat;
  locale: 'ar-EG' | 'en-US';
  direction: 'rtl' | 'ltr';
  version: number;
  body: string;
  companyName: string;
  companyAddress: string | null;
  footerText: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}>;
export type DocumentFileRecord = Readonly<{
  id: string;
  accountId: string;
  orderId: string;
  templateId: string;
  format: DocumentTemplateFormat;
  relativePath: string;
  filename: string;
  mimeType: 'application/pdf';
  byteSize: number;
  checksum: string;
  createdBy: string;
  createdAt: string;
}>;
export type AccountRecord = Readonly<{
  id: string;
  name: string;
  locale: 'ar-EG' | 'en-US';
  direction: 'rtl' | 'ltr';
  timezone: string;
  baseCurrency: string;
}>;
export type MemberRecord = Readonly<{
  userId: string;
  email: string;
  role: AccountRole;
  status: 'active' | 'revoked';
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}>;
export type InvitationRecord = Readonly<{
  id: string;
  email: string;
  role: Exclude<AccountRole, 'owner' | 'revoked'>;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  acceptToken?: string;
}>;
export type SessionRecord = Readonly<{
  id: string;
  userId: string;
  email: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
}>;
export type StoreHealth = Readonly<{
  database: 'connected' | 'degraded';
  schemaVersion: number;
  queue: { queued: number; running: number; deadLettered: number };
}>;

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item, depth + 1),
    );
  }
  return false;
};

const serializeBoundedJson = (payload: unknown, maxLength: number, errorCode: string): string => {
  if (!isJsonValue(payload)) throw new Error(errorCode.replace('TOO_LARGE', 'INVALID'));
  const serialized = JSON.stringify(payload);
  if (typeof serialized !== 'string' || serialized.length > maxLength) throw new Error(errorCode);
  return serialized;
};
const serializeJobPayload = (payload: unknown): string =>
  serializeBoundedJson(payload, 64 * 1024, 'JOB_PAYLOAD_TOO_LARGE');

const parseManualMinor = (value: unknown, code = 'MANUAL_ORDER_AMOUNT_INVALID'): bigint => {
  if (typeof value !== 'string' || !/^-?\d{1,18}$/.test(value)) throw new Error(code);
  const amount = BigInt(value);
  if (amount < 0n) throw new Error(code);
  return amount;
};
const manualMinorText = (amount: bigint): string => amount.toString();
const manualText = (value: unknown, code: string, maxLength: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new Error(code);
  return value.trim();
};
const manualJsonObject = (value: unknown, code: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(code);
  serializeBoundedJson(value, 128 * 1024, code.replace('INVALID', 'TOO_LARGE'));
  return value;
};
type NormalizedManualOrder = {
  currency: string;
  customer: Record<string, unknown>;
  billing: Record<string, unknown>;
  shipping: Record<string, unknown>;
  payment: Record<string, unknown>;
  shippingMethod: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  amounts: Record<string, string>;
  localStatus: string;
  tags: string[];
  notes: string;
  assigneeId: string | null;
};
const normalizeManualOrder = (input: ManualOrderInput): NormalizedManualOrder => {
  if (!/^[A-Za-z]{3}$/.test(input.currency)) throw new Error('MANUAL_ORDER_CURRENCY_INVALID');
  if (!Array.isArray(input.lines) || input.lines.length < 1 || input.lines.length > 500)
    throw new Error('MANUAL_ORDER_LINES_INVALID');
  const lines: Array<Record<string, unknown>> = [];
  let merchandiseSubtotal = 0n;
  let lineDiscount = 0n;
  let lineTax = 0n;
  for (const [index, line] of input.lines.entries()) {
    if (!isRecord(line)) throw new Error('MANUAL_ORDER_LINE_INVALID');
    const lineRecord = line as Record<string, unknown>;
    const name = manualText(line.name, 'MANUAL_ORDER_LINE_INVALID', 240);
    if (typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 1)
      throw new Error('MANUAL_ORDER_LINE_INVALID');
    if (line.quantity > 100000) throw new Error('MANUAL_ORDER_LINE_INVALID');
    const unitPrice = parseManualMinor(line.unitPriceMinor, 'MANUAL_ORDER_LINE_AMOUNT_INVALID');
    const discount = parseManualMinor(
      line.discountMinor ?? '0',
      'MANUAL_ORDER_LINE_AMOUNT_INVALID',
    );
    const tax = parseManualMinor(line.taxMinor ?? '0', 'MANUAL_ORDER_LINE_AMOUNT_INVALID');
    const subtotal = unitPrice * BigInt(line.quantity);
    if (discount > subtotal) throw new Error('MANUAL_ORDER_DISCOUNT_INVALID');
    const total = subtotal - discount + tax;
    const normalizedLine: Record<string, unknown> = {
      lineId: `manual-line-${index + 1}`,
      name,
      quantity: line.quantity,
      unitPriceMinor: manualMinorText(unitPrice),
      subtotalMinor: manualMinorText(subtotal),
      discountMinor: manualMinorText(discount),
      taxMinor: manualMinorText(tax),
      totalMinor: manualMinorText(total),
    };
    for (const key of ['sku', 'productId', 'variationId', 'notes']) {
      const value = lineRecord[key];
      if (value !== undefined)
        normalizedLine[key] = manualText(value, 'MANUAL_ORDER_LINE_INVALID', 500);
    }
    lines.push(normalizedLine);
    merchandiseSubtotal += subtotal;
    lineDiscount += discount;
    lineTax += tax;
  }
  const orderDiscount = parseManualMinor(input.discountMinor ?? '0');
  const orderTax = parseManualMinor(input.taxMinor ?? '0');
  const shipping = parseManualMinor(input.shippingCollectedMinor ?? '0');
  const fees = parseManualMinor(input.feesMinor ?? '0');
  const totalDiscount = lineDiscount + orderDiscount;
  const merchandiseNet = merchandiseSubtotal - totalDiscount;
  const totalTax = lineTax + orderTax;
  const grandTotal = merchandiseNet + totalTax + shipping + fees;
  const tags = [
    ...new Set((input.tags ?? []).map((tag) => manualText(tag, 'MANUAL_ORDER_TAG_INVALID', 80))),
  ];
  if (tags.length > 50) throw new Error('MANUAL_ORDER_TAG_INVALID');
  const localStatus = input.localStatus
    ? manualText(input.localStatus, 'MANUAL_ORDER_STATUS_INVALID', 80)
    : 'new';
  const notes =
    input.notes === undefined ? '' : manualText(input.notes, 'MANUAL_ORDER_NOTES_INVALID', 5000);
  const assigneeId =
    input.assigneeId === undefined || input.assigneeId === null
      ? null
      : manualText(input.assigneeId, 'MANUAL_ORDER_ASSIGNEE_INVALID', 256);
  return {
    currency: input.currency.toUpperCase(),
    customer: manualJsonObject(input.customer ?? {}, 'MANUAL_ORDER_CUSTOMER_INVALID'),
    billing: manualJsonObject(input.billing ?? {}, 'MANUAL_ORDER_ADDRESS_INVALID'),
    shipping: manualJsonObject(input.shipping ?? {}, 'MANUAL_ORDER_ADDRESS_INVALID'),
    payment: manualJsonObject(input.payment ?? {}, 'MANUAL_ORDER_PAYMENT_INVALID'),
    shippingMethod: manualJsonObject(input.shippingMethod ?? {}, 'MANUAL_ORDER_SHIPPING_INVALID'),
    lines,
    amounts: {
      merchandiseSubtotalMinor: manualMinorText(merchandiseSubtotal),
      discountMinor: manualMinorText(totalDiscount),
      merchandiseNetMinor: manualMinorText(merchandiseNet),
      shippingCollectedMinor: manualMinorText(shipping),
      taxMinor: manualMinorText(totalTax),
      feesMinor: manualMinorText(fees),
      grandTotalMinor: manualMinorText(grandTotal),
      collectedMinor: manualMinorText(grandTotal),
    },
    localStatus,
    tags,
    notes,
    assigneeId,
  };
};

const requireHash = (value: string): string => createHash('sha256').update(value).digest('hex');
const randomId = (): string => randomUUID();
const privateMetadataKey =
  /(password|passwd|secret|token|authorization|api[_-]?key|private[_-]?key|access[_-]?key)/i;
const metadataType = (values: readonly unknown[]): MetadataType | 'unknown' => {
  if (values.length === 0) return 'unknown';
  if (values.every((value) => typeof value === 'boolean')) return 'boolean';
  if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) return 'number';
  if (values.every((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))))
    return 'date';
  if (values.every((value) => typeof value === 'string')) return 'text';
  return 'unknown';
};
const metadataSensitivity = (key: string): MetadataSensitivity =>
  privateMetadataKey.test(key) || key.startsWith('_') ? 'private' : 'safe';
const readMetadata = (source: unknown): Array<{ key: string; value: unknown }> => {
  if (!source || typeof source !== 'object') return [];
  const record = source as Record<string, unknown>;
  if (Array.isArray(record.meta_data))
    return record.meta_data.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const entry = item as Record<string, unknown>;
      return typeof entry.key === 'string'
        ? [{ key: entry.key.slice(0, 120), value: entry.value }]
        : [];
    });
  return Object.entries(record)
    .filter(([key]) => key === 'meta_data')
    .map(([key, value]) => ({ key, value }));
};
export const discoverMetadata = (samples: readonly unknown[], scope = 'order'): MetadataEntry[] => {
  const grouped = new Map<string, unknown[]>();
  for (const sample of samples)
    for (const item of readMetadata(sample))
      grouped.set(item.key, [...(grouped.get(item.key) ?? []), item.value]);
  return [...grouped.entries()].map(([sourceKey, values]) => ({
    sourceKey,
    scope,
    sensitivity: metadataSensitivity(sourceKey),
    inferredType: metadataType(values),
    occurrences: values.length,
    sample: metadataSensitivity(sourceKey) === 'safe' ? values[0] : undefined,
  }));
};
const coerceMappedValue = (value: unknown, type: MetadataType): string | null => {
  if (type === 'text' || type === 'enum' || type === 'entity')
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  if (type === 'number' || type === 'money')
    return (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value))
      ? String(value)
      : null;
  if (type === 'boolean') return typeof value === 'boolean' ? String(value) : null;
  if (type === 'date')
    return typeof value === 'string' && !Number.isNaN(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  return null;
};

const filterColumns: Record<OrderFilterField, string> = {
  orderNumber: 'o.order_number',
  externalOrderId: 'o.external_order_id',
  remoteStatus: 'o.remote_status',
  localStatus: 'o.local_status',
  exportState:
    "CASE WHEN o.stale_export_at IS NOT NULL AND o.export_state = 'exported' THEN 'changed-after-export' ELSE o.export_state END",
  origin: 'o.origin',
  currency: 'o.currency',
  connectionId: 'o.connection_id',
  remoteCreatedAt: 'o.remote_modified_at',
  grandTotalMinor: 'o.grand_total_minor',
};
const allowedOperators: Record<OrderFilterField, readonly string[]> = {
  orderNumber: [
    'equals',
    'not-equals',
    'contains',
    'starts-with',
    'is-empty',
    'is-not-empty',
    'in',
  ],
  externalOrderId: [
    'equals',
    'not-equals',
    'contains',
    'starts-with',
    'is-empty',
    'is-not-empty',
    'in',
  ],
  remoteStatus: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  localStatus: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  exportState: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  origin: ['equals', 'is-any-of'],
  currency: ['equals', 'is-any-of'],
  connectionId: ['equals', 'is-any-of'],
  remoteCreatedAt: [
    'equals',
    'greater-than',
    'greater-or-equal',
    'less-than',
    'less-or-equal',
    'between',
    'is-empty',
    'is-not-empty',
  ],
  grandTotalMinor: [
    'equals',
    'greater-than',
    'greater-or-equal',
    'less-than',
    'less-or-equal',
    'between',
  ],
};
const encodedCursor = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const decodedCursor = (value: string): { sortValue: string; id: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw new Error('ORDER_CURSOR_INVALID');
  }
};

const compileFilter = (
  filter: OrderFilter,
  depth = 0,
): { sql: string; params: (string | number)[] } => {
  if (depth > 10) throw new Error('ORDER_FILTER_TOO_DEEP');
  if (!filter || typeof filter !== 'object') throw new Error('ORDER_FILTER_INVALID');
  if ('op' in filter) {
    if (filter.children.length === 0) throw new Error('ORDER_FILTER_EMPTY_GROUP');
    const children = filter.children.map((child) => compileFilter(child, depth + 1));
    return {
      sql: `(${children.map((child) => child.sql).join(` ${filter.op.toUpperCase()} `)})`,
      params: children.flatMap((child) => child.params),
    };
  }
  if (
    !Object.hasOwn(filterColumns, filter.field) ||
    !allowedOperators[filter.field].includes(filter.operator)
  ) {
    throw new Error('ORDER_FILTER_NOT_ALLOWED');
  }
  const column = filterColumns[filter.field];
  const operator = filter.operator;
  if (operator === 'is-empty') return { sql: `(${column} IS NULL OR ${column} = '')`, params: [] };
  if (operator === 'is-not-empty')
    return { sql: `(${column} IS NOT NULL AND ${column} <> '')`, params: [] };
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (operator === 'in' || operator === 'is-any-of') {
    if (
      values.length === 0 ||
      values.some((value) => typeof value !== 'string' && typeof value !== 'number')
    )
      throw new Error('ORDER_FILTER_VALUE_INVALID');
    return {
      sql: `${column} IN (${values.map(() => '?').join(',')})`,
      params: values as (string | number)[],
    };
  }
  if (operator === 'between') {
    if (
      values.length !== 2 ||
      values.some((value) => typeof value !== 'string' && typeof value !== 'number')
    )
      throw new Error('ORDER_FILTER_VALUE_INVALID');
    return { sql: `${column} BETWEEN ? AND ?`, params: values as (string | number)[] };
  }
  if (typeof filter.value !== 'string' && typeof filter.value !== 'number')
    throw new Error('ORDER_FILTER_VALUE_INVALID');
  if (operator === 'contains' || operator === 'starts-with') {
    const value = String(filter.value);
    return {
      sql: `${column} LIKE ?`,
      params: [operator === 'contains' ? `%${value}%` : `${value}%`],
    };
  }
  const operators: Record<string, string> = {
    equals: '=',
    'not-equals': '<>',
    'greater-than': '>',
    'greater-or-equal': '>=',
    'less-than': '<',
    'less-or-equal': '<=',
  };
  const sqlOperator = operators[operator];
  if (!sqlOperator) throw new Error('ORDER_FILTER_NOT_ALLOWED');
  return { sql: `${column} ${sqlOperator} ?`, params: [filter.value] };
};

export const schemaVersion = 15;

type Migration = { version: number; name: string; sql: string };
const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'core-account-and-jobs',
    sql: `
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'ar-EG', direction TEXT NOT NULL DEFAULT 'rtl'
          CHECK (direction IN ('rtl', 'ltr')), timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
        base_currency TEXT NOT NULL DEFAULT 'EGP', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE account_memberships (account_id TEXT NOT NULL REFERENCES accounts(id),
        user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL
          CHECK (role IN ('owner', 'admin', 'operator', 'viewer')), created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, user_id));
      CREATE TABLE jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        type TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead-lettered')),
        attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, type, idempotency_key));
      CREATE INDEX jobs_account_status_created ON jobs(account_id, status, created_at);
    `,
  },
  {
    version: 2,
    name: 'operational-order-foundation',
    sql: `
      CREATE TABLE connections (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        platform TEXT NOT NULL, store_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
        encrypted_credentials TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, platform, store_url));
      CREATE TABLE orders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        connection_id TEXT REFERENCES connections(id), origin TEXT NOT NULL CHECK (origin IN ('woo', 'manual')),
        order_number TEXT NOT NULL, external_order_id TEXT, remote_status TEXT,
        local_status TEXT NOT NULL DEFAULT 'new', export_state TEXT NOT NULL DEFAULT 'never-exported',
        currency TEXT NOT NULL, grand_total_minor TEXT NOT NULL, source_hash TEXT,
        remote_modified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, order_number), UNIQUE (account_id, connection_id, external_order_id));
      CREATE INDEX orders_account_remote_modified ON orders(account_id, remote_modified_at, id);
      CREATE INDEX orders_account_local_export ON orders(account_id, local_status, export_state);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        actor_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
        summary_json TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX audit_account_created ON audit_events(account_id, created_at, id);
    `,
  },
  {
    version: 3,
    name: 'secure-sessions',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT NOT NULL REFERENCES accounts(id),
        token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX sessions_user_active ON sessions(user_id, revoked_at, expires_at);
      CREATE INDEX sessions_account_active ON sessions(account_id, revoked_at, expires_at);
    `,
  },
  {
    version: 4,
    name: 'woocommerce-authorization-states',
    sql: `CREATE TABLE authorization_states (
      state_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), user_id TEXT NOT NULL REFERENCES users(id),
      store_url TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    ); CREATE INDEX authorization_states_expiry ON authorization_states(expires_at, used_at);`,
  },
  {
    version: 5,
    name: 'durable-job-and-webhook-state',
    sql: `
      ALTER TABLE jobs ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE jobs ADD COLUMN available_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN lease_until TEXT;
      ALTER TABLE jobs ADD COLUMN last_error TEXT;
      ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX jobs_claimable ON jobs(account_id, status, available_at, created_at);
      CREATE TABLE webhook_inbox (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        delivery_key TEXT NOT NULL, topic TEXT NOT NULL, body_checksum TEXT NOT NULL, raw_body BLOB NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'processing', 'processed', 'failed', 'dead-lettered')),
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, received_at TEXT NOT NULL, processed_at TEXT,
        UNIQUE (account_id, connection_id, delivery_key)
      );
      CREATE INDEX webhook_inbox_account_status ON webhook_inbox(account_id, status, received_at);
    `,
  },
  {
    version: 6,
    name: 'catalog-sync-state',
    sql: `
      ALTER TABLE connections ADD COLUMN catalog_cursor TEXT;
      ALTER TABLE connections ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'idle';
      ALTER TABLE connections ADD COLUMN catalog_last_error TEXT;
      ALTER TABLE connections ADD COLUMN catalog_last_success TEXT;
      ALTER TABLE connections ADD COLUMN catalog_deleted_count INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE catalog_items (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        kind TEXT NOT NULL CHECK (kind IN ('product', 'variation', 'category', 'tag', 'shipping_class')),
        external_id TEXT NOT NULL, parent_external_id TEXT, name TEXT NOT NULL, sku TEXT,
        source_json TEXT NOT NULL, source_hash TEXT NOT NULL, remote_modified_at TEXT,
        remote_deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, connection_id, kind, external_id)
      );
      CREATE INDEX catalog_items_account_connection ON catalog_items(account_id, connection_id, kind, remote_deleted_at);
      CREATE TABLE catalog_sync_runs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        cursor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        pages INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
        error_code TEXT, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE INDEX catalog_sync_runs_account ON catalog_sync_runs(account_id, connection_id, started_at);
    `,
  },
  {
    version: 7,
    name: 'normalized-order-sync',
    sql: `
      ALTER TABLE orders ADD COLUMN remote_payload_json TEXT;
      ALTER TABLE orders ADD COLUMN normalized_json TEXT;
      ALTER TABLE orders ADD COLUMN remote_deleted_at TEXT;
      ALTER TABLE orders ADD COLUMN stale_export_at TEXT;
      CREATE TABLE order_refunds (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL REFERENCES orders(id),
        external_refund_id TEXT NOT NULL, amount_minor TEXT NOT NULL, reason TEXT, source_json TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(account_id, order_id, external_refund_id)
      );
      CREATE INDEX order_refunds_account_order ON order_refunds(account_id, order_id);
      CREATE TABLE order_sync_runs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        cursor TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        pages INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, error_code TEXT,
        started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE INDEX order_sync_runs_account ON order_sync_runs(account_id, connection_id, started_at);
    `,
  },
  {
    version: 8,
    name: 'metadata-discovery-and-mappings',
    sql: `
      CREATE TABLE field_catalogs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        scope TEXT NOT NULL, source_key TEXT NOT NULL, sensitivity TEXT NOT NULL CHECK(sensitivity IN ('safe', 'private', 'unknown')),
        inferred_type TEXT NOT NULL, occurrences INTEGER NOT NULL DEFAULT 0, sample_json TEXT, discovered_at TEXT NOT NULL,
        UNIQUE(account_id, connection_id, scope, source_key)
      );
      CREATE INDEX field_catalogs_account_safe ON field_catalogs(account_id, connection_id, sensitivity, scope);
      CREATE TABLE field_mappings (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        source_key TEXT NOT NULL, label TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('text', 'number', 'money', 'boolean', 'date', 'enum', 'entity')),
        target_facet TEXT, version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(account_id, connection_id, source_key)
      );
      CREATE INDEX field_mappings_account_active ON field_mappings(account_id, connection_id, active);
      CREATE TABLE order_mapped_fields (
        account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL REFERENCES orders(id), mapping_id TEXT NOT NULL REFERENCES field_mappings(id),
        value_text TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(account_id, order_id, mapping_id)
      );
      CREATE INDEX order_mapped_fields_lookup ON order_mapped_fields(account_id, mapping_id, value_text);
    `,
  },
  {
    version: 9,
    name: 'selections-saved-views-and-bulk-jobs',
    sql: `
      CREATE TABLE selection_snapshots (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), created_by TEXT NOT NULL REFERENCES users(id),
        mode TEXT NOT NULL CHECK(mode IN ('explicit', 'query')), query_json TEXT NOT NULL,
        query_hash TEXT NOT NULL, exclusions_json TEXT NOT NULL DEFAULT '[]', watermark TEXT NOT NULL,
        estimated_count INTEGER NOT NULL CHECK(estimated_count >= 0), expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(account_id, id)
      );
      CREATE INDEX selection_snapshots_account_expiry ON selection_snapshots(account_id, expires_at, created_at);
      CREATE TABLE saved_views (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL, query_json TEXT NOT NULL, sort_json TEXT, columns_json TEXT NOT NULL,
        page_size INTEGER NOT NULL CHECK(page_size BETWEEN 1 AND 100),
        visibility TEXT NOT NULL CHECK(visibility IN ('private', 'shared')), version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(account_id, user_id, name)
      );
      CREATE INDEX saved_views_account_visibility ON saved_views(account_id, visibility, updated_at);
      CREATE UNIQUE INDEX orders_account_id_id ON orders(account_id, id);
      CREATE TABLE bulk_jobs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), selection_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('update-local-status', 'assign', 'add-tag', 'remove-tag', 'mark-export-ready', 'create-export', 'generate-invoice', 'generate-thermal', 'generate-label', 'print-documents', 'resync')),
        parameters_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled')),
        progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100), total_count INTEGER NOT NULL CHECK(total_count >= 0),
        succeeded_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, cancelled_count INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), cancel_requested INTEGER NOT NULL DEFAULT 0,
        last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(account_id, action, idempotency_key), UNIQUE(account_id, id),
        FOREIGN KEY(account_id, selection_id) REFERENCES selection_snapshots(account_id, id)
      );
      CREATE INDEX bulk_jobs_account_status ON bulk_jobs(account_id, status, updated_at);
      CREATE TABLE bulk_job_items (
        account_id TEXT NOT NULL REFERENCES accounts(id), job_id TEXT NOT NULL, order_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL,
        PRIMARY KEY(account_id, job_id, order_id),
        FOREIGN KEY(account_id, job_id) REFERENCES bulk_jobs(account_id, id),
        FOREIGN KEY(account_id, order_id) REFERENCES orders(account_id, id)
      );
      CREATE INDEX bulk_job_items_retry ON bulk_job_items(account_id, job_id, status, updated_at);
    `,
  },
  {
    version: 10,
    name: 'manual-orders-and-local-workflow',
    sql: `
      ALTER TABLE accounts ADD COLUMN manual_order_sequence INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE orders ADD COLUMN assignee_id TEXT;
      ALTER TABLE orders ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE orders ADD COLUMN notes_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
      CREATE INDEX orders_account_assignee ON orders(account_id, assignee_id, local_status);
    `,
  },
  {
    version: 11,
    name: 'versioned-export-profiles-and-batches',
    sql: `
      CREATE TABLE export_profiles (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), name TEXT NOT NULL,
        description TEXT, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(account_id, name)
      );
      CREATE UNIQUE INDEX export_profiles_account_id ON export_profiles(account_id, id);
      CREATE TABLE export_profile_versions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), profile_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 1), format TEXT NOT NULL CHECK(format IN ('csv', 'xlsx')),
        row_mode TEXT NOT NULL CHECK(row_mode IN ('order', 'line', 'package', 'carrier')),
        columns_json TEXT NOT NULL, filename_template TEXT NOT NULL, config_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
        UNIQUE(account_id, profile_id, version),
        FOREIGN KEY(account_id, profile_id) REFERENCES export_profiles(account_id, id)
      );
      CREATE UNIQUE INDEX export_profile_versions_account_id ON export_profile_versions(account_id, id);
      CREATE INDEX export_profile_versions_account_profile ON export_profile_versions(account_id, profile_id, version DESC);
      CREATE TABLE export_batches (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), selection_id TEXT NOT NULL,
        profile_version_id TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('csv', 'xlsx')),
        row_mode TEXT NOT NULL CHECK(row_mode IN ('order', 'line', 'package', 'carrier')),
        status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed')),
        watermark TEXT NOT NULL, order_count INTEGER NOT NULL DEFAULT 0 CHECK(order_count >= 0),
        row_count INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0), filename TEXT, file_path TEXT,
        checksum TEXT, created_by TEXT NOT NULL REFERENCES users(id), idempotency_key TEXT NOT NULL,
        error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
        UNIQUE(account_id, idempotency_key), UNIQUE(account_id, id),
        FOREIGN KEY(account_id, selection_id) REFERENCES selection_snapshots(account_id, id),
        FOREIGN KEY(account_id, profile_version_id) REFERENCES export_profile_versions(account_id, id)
      );
      CREATE INDEX export_batches_account_status ON export_batches(account_id, status, updated_at, id);
    `,
  },
  {
    version: 12,
    name: 'append-only-order-export-events',
    sql: `
      CREATE TABLE order_export_events (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL,
        batch_id TEXT, event_type TEXT NOT NULL CHECK(event_type IN ('exported', 'unexported')),
        snapshot_hash TEXT, reason TEXT, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
        FOREIGN KEY(account_id, order_id) REFERENCES orders(account_id, id),
        FOREIGN KEY(account_id, batch_id) REFERENCES export_batches(account_id, id)
      );
      CREATE UNIQUE INDEX order_export_events_batch_exported
        ON order_export_events(account_id, order_id, batch_id, event_type)
        WHERE event_type = 'exported' AND batch_id IS NOT NULL;
      CREATE INDEX order_export_events_account_order ON order_export_events(account_id, order_id, created_at, id);
      CREATE INDEX order_export_events_account_batch ON order_export_events(account_id, batch_id, created_at, id);
    `,
  },
  {
    version: 13,
    name: 'document-templates-and-private-files',
    sql: `
      CREATE TABLE document_templates (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        name TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('a4', 'a5', 'thermal-80mm', 'label-100x150mm')),
        locale TEXT NOT NULL CHECK(locale IN ('ar-EG', 'en-US')),
        direction TEXT NOT NULL CHECK(direction IN ('rtl', 'ltr')),
        version INTEGER NOT NULL CHECK(version >= 1), body TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL, company_address TEXT, footer_text TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(account_id, name), UNIQUE(account_id, id)
      );
      CREATE TABLE document_template_revisions (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), template_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK(version >= 1), format TEXT NOT NULL CHECK(format IN ('a4', 'a5', 'thermal-80mm', 'label-100x150mm')),
        locale TEXT NOT NULL CHECK(locale IN ('ar-EG', 'en-US')),
        direction TEXT NOT NULL CHECK(direction IN ('rtl', 'ltr')),
        body TEXT NOT NULL DEFAULT '', company_name TEXT NOT NULL, company_address TEXT, footer_text TEXT,
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
        UNIQUE(account_id, template_id, version), UNIQUE(account_id, id),
        FOREIGN KEY(account_id, template_id) REFERENCES document_templates(account_id, id)
      );
      CREATE INDEX document_template_revisions_account_template ON document_template_revisions(account_id, template_id, version DESC);
      CREATE TABLE document_files (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL,
        template_id TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('a4', 'a5', 'thermal-80mm', 'label-100x150mm')),
        relative_path TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL CHECK(mime_type = 'application/pdf'),
        byte_size INTEGER NOT NULL CHECK(byte_size >= 1 AND byte_size <= 50 * 1024 * 1024),
        checksum TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL,
        UNIQUE(account_id, id), UNIQUE(account_id, checksum),
        FOREIGN KEY(account_id, order_id) REFERENCES orders(account_id, id),
        FOREIGN KEY(account_id, template_id) REFERENCES document_templates(account_id, id)
      );
      CREATE INDEX document_files_account_order ON document_files(account_id, order_id, created_at DESC, id);
    `,
  },
  {
    version: 14,
    name: 'analytics-cost-rules-and-daily-facts',
    sql: `
      CREATE TABLE cost_rules (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        scope TEXT NOT NULL CHECK(scope IN ('product', 'variation', 'shipping', 'payment', 'return')),
        rule_key TEXT NOT NULL, currency TEXT NOT NULL CHECK(length(currency) = 3),
        amount_minor TEXT NOT NULL, source TEXT NOT NULL, effective_from TEXT NOT NULL,
        effective_to TEXT, version INTEGER NOT NULL CHECK(version >= 1),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        created_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(account_id, id), UNIQUE(account_id, scope, rule_key, currency, effective_from)
      );
      CREATE INDEX cost_rules_account_lookup ON cost_rules(account_id, scope, rule_key, currency, effective_from DESC);
      CREATE TABLE order_cost_snapshots (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL,
        line_id TEXT NOT NULL, rule_id TEXT, currency TEXT NOT NULL CHECK(length(currency) = 3),
        source TEXT NOT NULL, effective_at TEXT, quantity INTEGER NOT NULL CHECK(quantity >= 0),
        unit_cost_minor TEXT NOT NULL, total_cost_minor TEXT NOT NULL, source_hash TEXT,
        created_at TEXT NOT NULL, UNIQUE(account_id, id), UNIQUE(account_id, order_id, line_id),
        FOREIGN KEY(account_id, order_id) REFERENCES orders(account_id, id),
        FOREIGN KEY(account_id, rule_id) REFERENCES cost_rules(account_id, id)
      );
      CREATE INDEX order_cost_snapshots_account_order ON order_cost_snapshots(account_id, order_id, line_id);
      CREATE TABLE daily_order_facts (
        account_id TEXT NOT NULL REFERENCES accounts(id), fact_date TEXT NOT NULL,
        currency TEXT NOT NULL CHECK(length(currency) = 3), source TEXT NOT NULL CHECK(source IN ('woo', 'manual')),
        dimension_hash TEXT NOT NULL, dimensions_json TEXT NOT NULL,
        order_count INTEGER NOT NULL CHECK(order_count >= 0), line_count INTEGER NOT NULL CHECK(line_count >= 0),
        gross_sales_minor TEXT NOT NULL, discount_minor TEXT NOT NULL, net_merchandise_minor TEXT NOT NULL,
        shipping_collected_minor TEXT NOT NULL, tax_minor TEXT NOT NULL, refunds_minor TEXT NOT NULL,
        collected_revenue_minor TEXT NOT NULL, cogs_minor TEXT NOT NULL, actual_shipping_cost_minor TEXT NOT NULL,
        payment_fees_minor TEXT NOT NULL, return_cost_minor TEXT NOT NULL, contribution_profit_minor TEXT NOT NULL,
        metrics_version INTEGER NOT NULL DEFAULT 1 CHECK(metrics_version >= 1), rebuilt_at TEXT NOT NULL,
        PRIMARY KEY(account_id, fact_date, currency, source, dimension_hash)
      );
      CREATE INDEX daily_order_facts_account_date ON daily_order_facts(account_id, fact_date, currency, source);
    `,
  },
  {
    version: 15,
    name: 'account-administration-and-password-recovery',
    sql: `
      ALTER TABLE account_memberships ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked'));
      ALTER TABLE account_memberships ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE account_memberships ADD COLUMN revoked_at TEXT;
      UPDATE account_memberships SET updated_at = created_at WHERE updated_at = '';
      CREATE INDEX memberships_account_status ON account_memberships(account_id, status, created_at);
      CREATE INDEX memberships_user_status ON account_memberships(user_id, status, account_id);
      CREATE TABLE password_reset_tokens (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT NOT NULL REFERENCES accounts(id),
        token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
      );
      CREATE INDEX password_reset_tokens_lookup ON password_reset_tokens(token_hash, used_at, expires_at);
      CREATE TABLE account_invitations (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), email TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'viewer')), token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL, accepted_at TEXT, revoked_at TEXT, created_by TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX account_invitations_pending_email
        ON account_invitations(account_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;
      CREATE INDEX account_invitations_account_status
        ON account_invitations(account_id, expires_at, accepted_at, revoked_at);
    `,
  },
];

const MAX_SELECTION_IDS = 5_000;
const MAX_SELECTION_JSON = 32 * 1024;
const MAX_BULK_PARAMETERS_JSON = 32 * 1024;
const MAX_JOB_ID_LENGTH = 256;
const MAX_JOB_IDEMPOTENCY_LENGTH = 200;
const MAX_JOB_ATTEMPTS = 10;
const MAX_JOB_ERROR_LENGTH = 500;
const JOB_RETRY_BASE_MS = 2_000;
const JOB_RETRY_MAX_MS = 5 * 60_000;
const MAX_VIEW_COLUMNS = 100;
const BULK_ACTIONS: readonly BulkAction[] = [
  'update-local-status',
  'assign',
  'add-tag',
  'remove-tag',
  'mark-export-ready',
  'create-export',
  'generate-invoice',
  'generate-thermal',
  'generate-label',
  'print-documents',
  'resync',
];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isBulkAction = (value: unknown): value is BulkAction =>
  typeof value === 'string' && BULK_ACTIONS.includes(value as BulkAction);
const isDurableJobType = (value: unknown): value is DurableJobType =>
  typeof value === 'string' && DURABLE_JOB_TYPES.includes(value as DurableJobType);
const normalizeIdList = (value: unknown, errorCode: string): string[] => {
  if (!Array.isArray(value) || value.length > MAX_SELECTION_IDS) throw new Error(errorCode);
  const ids = value.map((item) => {
    if (typeof item !== 'string' || item.length < 1 || item.length > 256)
      throw new Error(errorCode);
    return item;
  });
  if (new Set(ids).size !== ids.length) throw new Error(errorCode);
  return ids;
};
const normalizeOrderQuery = (value: unknown, errorCode: string): OrderQueryInput => {
  if (!isRecord(value)) throw new Error(errorCode);
  const query: OrderQueryInput = {};
  if (value.search !== undefined) {
    if (typeof value.search !== 'string' || value.search.length > 200) throw new Error(errorCode);
    query.search = value.search;
  }
  if (value.filter !== undefined) {
    if (!isRecord(value.filter)) throw new Error(errorCode);
    const filter = value.filter as unknown as OrderFilter;
    try {
      compileFilter(filter);
    } catch {
      throw new Error(errorCode);
    }
    query.filter = filter;
  }
  if (value.sort !== undefined) {
    if (!isRecord(value.sort)) throw new Error(errorCode);
    const field = value.sort.field;
    const direction = value.sort.direction;
    if (
      !['remoteCreatedAt', 'updatedAt', 'orderNumber', 'grandTotalMinor', 'id'].includes(
        String(field),
      ) ||
      !['asc', 'desc'].includes(String(direction))
    )
      throw new Error(errorCode);
    query.sort = {
      field: field as OrderSort['field'],
      direction: direction as OrderSort['direction'],
    };
  }
  if (value.cursor !== undefined && value.cursor !== null) throw new Error(errorCode);
  if (value.limit !== undefined && value.limit !== null) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > 100
    )
      throw new Error(errorCode);
  }
  serializeBoundedJson(query, MAX_SELECTION_JSON, errorCode);
  return query;
};
const normalizeWatermark = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('SELECTION_WATERMARK_INVALID');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 60_000)
    throw new Error('SELECTION_WATERMARK_INVALID');
  return new Date(timestamp).toISOString();
};
const normalizeExpiry = (value: unknown): string => {
  const timestamp =
    value === undefined ? Date.now() + 24 * 60 * 60 * 1000 : Date.parse(String(value));
  if (
    !Number.isFinite(timestamp) ||
    timestamp <= Date.now() ||
    timestamp > Date.now() + 30 * 24 * 60 * 60 * 1000
  )
    throw new Error('SELECTION_EXPIRY_INVALID');
  return new Date(timestamp).toISOString();
};
const parseStoredJson = <T>(value: string, errorCode: string): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(errorCode);
  }
};
const selectionCursor = (id: string): string => encodedCursor({ sortValue: '', id });
const readSelectionCursor = (value: string): string => decodedCursor(value).id;
const operationError = (error: unknown, fallback: string): Error =>
  error instanceof Error ? error : new Error(fallback);

type SelectionData = {
  mode: SelectionMode;
  query: SelectionQuery;
  exclusions: readonly string[];
  watermark: string;
};
type SelectionRow = {
  id: string;
  account_id: string;
  created_by: string;
  mode: SelectionMode;
  query_json: string;
  exclusions_json: string;
  watermark: string;
  estimated_count: number;
  expires_at: string;
  created_at: string;
};
type ExportProfileRow = {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};
type ExportProfileVersionRow = {
  id: string;
  account_id: string;
  profile_id: string;
  version: number;
  format: ExportFormat;
  row_mode: ExportRowMode;
  columns_json: string;
  filename_template: string;
  config_json: string;
  created_by: string;
  created_at: string;
};
type ExportBatchRow = {
  id: string;
  account_id: string;
  selection_id: string;
  profile_version_id: string;
  format: ExportFormat;
  row_mode: ExportRowMode;
  status: ExportBatchStatus;
  watermark: string;
  order_count: number;
  row_count: number;
  filename: string | null;
  file_path: string | null;
  checksum: string | null;
  created_by: string;
  idempotency_key: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
type OrderExportEventRow = {
  id: string;
  account_id: string;
  order_id: string;
  batch_id: string | null;
  event_type: ExportEventType;
  snapshot_hash: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
};
type DocumentTemplateRow = {
  id: string;
  account_id: string;
  name: string;
  format: DocumentTemplateFormat;
  locale: 'ar-EG' | 'en-US';
  direction: 'rtl' | 'ltr';
  version: number;
  body: string;
  company_name: string;
  company_address: string | null;
  footer_text: string | null;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type DocumentFileRow = {
  id: string;
  account_id: string;
  order_id: string;
  template_id: string;
  format: DocumentTemplateFormat;
  relative_path: string;
  filename: string;
  mime_type: 'application/pdf';
  byte_size: number;
  checksum: string;
  created_by: string;
  created_at: string;
};
type CostRuleRow = {
  id: string;
  account_id: string;
  scope: CostRuleScope;
  rule_key: string;
  currency: string;
  amount_minor: string;
  source: string;
  effective_from: string;
  effective_to: string | null;
  version: number;
  active: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};
type OrderCostSnapshotRow = {
  id: string;
  account_id: string;
  order_id: string;
  line_id: string;
  rule_id: string | null;
  currency: string;
  source: string;
  effective_at: string | null;
  quantity: number;
  unit_cost_minor: string;
  total_cost_minor: string;
  source_hash: string | null;
  created_at: string;
};
type DailyAnalyticsFactRow = {
  account_id: string;
  fact_date: string;
  currency: string;
  source: 'woo' | 'manual';
  dimension_hash: string;
  dimensions_json: string;
  order_count: number;
  line_count: number;
  gross_sales_minor: string;
  discount_minor: string;
  net_merchandise_minor: string;
  shipping_collected_minor: string;
  tax_minor: string;
  refunds_minor: string;
  collected_revenue_minor: string;
  cogs_minor: string;
  actual_shipping_cost_minor: string;
  payment_fees_minor: string;
  return_cost_minor: string;
  contribution_profit_minor: string;
  metrics_version: number;
  rebuilt_at: string;
};
const exportFormats: readonly ExportFormat[] = ['csv', 'xlsx'];
const exportRowModes: readonly ExportRowMode[] = ['order', 'line', 'package', 'carrier'];
const documentFormats: readonly DocumentTemplateFormat[] = [
  'a4',
  'a5',
  'thermal-80mm',
  'label-100x150mm',
];
const exportColumnTypes: readonly NonNullable<ExportColumn['type']>[] = [
  'text',
  'number',
  'date',
  'money',
];
const normalizeExportName = (value: unknown, code: string, maxLength: number): string => {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength)
    throw new Error(code);
  return value.trim();
};
const normalizeExportColumns = (value: unknown): ExportColumn[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100)
    throw new Error('EXPORT_COLUMNS_INVALID');
  const columns = value.map((item) => {
    if (!isRecord(item)) throw new Error('EXPORT_COLUMNS_INVALID');
    const key = normalizeExportName(item.key, 'EXPORT_COLUMN_KEY_INVALID', 180);
    const label = normalizeExportName(item.label, 'EXPORT_COLUMN_LABEL_INVALID', 160);
    if (!key.split('.').every((segment) => /^[A-Za-z0-9_\u0600-\u06ff-]+$/u.test(segment)))
      throw new Error('EXPORT_COLUMN_KEY_INVALID');
    const type = item.type === undefined ? undefined : item.type;
    if (
      type !== undefined &&
      (typeof type !== 'string' ||
        !exportColumnTypes.includes(type as NonNullable<ExportColumn['type']>))
    )
      throw new Error('EXPORT_COLUMN_TYPE_INVALID');
    return {
      key,
      label,
      ...(type === undefined ? {} : { type: type as NonNullable<ExportColumn['type']> }),
    };
  });
  if (new Set(columns.map((column) => column.key)).size !== columns.length)
    throw new Error('EXPORT_COLUMNS_DUPLICATE');
  return columns;
};
const normalizeExportFormat = (value: unknown): ExportFormat => {
  if (typeof value !== 'string' || !exportFormats.includes(value as ExportFormat))
    throw new Error('EXPORT_FORMAT_INVALID');
  return value as ExportFormat;
};
const normalizeExportRowMode = (value: unknown): ExportRowMode => {
  if (typeof value !== 'string' || !exportRowModes.includes(value as ExportRowMode))
    throw new Error('EXPORT_ROW_MODE_INVALID');
  return value as ExportRowMode;
};
const normalizeDocumentText = (
  value: unknown,
  code: string,
  max: number,
  optional = false,
): string => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()))
    throw new Error(code);
  return value.trim();
};
const normalizeDocumentFormat = (value: unknown): DocumentTemplateFormat => {
  if (typeof value !== 'string' || !documentFormats.includes(value as DocumentTemplateFormat))
    throw new Error('DOCUMENT_FORMAT_INVALID');
  return value as DocumentTemplateFormat;
};
const normalizeDocumentLocale = (value: unknown): 'ar-EG' | 'en-US' => {
  if (value !== 'ar-EG' && value !== 'en-US') throw new Error('DOCUMENT_LOCALE_INVALID');
  return value;
};
const normalizeDocumentDirection = (value: unknown): 'rtl' | 'ltr' => {
  if (value !== 'rtl' && value !== 'ltr') throw new Error('DOCUMENT_DIRECTION_INVALID');
  return value;
};
const normalizeDocumentBody = (value: unknown): string => {
  const body = normalizeDocumentText(value, 'DOCUMENT_TEMPLATE_BODY_INVALID', 5_000, true);
  return validateSafeTemplate(body).source;
};
const analyticsScopes: readonly CostRuleScope[] = [
  'product',
  'variation',
  'shipping',
  'payment',
  'return',
];
const normalizeAnalyticsScope = (value: unknown): CostRuleScope => {
  if (typeof value !== 'string' || !analyticsScopes.includes(value as CostRuleScope))
    throw new Error('COST_RULE_SCOPE_INVALID');
  return value as CostRuleScope;
};
const normalizeAnalyticsCurrency = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/u.test(value))
    throw new Error('ANALYTICS_CURRENCY_INVALID');
  return value.toUpperCase();
};
const normalizeAnalyticsMinor = (value: unknown): string => {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,17})$/u.test(value))
    throw new Error('COST_RULE_AMOUNT_INVALID');
  return BigInt(value).toString();
};
const normalizeAnalyticsDate = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error(code);
  return new Date(value).toISOString();
};
const normalizeAnalyticsKey = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256)
    throw new Error('COST_RULE_KEY_INVALID');
  if (!/^[A-Za-z0-9_:.\-/*]+$/u.test(value)) throw new Error('COST_RULE_KEY_INVALID');
  return value;
};
const normalizeAnalyticsDateKey = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value))
    throw new Error('ANALYTICS_DATE_INVALID');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw new Error('ANALYTICS_DATE_INVALID');
  return value;
};
const analyticsMetricKeys: readonly (keyof MetricTotals)[] = [
  'grossSalesMinor',
  'discountMinor',
  'netMerchandiseMinor',
  'shippingCollectedMinor',
  'taxMinor',
  'refundsMinor',
  'collectedRevenueMinor',
  'cogsMinor',
  'actualShippingCostMinor',
  'paymentFeesMinor',
  'returnCostMinor',
  'contributionProfitMinor',
];
const analyticsMinor = (value: string): bigint => {
  if (!/^-?\d{1,18}$/u.test(value)) throw new Error('ANALYTICS_DATA_INVALID');
  return BigInt(value);
};
const emptyAnalyticsTotals = (): MetricTotals =>
  Object.fromEntries(analyticsMetricKeys.map((key) => [key, '0'])) as MetricTotals;
const addAnalyticsTotals = (left: MetricTotals, right: MetricTotals): MetricTotals =>
  Object.fromEntries(
    analyticsMetricKeys.map((key) => [
      key,
      (analyticsMinor(left[key]) + analyticsMinor(right[key])).toString(),
    ]),
  ) as MetricTotals;
const analyticsLike = (value: string): string =>
  `%${value.toLowerCase().replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
const documentTemplate = (row: DocumentTemplateRow): DocumentTemplateRecord => ({
  id: row.id,
  accountId: row.account_id,
  name: row.name,
  format: row.format,
  locale: row.locale,
  direction: row.direction,
  version: row.version,
  body: row.body,
  companyName: row.company_name,
  companyAddress: row.company_address,
  footerText: row.footer_text,
  active: row.active === 1,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const documentFile = (row: DocumentFileRow): DocumentFileRecord => ({
  id: row.id,
  accountId: row.account_id,
  orderId: row.order_id,
  templateId: row.template_id,
  format: row.format,
  relativePath: row.relative_path,
  filename: row.filename,
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  checksum: row.checksum,
  createdBy: row.created_by,
  createdAt: row.created_at,
});
const costRule = (row: CostRuleRow): CostRuleRecord => ({
  id: row.id,
  accountId: row.account_id,
  scope: row.scope,
  key: row.rule_key,
  currency: row.currency,
  amountMinor: row.amount_minor,
  source: row.source,
  effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to,
  version: row.version,
  active: row.active === 1,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const orderCostSnapshot = (row: OrderCostSnapshotRow): OrderCostSnapshotRecord => ({
  id: row.id,
  accountId: row.account_id,
  orderId: row.order_id,
  lineId: row.line_id,
  ruleId: row.rule_id,
  currency: row.currency,
  source: row.source,
  effectiveAt: row.effective_at,
  quantity: row.quantity,
  unitCostMinor: row.unit_cost_minor,
  totalCostMinor: row.total_cost_minor,
  sourceHash: row.source_hash,
  createdAt: row.created_at,
});
const dailyAnalyticsFact = (row: DailyAnalyticsFactRow): DailyAnalyticsFactRecord => ({
  accountId: row.account_id,
  date: row.fact_date,
  currency: row.currency,
  source: row.source,
  dimensions: parseStoredJson<Record<string, unknown>>(
    row.dimensions_json,
    'ANALYTICS_DATA_INVALID',
  ),
  orderCount: row.order_count,
  lineCount: row.line_count,
  totals: {
    grossSalesMinor: row.gross_sales_minor,
    discountMinor: row.discount_minor,
    netMerchandiseMinor: row.net_merchandise_minor,
    shippingCollectedMinor: row.shipping_collected_minor,
    taxMinor: row.tax_minor,
    refundsMinor: row.refunds_minor,
    collectedRevenueMinor: row.collected_revenue_minor,
    cogsMinor: row.cogs_minor,
    actualShippingCostMinor: row.actual_shipping_cost_minor,
    paymentFeesMinor: row.payment_fees_minor,
    returnCostMinor: row.return_cost_minor,
    contributionProfitMinor: row.contribution_profit_minor,
  },
  metricsVersion: row.metrics_version,
  rebuiltAt: row.rebuilt_at,
});
const exportProfile = (row: ExportProfileRow): ExportProfile => ({
  id: row.id,
  accountId: row.account_id,
  name: row.name,
  description: row.description,
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const exportProfileVersion = (row: ExportProfileVersionRow): ExportProfileVersion => ({
  id: row.id,
  accountId: row.account_id,
  profileId: row.profile_id,
  version: row.version,
  format: row.format,
  rowMode: row.row_mode,
  columns: normalizeExportColumns(
    parseStoredJson<unknown>(row.columns_json, 'EXPORT_COLUMNS_INVALID'),
  ),
  filenameTemplate: normalizeExportName(row.filename_template, 'EXPORT_FILENAME_INVALID', 180),
  config: parseStoredJson<Record<string, unknown>>(row.config_json, 'EXPORT_CONFIG_INVALID'),
  createdBy: row.created_by,
  createdAt: row.created_at,
});
const exportBatch = (row: ExportBatchRow): ExportBatch => ({
  id: row.id,
  accountId: row.account_id,
  selectionId: row.selection_id,
  profileVersionId: row.profile_version_id,
  format: row.format,
  rowMode: row.row_mode,
  status: row.status,
  watermark: row.watermark,
  orderCount: row.order_count,
  rowCount: row.row_count,
  filename: row.filename,
  filePath: row.file_path,
  checksum: row.checksum,
  createdBy: row.created_by,
  idempotencyKey: row.idempotency_key,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
});
const orderExportEvent = (row: OrderExportEventRow): OrderExportEvent => ({
  id: row.id,
  accountId: row.account_id,
  orderId: row.order_id,
  batchId: row.batch_id,
  type: row.event_type,
  snapshotHash: row.snapshot_hash,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
});
type SavedViewRow = {
  id: string;
  account_id: string;
  user_id: string;
  name: string;
  query_json: string;
  sort_json: string | null;
  columns_json: string;
  page_size: number;
  visibility: SavedViewVisibility;
  version: number;
  created_at: string;
  updated_at: string;
};
type BulkJobRow = {
  id: string;
  account_id: string;
  selection_id: string;
  action: BulkAction;
  parameters_json: string;
  status: BulkJobStatus;
  progress: number;
  total_count: number;
  succeeded_count: number;
  failed_count: number;
  cancelled_count: number;
  idempotency_key: string;
  created_by: string;
  cancel_requested: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};
type JobRow = {
  id: string;
  account_id: string;
  type: string;
  idempotency_key: string;
  status: DurableJob['status'];
  attempts: number;
  max_attempts: number;
  progress: number;
  payload_json: string;
  cancel_requested: number;
  lease_until: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
const parseJobPayload = (value: string): unknown =>
  parseStoredJson<unknown>(value, 'JOB_PAYLOAD_INVALID');
const jobFromRow = (row: JobRow): DurableJob => ({
  id: row.id,
  accountId: row.account_id,
  type: row.type,
  idempotencyKey: row.idempotency_key,
  status: row.status,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  progress: row.progress,
  payload: parseJobPayload(row.payload_json),
  cancelRequested: row.cancel_requested === 1,
  leaseUntil: row.lease_until,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
const jobSummary = (row: JobRow): JobSummary => {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    progress: row.progress,
    cancelRequested: row.cancel_requested === 1,
    leaseUntil: row.lease_until,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};
const redactedJobError = (value: unknown): string => {
  const source = value instanceof Error ? value.message : String(value);
  return (
    source
      .replace(
        /((?:password|secret|token|credential|authorization))\s*[:=]\s*[^\s,;]+/giu,
        '$1=[REDACTED]',
      )
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
      .replace(/\b(?:sk|pk)_[A-Za-z0-9_-]+\b/gu, '[REDACTED_KEY]')
      .replace(/[\u0000-\u001f\u007f]/gu, ' ')
      .trim()
      .slice(0, MAX_JOB_ERROR_LENGTH) || 'JOB_HANDLER_FAILED'
  );
};
const bulkParameterValue = (parameters: Record<string, unknown>, name: string): string => {
  const value = parameters[name];
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 256)
    throw new Error('BULK_PARAMETERS_INVALID');
  return value.trim();
};
const normalizeBulkParameters = (action: BulkAction, value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error('BULK_PARAMETERS_INVALID');
  const serialized = serializeBoundedJson(
    value,
    MAX_BULK_PARAMETERS_JSON,
    'BULK_PARAMETERS_TOO_LARGE',
  );
  const parameters = parseStoredJson<Record<string, unknown>>(
    serialized,
    'BULK_PARAMETERS_INVALID',
  );
  const forbiddenKey = (key: string): boolean =>
    ['orderids', 'selectedorderids', 'selectionids', 'remoteaction', 'remoteupdate'].includes(
      key.replace(/[_-]/g, '').toLowerCase(),
    );
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!isRecord(item)) return;
    for (const [key, nested] of Object.entries(item)) {
      if (forbiddenKey(key)) throw new Error('BULK_PARAMETERS_INVALID');
      visit(nested);
    }
  };
  visit(parameters);
  if (action === 'update-local-status') bulkParameterValue(parameters, 'status');
  if (action === 'assign') bulkParameterValue(parameters, 'assigneeId');
  if (action === 'add-tag' || action === 'remove-tag') bulkParameterValue(parameters, 'tag');
  if (action === 'create-export') bulkParameterValue(parameters, 'profileId');
  if (
    ['generate-invoice', 'generate-thermal', 'generate-label', 'print-documents'].includes(action)
  )
    bulkParameterValue(parameters, 'templateId');
  return parameters;
};

export class SqliteStore {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    this.applyMigrations();
  }

  private assertContext(context: AccountContext): void {
    if (!context.accountId || !context.correlationId) throw new Error('ACCOUNT_CONTEXT_INVALID');
  }

  private assertMember(context: AccountContext): AccountRole {
    this.assertContext(context);
    if (!context.actorId) throw new Error('BULK_PERMISSION_DENIED');
    const membership = this.db
      .prepare(
        "SELECT role FROM account_memberships WHERE account_id = ? AND user_id = ? AND status = 'active'",
      )
      .get(context.accountId, context.actorId) as { role: AccountRole } | undefined;
    if (!membership) throw new Error('BULK_PERMISSION_DENIED');
    return membership.role;
  }

  private requireMutationActor(context: AccountContext): string {
    const role = this.assertMember(context);
    if (context.role === 'viewer' || role === 'viewer') throw new Error('BULK_PERMISSION_DENIED');
    return context.actorId as string;
  }

  private requireAccountAdmin(context: AccountContext): string {
    const role = this.assertMember(context);
    if (role !== 'owner' && role !== 'admin') throw new Error('ACCOUNT_ADMIN_PERMISSION_DENIED');
    return context.actorId as string;
  }

  getAccount(context: AccountContext): AccountRecord {
    this.assertMember(context);
    const row = this.db
      .prepare(
        'SELECT id, name, locale, direction, timezone, base_currency FROM accounts WHERE id = ?',
      )
      .get(context.accountId) as
      | {
          id: string;
          name: string;
          locale: 'ar-EG' | 'en-US';
          direction: 'rtl' | 'ltr';
          timezone: string;
          base_currency: string;
        }
      | undefined;
    if (!row) throw new Error('ACCOUNT_NOT_FOUND');
    return {
      id: row.id,
      name: row.name,
      locale: row.locale,
      direction: row.direction,
      timezone: row.timezone,
      baseCurrency: row.base_currency,
    };
  }

  updateAccount(
    context: AccountContext,
    input: Partial<{
      name: string | undefined;
      locale: 'ar-EG' | 'en-US' | undefined;
      direction: 'rtl' | 'ltr' | undefined;
      timezone: string | undefined;
      baseCurrency: string | undefined;
    }>,
  ): AccountRecord {
    this.requireAccountAdmin(context);
    if (input.name !== undefined && (input.name.trim().length < 1 || input.name.length > 160))
      throw new Error('ACCOUNT_NAME_INVALID');
    if (input.locale !== undefined && !['ar-EG', 'en-US'].includes(input.locale))
      throw new Error('ACCOUNT_LOCALE_INVALID');
    if (input.direction !== undefined && !['rtl', 'ltr'].includes(input.direction))
      throw new Error('ACCOUNT_DIRECTION_INVALID');
    if (input.timezone !== undefined) {
      if (input.timezone.length < 1 || input.timezone.length > 80)
        throw new Error('ACCOUNT_TIMEZONE_INVALID');
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone }).format();
      } catch {
        throw new Error('ACCOUNT_TIMEZONE_INVALID');
      }
    }
    if (input.baseCurrency !== undefined && !/^[A-Za-z]{3}$/u.test(input.baseCurrency))
      throw new Error('ACCOUNT_CURRENCY_INVALID');
    const current = this.getAccount(context);
    const next = {
      name: input.name?.trim() ?? current.name,
      locale: input.locale ?? current.locale,
      direction: input.direction ?? current.direction,
      timezone: input.timezone ?? current.timezone,
      baseCurrency: input.baseCurrency?.toUpperCase() ?? current.baseCurrency,
    };
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE accounts SET name = ?, locale = ?, direction = ?, timezone = ?, base_currency = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        next.name,
        next.locale,
        next.direction,
        next.timezone,
        next.baseCurrency,
        now,
        context.accountId,
      );
    this.audit(context, 'account.updated', 'account', context.accountId, {
      fields: Object.keys(input),
    });
    return this.getAccount(context);
  }

  listMembers(context: AccountContext): MemberRecord[] {
    this.requireAccountAdmin(context);
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.email, m.role, m.status, m.created_at, m.updated_at, m.revoked_at
         FROM account_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.account_id = ? ORDER BY CASE m.status WHEN 'active' THEN 0 ELSE 1 END, u.email, u.id`,
      )
      .all(context.accountId) as Array<{
      user_id: string;
      email: string;
      role: AccountRole;
      status: 'active' | 'revoked';
      created_at: string;
      updated_at: string;
      revoked_at: string | null;
    }>;
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at || row.created_at,
      revokedAt: row.revoked_at,
    }));
  }

  createInvitation(
    context: AccountContext,
    input: { email: string; role: Exclude<AccountRole, 'owner'>; expiresAt: string },
  ): InvitationRecord {
    const actorId = this.requireAccountAdmin(context);
    const email = input.email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/u.test(email) || email.length > 320)
      throw new Error('INVITATION_EMAIL_INVALID');
    if (!['admin', 'operator', 'viewer'].includes(input.role))
      throw new Error('INVITATION_ROLE_INVALID');
    const actorRole = this.assertMember(context);
    if (actorRole !== 'owner' && input.role === 'admin')
      throw new Error('INVITATION_ROLE_PERMISSION_DENIED');
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())
      throw new Error('INVITATION_EXPIRY_INVALID');
    if (expiresAt.getTime() > Date.now() + 30 * 86400000)
      throw new Error('INVITATION_EXPIRY_INVALID');
    const now = new Date().toISOString();
    this.db
      .prepare(
        'UPDATE account_invitations SET revoked_at = ? WHERE account_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= ?',
      )
      .run(now, context.accountId, email, now);
    if (
      this.db
        .prepare(
          "SELECT 1 FROM users u JOIN account_memberships m ON m.user_id = u.id WHERE m.account_id = ? AND u.email = ? AND m.status = 'active'",
        )
        .get(context.accountId, email)
    )
      throw new Error('INVITATION_MEMBER_EXISTS');
    const token = randomBytes(32).toString('base64url');
    const id = randomId();
    try {
      this.db
        .prepare(
          `INSERT INTO account_invitations
            (id, account_id, email, role, token_hash, expires_at, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          context.accountId,
          email,
          input.role,
          requireHash(token),
          expiresAt.toISOString(),
          actorId,
          now,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE'))
        throw new Error('INVITATION_PENDING_EXISTS');
      throw error;
    }
    this.audit(context, 'invitation.created', 'invitation', id, { email, role: input.role });
    return {
      id,
      email,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
      acceptedAt: null,
      revokedAt: null,
      createdAt: now,
      acceptToken: token,
    };
  }

  listInvitations(context: AccountContext): InvitationRecord[] {
    this.requireAccountAdmin(context);
    const rows = this.db
      .prepare(
        `SELECT id, email, role, expires_at, accepted_at, revoked_at, created_at
         FROM account_invitations WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT 200`,
      )
      .all(context.accountId) as Array<{
      id: string;
      email: string;
      role: Exclude<AccountRole, 'owner'>;
      expires_at: string;
      accepted_at: string | null;
      revoked_at: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
    }));
  }

  revokeInvitation(context: AccountContext, invitationId: string): void {
    this.requireAccountAdmin(context);
    const result = this.db
      .prepare(
        'UPDATE account_invitations SET revoked_at = ? WHERE account_id = ? AND id = ? AND accepted_at IS NULL AND revoked_at IS NULL',
      )
      .run(new Date().toISOString(), context.accountId, invitationId);
    if (result.changes !== 1) throw new Error('INVITATION_NOT_FOUND');
    this.audit(context, 'invitation.revoked', 'invitation', invitationId, {});
  }

  acceptInvitation(
    userId: string,
    invitationId: string,
    token: string,
    correlationId: string,
  ): MemberRecord {
    if (!userId || !invitationId || !/^[A-Za-z0-9_-]{32,80}$/u.test(token))
      throw new Error('INVITATION_INVALID');
    const now = new Date().toISOString();
    const result = this.db.transaction(() => {
      const invitation = this.db
        .prepare(
          `SELECT id, account_id, email, role, expires_at FROM account_invitations
           WHERE id = ? AND token_hash = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
        )
        .get(invitationId, requireHash(token)) as
        | { id: string; account_id: string; email: string; role: AccountRole; expires_at: string }
        | undefined;
      if (!invitation || invitation.expires_at <= now) throw new Error('INVITATION_INVALID');
      const user = this.db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as
        { id: string; email: string } | undefined;
      if (!user || user.email !== invitation.email) throw new Error('INVITATION_EMAIL_MISMATCH');
      this.db
        .prepare(
          `INSERT INTO account_memberships (account_id, user_id, role, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)
           ON CONFLICT(account_id, user_id) DO UPDATE SET role = excluded.role, status = 'active', revoked_at = NULL, updated_at = excluded.updated_at`,
        )
        .run(invitation.account_id, user.id, invitation.role, now, now);
      this.db
        .prepare(
          'UPDATE account_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL',
        )
        .run(now, invitation.id);
      this.db
        .prepare(
          'INSERT INTO audit_events (id, account_id, actor_id, action, target_type, target_id, summary_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          randomId(),
          invitation.account_id,
          user.id,
          'invitation.accepted',
          'membership',
          user.id,
          JSON.stringify({ role: invitation.role }),
          correlationId,
          now,
        );
      return invitation;
    })();
    const row = this.db
      .prepare(
        `SELECT u.id AS user_id, u.email, m.role, m.status, m.created_at, m.updated_at, m.revoked_at
         FROM account_memberships m JOIN users u ON u.id = m.user_id
         WHERE m.account_id = ? AND m.user_id = ?`,
      )
      .get(result.account_id, userId) as {
      user_id: string;
      email: string;
      role: AccountRole;
      status: 'active' | 'revoked';
      created_at: string;
      updated_at: string;
      revoked_at: string | null;
    };
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
    };
  }

  changeMemberRole(context: AccountContext, userId: string, role: AccountRole): MemberRecord {
    const actorId = this.requireAccountAdmin(context);
    if (userId === actorId) throw new Error('MEMBER_SELF_ROLE_CHANGE');
    if (!['owner', 'admin', 'operator', 'viewer'].includes(role))
      throw new Error('MEMBER_ROLE_INVALID');
    const actorRole = this.assertMember(context);
    if (actorRole !== 'owner' && role === 'owner') throw new Error('MEMBER_ROLE_PERMISSION_DENIED');
    const target = this.db
      .prepare('SELECT role, status FROM account_memberships WHERE account_id = ? AND user_id = ?')
      .get(context.accountId, userId) as { role: AccountRole; status: string } | undefined;
    if (!target || target.status !== 'active') throw new Error('MEMBER_NOT_FOUND');
    if (target.role === 'owner' && role !== 'owner') {
      const owners = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM account_memberships WHERE account_id = ? AND role = 'owner' AND status = 'active'",
        )
        .get(context.accountId) as { count: number };
      if (owners.count <= 1) throw new Error('MEMBER_LAST_OWNER');
      if (actorRole !== 'owner') throw new Error('MEMBER_ROLE_PERMISSION_DENIED');
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE account_memberships SET role = ?, updated_at = ?, revoked_at = NULL, status = 'active' WHERE account_id = ? AND user_id = ? AND status = 'active'",
      )
      .run(role, now, context.accountId, userId);
    this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND user_id = ? AND revoked_at IS NULL',
      )
      .run(now, context.accountId, userId);
    this.audit(context, 'membership.role-changed', 'membership', userId, {
      role,
      actorId,
    });
    return this.listMembers(context).find((member) => member.userId === userId) as MemberRecord;
  }

  revokeMembership(context: AccountContext, userId: string): void {
    const actorRole = this.assertMember(context);
    const actorId = this.requireAccountAdmin(context);
    const target = this.db
      .prepare('SELECT role, status FROM account_memberships WHERE account_id = ? AND user_id = ?')
      .get(context.accountId, userId) as { role: AccountRole; status: string } | undefined;
    if (!target || target.status !== 'active') throw new Error('MEMBER_NOT_FOUND');
    if (userId === actorId) throw new Error('MEMBER_SELF_REVOKE');
    if (target.role === 'owner') {
      if (actorRole !== 'owner') throw new Error('MEMBER_ROLE_PERMISSION_DENIED');
      const owners = this.db
        .prepare(
          "SELECT COUNT(*) AS count FROM account_memberships WHERE account_id = ? AND role = 'owner' AND status = 'active'",
        )
        .get(context.accountId) as { count: number };
      if (owners.count <= 1) throw new Error('MEMBER_LAST_OWNER');
    }
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE account_memberships SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE account_id = ? AND user_id = ? AND status = 'active'",
        )
        .run(now, now, context.accountId, userId);
      this.db
        .prepare(
          'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND user_id = ? AND revoked_at IS NULL',
        )
        .run(now, context.accountId, userId);
    })();
    this.audit(context, 'membership.revoked', 'membership', userId, {});
  }

  listSessions(context: AccountContext, targetUserId = context.actorId): SessionRecord[] {
    const actorRole = this.assertMember(context);
    if (!targetUserId) throw new Error('SESSION_USER_INVALID');
    if (targetUserId !== context.actorId && actorRole !== 'owner' && actorRole !== 'admin')
      throw new Error('SESSION_PERMISSION_DENIED');
    const rows = this.db
      .prepare(
        `SELECT s.id, s.user_id, u.email, s.created_at, s.last_seen_at, s.expires_at, s.revoked_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.account_id = ? AND s.user_id = ? ORDER BY s.created_at DESC, s.id DESC LIMIT 100`,
      )
      .all(context.accountId, targetUserId) as Array<{
      id: string;
      user_id: string;
      email: string;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
      revoked_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
  }

  revokeSession(context: AccountContext, sessionId: string): void {
    const actorRole = this.assertMember(context);
    const row = this.db
      .prepare('SELECT user_id FROM sessions WHERE account_id = ? AND id = ?')
      .get(context.accountId, sessionId) as { user_id: string } | undefined;
    if (!row) throw new Error('SESSION_NOT_FOUND');
    if (row.user_id !== context.actorId && actorRole !== 'owner' && actorRole !== 'admin')
      throw new Error('SESSION_PERMISSION_DENIED');
    const result = this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND id = ? AND revoked_at IS NULL',
      )
      .run(new Date().toISOString(), context.accountId, sessionId);
    if (result.changes !== 1) throw new Error('SESSION_NOT_FOUND');
    this.audit(context, 'session.revoked', 'session', sessionId, {});
  }

  revokeAllSessions(context: AccountContext, targetUserId = context.actorId): number {
    const actorRole = this.assertMember(context);
    if (!targetUserId) throw new Error('SESSION_USER_INVALID');
    if (targetUserId !== context.actorId && actorRole !== 'owner' && actorRole !== 'admin')
      throw new Error('SESSION_PERMISSION_DENIED');
    const result = this.db
      .prepare(
        'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND user_id = ? AND revoked_at IS NULL',
      )
      .run(new Date().toISOString(), context.accountId, targetUserId);
    this.audit(context, 'session.all-revoked', 'user', targetUserId, { count: result.changes });
    return result.changes;
  }

  healthSnapshot(): StoreHealth {
    try {
      const schema = this.db
        .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations')
        .get() as { version: number };
      const counts = this.db
        .prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END), 0) AS queued,
             COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running,
             COALESCE(SUM(CASE WHEN status = 'dead-lettered' THEN 1 ELSE 0 END), 0) AS dead_lettered
           FROM jobs`,
        )
        .get() as { queued: number; running: number; dead_lettered: number };
      return {
        database: 'connected',
        schemaVersion: schema.version,
        queue: {
          queued: Number(counts.queued),
          running: Number(counts.running),
          deadLettered: Number(counts.dead_lettered),
        },
      };
    } catch {
      return {
        database: 'degraded',
        schemaVersion: 0,
        queue: { queued: 0, running: 0, deadLettered: 0 },
      };
    }
  }

  private selectionRow(context: AccountContext, selectionId: string): SelectionRow {
    this.assertContext(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, created_by, mode, query_json, exclusions_json, watermark, estimated_count, expires_at, created_at FROM selection_snapshots WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, selectionId) as SelectionRow | undefined;
    if (!row) throw new Error('SELECTION_NOT_FOUND');
    return row;
  }

  private selectionData(row: SelectionRow): SelectionData {
    const rawQuery = parseStoredJson<unknown>(row.query_json, 'SELECTION_DATA_INVALID');
    const query: SelectionQuery =
      row.mode === 'explicit'
        ? {
            orderIds: normalizeIdList(
              isRecord(rawQuery) ? rawQuery.orderIds : undefined,
              'SELECTION_DATA_INVALID',
            ),
          }
        : normalizeOrderQuery(rawQuery, 'SELECTION_DATA_INVALID');
    const exclusions = normalizeIdList(
      parseStoredJson<unknown>(row.exclusions_json, 'SELECTION_DATA_INVALID'),
      'SELECTION_DATA_INVALID',
    );
    return { mode: row.mode, query, exclusions, watermark: row.watermark };
  }

  private selectionSnapshot(row: SelectionRow): SelectionSnapshot {
    const data = this.selectionData(row);
    return {
      id: row.id,
      accountId: row.account_id,
      createdBy: row.created_by,
      mode: row.mode,
      query: data.query,
      exclusions: data.exclusions,
      watermark: row.watermark,
      estimatedCount: row.estimated_count,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }

  private assertSelectionActive(row: SelectionRow): void {
    if (row.expires_at <= new Date().toISOString()) throw new Error('SELECTION_EXPIRED');
  }

  private verifyOrderIds(context: AccountContext, ids: readonly string[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM orders WHERE account_id = ? AND id IN (${placeholders})`,
      )
      .get(context.accountId, ...ids) as { count: number };
    if (Number(row.count) !== ids.length) throw new Error('SELECTION_ORDER_NOT_FOUND');
  }

  private compileSelectionWhere(
    context: AccountContext,
    selection: SelectionData,
  ): { sql: string; params: (string | number)[] } {
    const clauses = ['o.account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (selection.mode === 'explicit') {
      const ids = (selection.query as { orderIds: readonly string[] }).orderIds;
      if (ids.length === 0) clauses.push('0 = 1');
      else {
        clauses.push(`o.id IN (${ids.map(() => '?').join(',')})`);
        params.push(...ids);
      }
    } else {
      clauses.push('o.created_at <= ?');
      params.push(selection.watermark);
      const query = selection.query as OrderQueryInput;
      if (query.search !== undefined) {
        const search = `%${query.search}%`;
        clauses.push(
          `(o.order_number LIKE ? OR o.external_order_id LIKE ? OR o.remote_status LIKE ? OR o.local_status LIKE ? OR o.currency LIKE ? OR o.normalized_json LIKE ?)`,
        );
        params.push(search, search, search, search, search, search);
      }
      if (query.filter) {
        const compiled = compileFilter(query.filter);
        clauses.push(compiled.sql);
        params.push(...compiled.params);
      }
    }
    if (selection.exclusions.length > 0) {
      clauses.push(`o.id NOT IN (${selection.exclusions.map(() => '?').join(',')})`);
      params.push(...selection.exclusions);
    }
    return { sql: clauses.join(' AND '), params };
  }

  private countSelection(context: AccountContext, selection: SelectionData): number {
    const where = this.compileSelectionWhere(context, selection);
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM orders o WHERE ${where.sql}`)
      .get(...where.params) as { count: number };
    return Number(row.count);
  }

  createSelection(
    context: AccountContext,
    input: {
      mode: SelectionMode;
      orderIds?: readonly string[];
      query?: OrderQueryInput;
      exclusions?: readonly string[];
      watermark?: string;
      expiresAt?: string;
    },
  ): SelectionSnapshot {
    const actorId = this.requireMutationActor(context);
    if (input.mode !== 'explicit' && input.mode !== 'query')
      throw new Error('SELECTION_MODE_INVALID');
    const watermark = normalizeWatermark(input.watermark ?? new Date().toISOString());
    const exclusions = normalizeIdList(input.exclusions ?? [], 'SELECTION_EXCLUSIONS_INVALID');
    let query: SelectionQuery;
    if (input.mode === 'explicit') {
      const orderIds = normalizeIdList(input.orderIds, 'SELECTION_ORDER_IDS_INVALID');
      if (exclusions.some((id) => !orderIds.includes(id)))
        throw new Error('SELECTION_EXCLUSIONS_INVALID');
      this.verifyOrderIds(context, orderIds);
      query = { orderIds };
    } else {
      query = normalizeOrderQuery(input.query ?? {}, 'SELECTION_QUERY_INVALID');
      this.verifyOrderIds(context, exclusions);
    }
    const selection: SelectionData = { mode: input.mode, query, exclusions, watermark };
    const queryJson = serializeBoundedJson(query, MAX_SELECTION_JSON, 'SELECTION_QUERY_TOO_LARGE');
    const exclusionsJson = serializeBoundedJson(
      exclusions,
      MAX_SELECTION_JSON,
      'SELECTION_EXCLUSIONS_TOO_LARGE',
    );
    const now = new Date().toISOString();
    const expiresAt = normalizeExpiry(input.expiresAt);
    const estimatedCount = this.countSelection(context, selection);
    const id = randomId();
    this.db
      .prepare(
        'INSERT INTO selection_snapshots (id, account_id, created_by, mode, query_json, query_hash, exclusions_json, watermark, estimated_count, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        context.accountId,
        actorId,
        input.mode,
        queryJson,
        requireHash(queryJson),
        exclusionsJson,
        watermark,
        estimatedCount,
        expiresAt,
        now,
      );
    this.audit(context, 'selection.created', 'selection', id, {
      mode: input.mode,
      estimatedCount,
      exclusionCount: exclusions.length,
      watermark,
    });
    return this.selectionSnapshot(this.selectionRow(context, id));
  }

  getSelection(context: AccountContext, selectionId: string): SelectionSnapshot {
    this.assertMember(context);
    return this.selectionSnapshot(this.selectionRow(context, selectionId));
  }

  deleteSelection(context: AccountContext, selectionId: string): void {
    this.requireMutationActor(context);
    this.selectionRow(context, selectionId);
    const activeJobs = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM bulk_jobs WHERE account_id = ? AND selection_id = ?)
          + (SELECT COUNT(*) FROM export_batches WHERE account_id = ? AND selection_id = ?) AS count`,
      )
      .get(context.accountId, selectionId, context.accountId, selectionId) as { count: number };
    if (Number(activeJobs.count) > 0) throw new Error('SELECTION_IN_USE');
    const result = this.db
      .prepare('DELETE FROM selection_snapshots WHERE account_id = ? AND id = ?')
      .run(context.accountId, selectionId);
    if (result.changes !== 1) throw new Error('SELECTION_NOT_FOUND');
    this.audit(context, 'selection.deleted', 'selection', selectionId, {});
  }

  resolveSelection(
    context: AccountContext,
    selectionId: string,
    input: { cursor?: string | null; limit?: number } = {},
  ): SelectionPage {
    this.assertMember(context);
    const row = this.selectionRow(context, selectionId);
    this.assertSelectionActive(row);
    const selection = this.selectionData(row);
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('SELECTION_LIMIT_INVALID');
    const cursor = input.cursor ? readSelectionCursor(input.cursor) : null;
    const where = this.compileSelectionWhere(context, selection);
    if (cursor) {
      where.sql += ' AND o.id > ?';
      where.params.push(cursor);
    }
    const rows = this.db
      .prepare(`SELECT o.id FROM orders o WHERE ${where.sql} ORDER BY o.id ASC LIMIT ?`)
      .all(...where.params, limit + 1) as Array<{ id: string }>;
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit).map((item) => item.id);
    return {
      items: visible,
      hasMore,
      nextCursor: hasMore && visible.length > 0 ? selectionCursor(visible.at(-1) as string) : null,
      totalCount: this.countSelection(context, selection),
    };
  }

  createExportProfile(
    context: AccountContext,
    input: { name: string; description?: string },
  ): ExportProfile {
    const actorId = this.requireMutationActor(context);
    const name = normalizeExportName(input.name, 'EXPORT_PROFILE_NAME_INVALID', 120);
    const description =
      input.description === undefined
        ? null
        : normalizeExportName(input.description, 'EXPORT_DESCRIPTION_INVALID', 500);
    const now = new Date().toISOString();
    const id = randomId();
    try {
      this.db
        .prepare(
          'INSERT INTO export_profiles (id, account_id, name, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
        )
        .run(id, context.accountId, name, description, now, now);
    } catch {
      throw new Error('EXPORT_PROFILE_NAME_EXISTS');
    }
    this.audit(context, 'export-profile.created', 'export_profile', id, { name, actorId });
    return exportProfile(
      this.db
        .prepare(
          'SELECT id, account_id, name, description, active, created_at, updated_at FROM export_profiles WHERE account_id = ? AND id = ?',
        )
        .get(context.accountId, id) as ExportProfileRow,
    );
  }

  listExportProfiles(context: AccountContext): ExportProfile[] {
    this.assertMember(context);
    const rows = this.db
      .prepare(
        'SELECT id, account_id, name, description, active, created_at, updated_at FROM export_profiles WHERE account_id = ? ORDER BY name COLLATE NOCASE, id',
      )
      .all(context.accountId) as ExportProfileRow[];
    return rows.map(exportProfile);
  }

  createExportProfileVersion(
    context: AccountContext,
    profileId: string,
    input: {
      format: ExportFormat;
      rowMode: ExportRowMode;
      columns: readonly ExportColumn[];
      filenameTemplate: string;
      config?: Record<string, unknown>;
    },
  ): ExportProfileVersion {
    const actorId = this.requireMutationActor(context);
    const profile = this.db
      .prepare('SELECT id, active FROM export_profiles WHERE account_id = ? AND id = ?')
      .get(context.accountId, profileId) as { id: string; active: number } | undefined;
    if (!profile || profile.active !== 1) throw new Error('EXPORT_PROFILE_NOT_FOUND');
    const format = normalizeExportFormat(input.format);
    const rowMode = normalizeExportRowMode(input.rowMode);
    const columns = normalizeExportColumns(input.columns);
    const filenameTemplate = normalizeExportName(
      input.filenameTemplate,
      'EXPORT_FILENAME_INVALID',
      180,
    );
    if (
      !/^[\p{L}\p{N}._{}-]+$/u.test(filenameTemplate) ||
      filenameTemplate.includes('..') ||
      filenameTemplate.includes('{format}') === false
    )
      throw new Error('EXPORT_FILENAME_INVALID');
    const config = input.config ?? {};
    if (!isRecord(config)) throw new Error('EXPORT_CONFIG_INVALID');
    const columnsJson = serializeBoundedJson(columns, 32 * 1024, 'EXPORT_COLUMNS_TOO_LARGE');
    const configJson = serializeBoundedJson(config, 32 * 1024, 'EXPORT_CONFIG_TOO_LARGE');
    const previous = this.db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM export_profile_versions WHERE account_id = ? AND profile_id = ?',
      )
      .get(context.accountId, profileId) as { version: number };
    const version = Number(previous.version) + 1;
    const now = new Date().toISOString();
    const id = randomId();
    this.db
      .prepare(
        'INSERT INTO export_profile_versions (id, account_id, profile_id, version, format, row_mode, columns_json, filename_template, config_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        context.accountId,
        profileId,
        version,
        format,
        rowMode,
        columnsJson,
        filenameTemplate,
        configJson,
        actorId,
        now,
      );
    this.audit(context, 'export-profile.version-created', 'export_profile', profileId, {
      version,
      format,
      rowMode,
    });
    return this.getExportProfileVersion(context, id);
  }

  getExportProfileVersion(context: AccountContext, versionId: string): ExportProfileVersion {
    this.assertMember(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, profile_id, version, format, row_mode, columns_json, filename_template, config_json, created_by, created_at FROM export_profile_versions WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, versionId) as ExportProfileVersionRow | undefined;
    if (!row) throw new Error('EXPORT_PROFILE_VERSION_NOT_FOUND');
    return exportProfileVersion(row);
  }

  createExportBatch(
    context: AccountContext,
    input: { selectionId: string; profileVersionId: string; idempotencyKey: string },
  ): ExportBatch {
    const actorId = this.requireMutationActor(context);
    const selection = this.selectionRow(context, input.selectionId);
    this.assertSelectionActive(selection);
    const version = this.db
      .prepare(
        `SELECT v.id, v.format, v.row_mode, p.active FROM export_profile_versions v
         JOIN export_profiles p ON p.account_id = v.account_id AND p.id = v.profile_id
         WHERE v.account_id = ? AND v.id = ?`,
      )
      .get(context.accountId, input.profileVersionId) as
      { id: string; format: ExportFormat; row_mode: ExportRowMode; active: number } | undefined;
    if (!version || version.active !== 1) throw new Error('EXPORT_PROFILE_VERSION_NOT_FOUND');
    const idempotencyKey = normalizeExportName(
      input.idempotencyKey,
      'EXPORT_IDEMPOTENCY_KEY_INVALID',
      200,
    );
    const now = new Date().toISOString();
    const id = randomId();
    this.db
      .prepare(
        `INSERT INTO export_batches
          (id, account_id, selection_id, profile_version_id, format, row_mode, status, watermark,
           order_count, row_count, created_by, idempotency_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)
         ON CONFLICT(account_id, idempotency_key) DO NOTHING`,
      )
      .run(
        id,
        context.accountId,
        input.selectionId,
        input.profileVersionId,
        version.format,
        version.row_mode,
        selection.watermark,
        selection.estimated_count,
        actorId,
        idempotencyKey,
        now,
        now,
      );
    const row = this.db
      .prepare(
        `SELECT id, account_id, selection_id, profile_version_id, format, row_mode, status, watermark,
          order_count, row_count, filename, file_path, checksum, created_by, idempotency_key, error,
          created_at, updated_at, completed_at FROM export_batches WHERE account_id = ? AND idempotency_key = ?`,
      )
      .get(context.accountId, idempotencyKey) as ExportBatchRow | undefined;
    if (!row) throw new Error('EXPORT_BATCH_CREATE_FAILED');
    if (row.selection_id !== input.selectionId || row.profile_version_id !== input.profileVersionId)
      throw new Error('EXPORT_IDEMPOTENCY_CONFLICT');
    if (row.status === 'queued' && row.id === id)
      this.audit(context, 'export-batch.created', 'export_batch', row.id, {
        selectionId: row.selection_id,
        profileVersionId: row.profile_version_id,
        orderCount: row.order_count,
      });
    return exportBatch(row);
  }

  getExportBatch(context: AccountContext, batchId: string): ExportBatch {
    this.assertMember(context);
    const row = this.db
      .prepare(
        `SELECT id, account_id, selection_id, profile_version_id, format, row_mode, status, watermark,
          order_count, row_count, filename, file_path, checksum, created_by, idempotency_key, error,
          created_at, updated_at, completed_at FROM export_batches WHERE account_id = ? AND id = ?`,
      )
      .get(context.accountId, batchId) as ExportBatchRow | undefined;
    if (!row) throw new Error('EXPORT_BATCH_NOT_FOUND');
    return exportBatch(row);
  }

  listExportBatches(context: AccountContext, limit = 100): ExportBatch[] {
    this.assertMember(context);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('EXPORT_BATCH_LIMIT_INVALID');
    const rows = this.db
      .prepare(
        `SELECT id, account_id, selection_id, profile_version_id, format, row_mode, status, watermark,
          order_count, row_count, filename, file_path, checksum, created_by, idempotency_key, error,
          created_at, updated_at, completed_at FROM export_batches WHERE account_id = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
      )
      .all(context.accountId, limit) as ExportBatchRow[];
    return rows.map(exportBatch);
  }

  startExportBatch(context: AccountContext, batchId: string): ExportBatch {
    this.assertMember(context);
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE export_batches SET status = 'running', updated_at = ? WHERE account_id = ? AND id = ? AND status = 'queued'`,
      )
      .run(now, context.accountId, batchId);
    return this.getExportBatch(context, batchId);
  }

  completeExportBatch(
    context: AccountContext,
    batchId: string,
    input: {
      orderCount: number;
      rowCount: number;
      filename: string;
      filePath: string;
      checksum: string;
    },
  ): ExportBatch {
    this.assertMember(context);
    if (!Number.isInteger(input.orderCount) || input.orderCount < 0 || input.orderCount > 100_000)
      throw new Error('EXPORT_ORDER_COUNT_INVALID');
    if (!Number.isInteger(input.rowCount) || input.rowCount < 0 || input.rowCount > 200_000)
      throw new Error('EXPORT_ROW_COUNT_INVALID');
    const filename = normalizeExportName(input.filename, 'EXPORT_FILENAME_INVALID', 180);
    const filePath = normalizeExportName(input.filePath, 'EXPORT_FILE_PATH_INVALID', 500);
    if (filePath.includes('..') || filePath.includes('\\') || filePath.startsWith('/'))
      throw new Error('EXPORT_FILE_PATH_INVALID');
    if (!/^[a-f0-9]{64}$/i.test(input.checksum)) throw new Error('EXPORT_CHECKSUM_INVALID');
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE export_batches SET status = 'completed', order_count = ?, row_count = ?, filename = ?,
          file_path = ?, checksum = ?, error = NULL, updated_at = ?, completed_at = ?
         WHERE account_id = ? AND id = ? AND status IN ('queued', 'running')`,
      )
      .run(
        input.orderCount,
        input.rowCount,
        filename,
        filePath,
        input.checksum.toLowerCase(),
        now,
        now,
        context.accountId,
        batchId,
      );
    if (result.changes !== 1) {
      const existing = this.getExportBatch(context, batchId);
      if (
        existing.status === 'completed' &&
        existing.checksum === input.checksum.toLowerCase() &&
        existing.orderCount === input.orderCount &&
        existing.rowCount === input.rowCount
      )
        return existing;
      throw new Error('EXPORT_BATCH_STATE_CONFLICT');
    }
    this.audit(context, 'export-batch.completed', 'export_batch', batchId, {
      orderCount: input.orderCount,
      rowCount: input.rowCount,
      checksum: input.checksum.toLowerCase(),
    });
    return this.getExportBatch(context, batchId);
  }

  failExportBatch(context: AccountContext, batchId: string, error: string): ExportBatch {
    this.assertMember(context);
    const message = normalizeExportName(error, 'EXPORT_ERROR_INVALID', 500);
    const result = this.db
      .prepare(
        `UPDATE export_batches SET status = 'failed', error = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status IN ('queued', 'running')`,
      )
      .run(message, new Date().toISOString(), context.accountId, batchId);
    if (result.changes !== 1 && this.getExportBatch(context, batchId).status !== 'failed')
      throw new Error('EXPORT_BATCH_STATE_CONFLICT');
    return this.getExportBatch(context, batchId);
  }

  recordExportedOrders(
    context: AccountContext,
    batchId: string,
    orderIds: readonly string[],
    snapshotHash?: string,
  ): { recorded: number; orderIds: readonly string[] } {
    const actorId = this.requireMutationActor(context);
    if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > 5_000)
      throw new Error('EXPORT_ORDER_IDS_INVALID');
    if (new Set(orderIds).size !== orderIds.length) throw new Error('EXPORT_ORDER_IDS_INVALID');
    if (snapshotHash !== undefined && !/^[a-f0-9]{64}$/i.test(snapshotHash))
      throw new Error('EXPORT_SNAPSHOT_HASH_INVALID');
    const batch = this.db
      .prepare(
        'SELECT id, selection_id, status FROM export_batches WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, batchId) as
      { id: string; selection_id: string; status: ExportBatchStatus } | undefined;
    if (!batch) throw new Error('EXPORT_BATCH_NOT_FOUND');
    if (batch.status !== 'completed') throw new Error('EXPORT_BATCH_NOT_COMPLETED');
    this.verifyOrderIds(context, orderIds);
    const selection = this.selectionData(this.selectionRow(context, batch.selection_id));
    const selectedWhere = this.compileSelectionWhere(context, selection);
    const selected = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM orders o WHERE ${selectedWhere.sql} AND o.id IN (${orderIds.map(() => '?').join(',')})`,
      )
      .get(...selectedWhere.params, ...orderIds) as { count: number };
    if (Number(selected.count) !== orderIds.length)
      throw new Error('EXPORT_ORDER_NOT_IN_SELECTION');
    const now = new Date().toISOString();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO order_export_events
        (id, account_id, order_id, batch_id, event_type, snapshot_hash, created_by, created_at)
       VALUES (?, ?, ?, ?, 'exported', ?, ?, ?)`,
    );
    const placeholders = orderIds.map(() => '?').join(',');
    const result = this.db.transaction(() => {
      let recorded = 0;
      for (const orderId of orderIds) {
        const inserted = insert.run(
          randomId(),
          context.accountId,
          orderId,
          batchId,
          snapshotHash?.toLowerCase() ?? null,
          actorId,
          now,
        );
        recorded += inserted.changes;
      }
      this.db
        .prepare(
          `UPDATE orders SET export_state = 'exported', stale_export_at = NULL, updated_at = ?
           WHERE account_id = ? AND id IN (${placeholders})`,
        )
        .run(now, context.accountId, ...orderIds);
      return recorded;
    })();
    this.audit(context, 'order-export.recorded', 'export_batch', batchId, {
      orderCount: orderIds.length,
      recorded: result,
    });
    return { recorded: result, orderIds: [...orderIds] };
  }

  listOrderExportEvents(context: AccountContext, orderId: string): OrderExportEvent[] {
    this.assertMember(context);
    const order = this.db
      .prepare('SELECT id FROM orders WHERE account_id = ? AND id = ?')
      .get(context.accountId, orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const rows = this.db
      .prepare(
        `SELECT id, account_id, order_id, batch_id, event_type, snapshot_hash, reason, created_by, created_at
         FROM order_export_events WHERE account_id = ? AND order_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(context.accountId, orderId) as OrderExportEventRow[];
    return rows.map(orderExportEvent);
  }

  unexportOrder(context: AccountContext, orderId: string, reason: string): OrderExportEvent {
    const role = this.assertMember(context);
    if (role !== 'owner' && role !== 'admin') throw new Error('EXPORT_UNEXPORT_PERMISSION_DENIED');
    const actorId = this.requireMutationActor(context);
    const normalizedReason = normalizeExportName(reason, 'EXPORT_UNEXPORT_REASON_INVALID', 500);
    const order = this.db
      .prepare('SELECT id FROM orders WHERE account_id = ? AND id = ?')
      .get(context.accountId, orderId) as { id: string } | undefined;
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const now = new Date().toISOString();
    const eventId = randomId();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO order_export_events
            (id, account_id, order_id, batch_id, event_type, reason, created_by, created_at)
           VALUES (?, ?, ?, NULL, 'unexported', ?, ?, ?)`,
        )
        .run(eventId, context.accountId, orderId, normalizedReason, actorId, now);
      this.db
        .prepare(
          `UPDATE orders SET export_state = 'never-exported', stale_export_at = NULL, updated_at = ?
           WHERE account_id = ? AND id = ?`,
        )
        .run(now, context.accountId, orderId);
    })();
    this.audit(context, 'order-export.unexported', 'order', orderId, {
      reason: normalizedReason,
    });
    return orderExportEvent(
      this.db
        .prepare(
          'SELECT id, account_id, order_id, batch_id, event_type, snapshot_hash, reason, created_by, created_at FROM order_export_events WHERE account_id = ? AND id = ?',
        )
        .get(context.accountId, eventId) as OrderExportEventRow,
    );
  }

  listCostRules(
    context: AccountContext,
    input: { scope?: CostRuleScope; currency?: string } = {},
  ): CostRuleRecord[] {
    this.assertMember(context);
    return this.listCostRulesForContext(context, input);
  }

  private listCostRulesForContext(
    context: AccountContext,
    input: { scope?: CostRuleScope; currency?: string } = {},
  ): CostRuleRecord[] {
    const clauses = ['account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.scope !== undefined) {
      clauses.push('scope = ?');
      params.push(normalizeAnalyticsScope(input.scope));
    }
    if (input.currency !== undefined) {
      clauses.push('currency = ?');
      params.push(normalizeAnalyticsCurrency(input.currency));
    }
    const rows = this.db
      .prepare(
        `SELECT id, account_id, scope, rule_key, currency, amount_minor, source,
          effective_from, effective_to, version, active, created_by, created_at, updated_at
         FROM cost_rules WHERE ${clauses.join(' AND ')} ORDER BY effective_from DESC, id DESC`,
      )
      .all(...params) as CostRuleRow[];
    return rows.map(costRule);
  }

  createCostRule(
    context: AccountContext,
    input: {
      scope: CostRuleScope;
      key: string;
      currency: string;
      amountMinor: string;
      source: string;
      effectiveFrom: string;
      effectiveTo?: string | null;
      active?: boolean;
    },
  ): CostRuleRecord {
    const actorId = this.requireMutationActor(context);
    const scope = normalizeAnalyticsScope(input.scope);
    const key = normalizeAnalyticsKey(input.key);
    const currency = normalizeAnalyticsCurrency(input.currency);
    const amountMinor = normalizeAnalyticsMinor(input.amountMinor);
    const source = normalizeDocumentText(input.source, 'COST_RULE_SOURCE_INVALID', 120);
    const effectiveFrom = normalizeAnalyticsDate(input.effectiveFrom, 'COST_RULE_DATE_INVALID');
    const effectiveTo =
      input.effectiveTo === undefined || input.effectiveTo === null
        ? null
        : normalizeAnalyticsDate(input.effectiveTo, 'COST_RULE_DATE_INVALID');
    if (effectiveTo !== null && effectiveTo <= effectiveFrom)
      throw new Error('COST_RULE_DATE_RANGE_INVALID');
    const active = input.active ?? true;
    if (active) {
      const overlap = this.db
        .prepare(
          `SELECT id FROM cost_rules
           WHERE account_id = ? AND scope = ? AND rule_key = ? AND currency = ? AND active = 1
             AND effective_from < COALESCE(?, '9999-12-31T23:59:59.999Z')
             AND COALESCE(effective_to, '9999-12-31T23:59:59.999Z') > ? LIMIT 1`,
        )
        .get(context.accountId, scope, key, currency, effectiveTo, effectiveFrom);
      if (overlap) throw new Error('COST_RULE_DATE_OVERLAP');
    }
    const versionRow = this.db
      .prepare(
        'SELECT COALESCE(MAX(version), 0) AS version FROM cost_rules WHERE account_id = ? AND scope = ? AND rule_key = ? AND currency = ?',
      )
      .get(context.accountId, scope, key, currency) as { version: number };
    const version = versionRow.version + 1;
    const id = randomId();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO cost_rules
          (id, account_id, scope, rule_key, currency, amount_minor, source, effective_from,
           effective_to, version, active, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        context.accountId,
        scope,
        key,
        currency,
        amountMinor,
        source,
        effectiveFrom,
        effectiveTo,
        version,
        active ? 1 : 0,
        actorId,
        now,
        now,
      );
    this.audit(context, 'cost-rule.created', 'cost_rule', id, {
      scope,
      key,
      currency,
      effectiveFrom,
      version,
    });
    return costRule(
      this.db
        .prepare(
          `SELECT id, account_id, scope, rule_key, currency, amount_minor, source,
            effective_from, effective_to, version, active, created_by, created_at, updated_at
           FROM cost_rules WHERE account_id = ? AND id = ?`,
        )
        .get(context.accountId, id) as CostRuleRow,
    );
  }

  updateCostRule(
    context: AccountContext,
    ruleId: string,
    input: { active?: boolean; effectiveTo?: string | null },
  ): CostRuleRecord {
    const role = this.assertMember(context);
    if (role !== 'owner' && role !== 'admin') throw new Error('COST_RULE_PERMISSION_DENIED');
    const actorId = this.requireMutationActor(context);
    const current = this.db
      .prepare(
        `SELECT id, account_id, scope, rule_key, currency, amount_minor, source,
          effective_from, effective_to, version, active, created_by, created_at, updated_at
         FROM cost_rules WHERE account_id = ? AND id = ?`,
      )
      .get(context.accountId, ruleId) as CostRuleRow | undefined;
    if (!current) throw new Error('COST_RULE_NOT_FOUND');
    const active = input.active === undefined ? current.active === 1 : input.active;
    const effectiveTo =
      input.effectiveTo === undefined
        ? current.effective_to
        : input.effectiveTo === null
          ? null
          : normalizeAnalyticsDate(input.effectiveTo, 'COST_RULE_DATE_INVALID');
    if (effectiveTo !== null && effectiveTo <= current.effective_from)
      throw new Error('COST_RULE_DATE_RANGE_INVALID');
    if (active) {
      const overlap = this.db
        .prepare(
          `SELECT id FROM cost_rules
           WHERE account_id = ? AND scope = ? AND rule_key = ? AND currency = ? AND active = 1 AND id <> ?
             AND effective_from < COALESCE(?, '9999-12-31T23:59:59.999Z')
             AND COALESCE(effective_to, '9999-12-31T23:59:59.999Z') > ? LIMIT 1`,
        )
        .get(
          context.accountId,
          current.scope,
          current.rule_key,
          current.currency,
          ruleId,
          effectiveTo,
          current.effective_from,
        );
      if (overlap) throw new Error('COST_RULE_DATE_OVERLAP');
    }
    const now = new Date().toISOString();
    const changed = this.db
      .prepare(
        `UPDATE cost_rules SET active = ?, effective_to = ?, version = version + 1, updated_at = ?
         WHERE account_id = ? AND id = ?`,
      )
      .run(active ? 1 : 0, effectiveTo, now, context.accountId, ruleId);
    if (changed.changes !== 1) throw new Error('COST_RULE_NOT_FOUND');
    this.audit(context, 'cost-rule.updated', 'cost_rule', ruleId, {
      active,
      effectiveTo,
      actorId,
    });
    return costRule(
      this.db
        .prepare(
          `SELECT id, account_id, scope, rule_key, currency, amount_minor, source,
            effective_from, effective_to, version, active, created_by, created_at, updated_at
           FROM cost_rules WHERE account_id = ? AND id = ?`,
        )
        .get(context.accountId, ruleId) as CostRuleRow,
    );
  }

  listOrderCostSnapshots(context: AccountContext, orderId: string): OrderCostSnapshotRecord[] {
    this.assertMember(context);
    const rows = this.db
      .prepare(
        `SELECT id, account_id, order_id, line_id, rule_id, currency, source, effective_at,
          quantity, unit_cost_minor, total_cost_minor, source_hash, created_at
         FROM order_cost_snapshots WHERE account_id = ? AND order_id = ? ORDER BY line_id`,
      )
      .all(context.accountId, orderId) as OrderCostSnapshotRow[];
    return rows.map(orderCostSnapshot);
  }

  private analyticsFactRows(
    context: AccountContext,
    input: AnalyticsFilter = {},
  ): DailyAnalyticsFactRow[] {
    this.assertMember(context);
    const clauses = ['account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.from !== undefined) {
      clauses.push('fact_date >= ?');
      params.push(normalizeAnalyticsDateKey(input.from));
    }
    if (input.to !== undefined) {
      clauses.push('fact_date <= ?');
      params.push(normalizeAnalyticsDateKey(input.to));
    }
    if (input.source !== undefined && input.source !== 'combined') {
      clauses.push('source = ?');
      params.push(input.source);
    }
    if (input.currency !== undefined) {
      clauses.push('currency = ?');
      params.push(normalizeAnalyticsCurrency(input.currency));
    }
    if (input.store !== undefined) {
      clauses.push(
        `LOWER(COALESCE(json_extract(dimensions_json, '$.store'), '')) LIKE ? ESCAPE '\\'`,
      );
      params.push(analyticsLike(input.store));
    }
    if (input.status !== undefined) {
      clauses.push(
        `(LOWER(COALESCE(json_extract(dimensions_json, '$.remoteStatus'), '')) LIKE ? ESCAPE '\\'
          OR LOWER(COALESCE(json_extract(dimensions_json, '$.localStatus'), '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(analyticsLike(input.status), analyticsLike(input.status));
    }
    if (input.shippingMethod !== undefined) {
      clauses.push(
        `LOWER(COALESCE(json_extract(dimensions_json, '$.shippingMethod'), '')) LIKE ? ESCAPE '\\'`,
      );
      params.push(analyticsLike(input.shippingMethod));
    }
    if (input.product !== undefined) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(dimensions_json, '$.products'), '[]')) AS product
          WHERE LOWER(COALESCE(json_extract(product.value, '$.product'), '')) LIKE ? ESCAPE '\\'
             OR LOWER(COALESCE(json_extract(product.value, '$.variation'), '')) LIKE ? ESCAPE '\\'
             OR LOWER(COALESCE(json_extract(product.value, '$.sku'), '')) LIKE ? ESCAPE '\\'
             OR LOWER(COALESCE(json_extract(product.value, '$.name'), '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(
        analyticsLike(input.product),
        analyticsLike(input.product),
        analyticsLike(input.product),
        analyticsLike(input.product),
      );
    }
    if (input.category !== undefined) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(dimensions_json, '$.categories'), '[]')) AS category
          WHERE LOWER(COALESCE(category.value, '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(analyticsLike(input.category));
    }
    if (input.author !== undefined) {
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(dimensions_json, '$.authors'), '[]')) AS author
          WHERE LOWER(COALESCE(author.value, '')) LIKE ? ESCAPE '\\')`,
      );
      params.push(analyticsLike(input.author));
    }
    return this.db
      .prepare(
        `SELECT account_id, fact_date, currency, source, dimension_hash, dimensions_json,
          order_count, line_count, gross_sales_minor, discount_minor, net_merchandise_minor,
          shipping_collected_minor, tax_minor, refunds_minor, collected_revenue_minor, cogs_minor,
          actual_shipping_cost_minor, payment_fees_minor, return_cost_minor, contribution_profit_minor,
          metrics_version, rebuilt_at FROM daily_order_facts WHERE ${clauses.join(' AND ')}
         ORDER BY fact_date ASC, currency ASC, source ASC, dimension_hash ASC`,
      )
      .all(...params) as DailyAnalyticsFactRow[];
  }

  listAnalyticsFacts(
    context: AccountContext,
    input: AnalyticsFilter = {},
  ): DailyAnalyticsFactRecord[] {
    return this.analyticsFactRows(context, input).map(dailyAnalyticsFact);
  }

  getAnalyticsSummary(context: AccountContext, input: AnalyticsFilter = {}) {
    const rows = this.analyticsFactRows(context, input);
    const byCurrency = new Map<
      string,
      { orderCount: number; lineCount: number; totals: MetricTotals }
    >();
    for (const row of rows) {
      const current = byCurrency.get(row.currency) ?? {
        orderCount: 0,
        lineCount: 0,
        totals: emptyAnalyticsTotals(),
      };
      current.orderCount += row.order_count;
      current.lineCount += row.line_count;
      current.totals = addAnalyticsTotals(current.totals, dailyAnalyticsFact(row).totals);
      byCurrency.set(row.currency, current);
    }
    const coverageClauses = ['s.account_id = ?'];
    const coverageParams: (string | number)[] = [context.accountId];
    if (input.source !== undefined && input.source !== 'combined') {
      coverageClauses.push('o.origin = ?');
      coverageParams.push(input.source);
    }
    if (input.currency !== undefined) {
      coverageClauses.push('s.currency = ?');
      coverageParams.push(normalizeAnalyticsCurrency(input.currency));
    }
    const coverage = this.db
      .prepare(
        `SELECT COUNT(*) AS total_lines,
          COALESCE(SUM(CASE WHEN s.source <> 'missing' THEN 1 ELSE 0 END), 0) AS covered_lines
         FROM order_cost_snapshots s JOIN orders o ON o.id = s.order_id AND o.account_id = s.account_id
         WHERE ${coverageClauses.join(' AND ')}`,
      )
      .get(...coverageParams) as { total_lines: number; covered_lines: number };
    const freshness = rows.reduce<string | null>(
      (latest, row) => (!latest || row.rebuilt_at > latest ? row.rebuilt_at : latest),
      null,
    );
    const totalLines = Number(coverage.total_lines);
    const coveredLines = Number(coverage.covered_lines);
    return {
      source: input.source ?? 'combined',
      from: input.from ?? null,
      to: input.to ?? null,
      excludedStatuses: ['cancelled', 'failed', 'trash'],
      metricsVersion: 1,
      definitions: metricDefinitions(),
      freshness: { lastRebuiltAt: freshness },
      costCoverage: {
        scope: 'account',
        coveredLines,
        totalLines,
        percentage: totalLines === 0 ? null : Math.round((coveredLines / totalLines) * 10000) / 100,
      },
      currencies: [...byCurrency.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, value]) => ({ currency, ...value })),
    };
  }

  getAnalyticsTimeseries(context: AccountContext, input: AnalyticsFilter = {}) {
    const rows = this.analyticsFactRows(context, input);
    const values = new Map<
      string,
      {
        date: string;
        currency: string;
        source: 'woo' | 'manual';
        orderCount: number;
        lineCount: number;
        totals: MetricTotals;
      }
    >();
    for (const row of rows) {
      const key = `${row.fact_date}|${row.currency}|${row.source}`;
      const current = values.get(key) ?? {
        date: row.fact_date,
        currency: row.currency,
        source: row.source,
        orderCount: 0,
        lineCount: 0,
        totals: emptyAnalyticsTotals(),
      };
      current.orderCount += row.order_count;
      current.lineCount += row.line_count;
      current.totals = addAnalyticsTotals(current.totals, dailyAnalyticsFact(row).totals);
      values.set(key, current);
    }
    return { source: input.source ?? 'combined', items: [...values.values()] };
  }

  getAnalyticsBreakdown(
    context: AccountContext,
    input: AnalyticsFilter & {
      dimension?:
        | 'source'
        | 'currency'
        | 'channel'
        | 'pos'
        | 'store'
        | 'shippingMethod'
        | 'paymentMethod'
        | 'status'
        | 'product'
        | 'category'
        | 'author';
    } = {},
  ) {
    const dimension = input.dimension ?? 'source';
    const rows = this.analyticsFactRows(context, input);
    const values = new Map<
      string,
      { key: string; currency: string; orderCount: number; lineCount: number; totals: MetricTotals }
    >();
    for (const row of rows) {
      const dimensions = dailyAnalyticsFact(row).dimensions;
      const productValues = Array.isArray(dimensions.products)
        ? dimensions.products.flatMap((item) => {
            if (!isRecord(item)) return [];
            const value = item.product ?? item.variation ?? item.sku ?? item.name;
            return value === null || value === undefined ? [] : [String(value)];
          })
        : [];
      const listDimension = dimensions[`${dimension}s`];
      const dimensionValues =
        dimension === 'source'
          ? [row.source]
          : dimension === 'currency'
            ? [row.currency]
            : dimension === 'status'
              ? [String(dimensions.remoteStatus ?? dimensions.localStatus ?? 'unknown')]
              : dimension === 'product'
                ? productValues
                : dimension === 'category' || dimension === 'author'
                  ? Array.isArray(listDimension)
                    ? listDimension.map(String)
                    : []
                  : [String(dimensions[dimension] ?? 'unknown')];
      for (const value of dimensionValues.length > 0 ? dimensionValues : ['unknown']) {
        const mapKey = `${row.currency}|${value}`;
        const current = values.get(mapKey) ?? {
          key: value,
          currency: row.currency,
          orderCount: 0,
          lineCount: 0,
          totals: emptyAnalyticsTotals(),
        };
        current.orderCount += row.order_count;
        current.lineCount += row.line_count;
        current.totals = addAnalyticsTotals(current.totals, dailyAnalyticsFact(row).totals);
        values.set(mapKey, current);
      }
    }
    return {
      dimension,
      source: input.source ?? 'combined',
      items: [...values.values()].sort((left, right) => left.key.localeCompare(right.key)),
    };
  }

  rebuildAnalyticsFacts(
    context: AccountContext,
    input: AnalyticsFilter = {},
  ): AnalyticsRebuildResult {
    this.assertMember(context);
    return this.rebuildAnalyticsFactsInternal(context, input);
  }

  rebuildAnalyticsFactsForWorker(
    context: AccountContext,
    input: AnalyticsFilter = {},
  ): AnalyticsRebuildResult {
    this.assertContext(context);
    return this.rebuildAnalyticsFactsInternal(context, input);
  }

  private rebuildAnalyticsFactsInternal(
    context: AccountContext,
    input: AnalyticsFilter = {},
  ): AnalyticsRebuildResult {
    const from = input.from === undefined ? null : normalizeAnalyticsDateKey(input.from);
    const to = input.to === undefined ? null : normalizeAnalyticsDateKey(input.to);
    if (from !== null && to !== null && from > to) throw new Error('ANALYTICS_DATE_RANGE_INVALID');
    const currency =
      input.currency === undefined ? undefined : normalizeAnalyticsCurrency(input.currency);
    const source = input.source ?? 'combined';
    const account = this.db
      .prepare('SELECT timezone FROM accounts WHERE id = ?')
      .get(context.accountId) as { timezone: string } | undefined;
    if (!account) throw new Error('ACCOUNT_NOT_FOUND');
    const rules = this.listCostRulesForContext(context);
    const orderRows = this.db
      .prepare(
        `SELECT id, origin, connection_id, order_number, external_order_id, remote_status,
          local_status, export_state, stale_export_at, currency, grand_total_minor, source_hash,
          remote_modified_at, normalized_json, created_at FROM orders WHERE account_id = ? ORDER BY id ASC`,
      )
      .all(context.accountId) as Array<Record<string, unknown>>;
    const snapshotSelect = this.db.prepare(
      `SELECT id, account_id, order_id, line_id, rule_id, currency, source, effective_at,
        quantity, unit_cost_minor, total_cost_minor, source_hash, created_at
       FROM order_cost_snapshots WHERE account_id = ? AND order_id = ? ORDER BY line_id`,
    );
    const snapshotsInsert = this.db.prepare(
      `INSERT OR IGNORE INTO order_cost_snapshots
        (id, account_id, order_id, line_id, rule_id, currency, source, effective_at, quantity,
         unit_cost_minor, total_cost_minor, source_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const facts = new Map<
      string,
      {
        date: string;
        currency: string;
        source: 'woo' | 'manual';
        dimensions: Record<string, unknown>;
        orderCount: number;
        lineCount: number;
        totals: MetricTotals;
      }
    >();
    let included = 0;
    let excluded = 0;
    let snapshotsWritten = 0;
    const rebuiltAt = new Date().toISOString();
    const results: Array<{ row: Record<string, unknown>; result: OrderMetricResult }> = [];
    for (const row of orderRows) {
      const rowSource = row.origin === 'manual' ? 'manual' : 'woo';
      if (source !== 'combined' && source !== rowSource) continue;
      if (currency !== undefined && row.currency !== currency) continue;
      const normalized = row.normalized_json
        ? parseStoredJson<Record<string, unknown>>(
            String(row.normalized_json),
            'ANALYTICS_DATA_INVALID',
          )
        : {};
      const storedSnapshots = snapshotSelect.all(
        context.accountId,
        row.id,
      ) as OrderCostSnapshotRow[];
      const snapshotMap = new Map(
        storedSnapshots.map((item) => [item.line_id, orderCostSnapshot(item)]),
      );
      const lines = Array.isArray(normalized.lines)
        ? normalized.lines.map((line) => {
            if (!isRecord(line)) return line;
            const lineKey =
              typeof line.lineId === 'string'
                ? line.lineId
                : typeof line.id === 'string'
                  ? line.id
                  : '';
            const snapshot = snapshotMap.get(lineKey);
            return snapshot
              ? {
                  ...line,
                  costSnapshot: {
                    ruleId: snapshot.ruleId,
                    source: snapshot.source,
                    effectiveAt: snapshot.effectiveAt,
                    unitCostMinor: snapshot.unitCostMinor,
                  },
                }
              : line;
          })
        : [];
      const order: Record<string, unknown> = {
        ...normalized,
        id: String(row.id),
        orderNumber: row.order_number,
        externalOrderId: row.external_order_id,
        origin: rowSource,
        connectionId: row.connection_id,
        remoteStatus: row.remote_status,
        localStatus: row.local_status,
        exportState:
          row.stale_export_at && row.export_state === 'exported'
            ? 'changed-after-export'
            : row.export_state,
        currency: row.currency,
        grandTotalMinor: row.grand_total_minor,
        remoteCreatedAt: row.remote_modified_at,
        createdAt: row.created_at,
        lines,
      };
      const result = calculateOrderMetrics(order, rules);
      const date = dateKeyInTimezone(result.date, account.timezone);
      if ((from !== null && date < from) || (to !== null && date > to)) continue;
      if (!result.included) {
        excluded += 1;
        continue;
      }
      included += 1;
      results.push({ row, result });
      const key = `${date}|${result.currency}|${result.source}|${dimensionsFingerprint(result.dimensions)}`;
      const current = facts.get(key);
      if (current) {
        current.orderCount += 1;
        current.lineCount += result.lineCount;
        current.totals = addAnalyticsTotals(current.totals, result.totals);
      } else {
        facts.set(key, {
          date,
          currency: result.currency,
          source: result.source,
          dimensions: result.dimensions,
          orderCount: 1,
          lineCount: result.lineCount,
          totals: result.totals,
        });
      }
    }
    const deleteClauses = ['account_id = ?'];
    const deleteParams: (string | number)[] = [context.accountId];
    if (from !== null) {
      deleteClauses.push('fact_date >= ?');
      deleteParams.push(from);
    }
    if (to !== null) {
      deleteClauses.push('fact_date <= ?');
      deleteParams.push(to);
    }
    if (source !== 'combined') {
      deleteClauses.push('source = ?');
      deleteParams.push(source);
    }
    if (currency !== undefined) {
      deleteClauses.push('currency = ?');
      deleteParams.push(currency);
    }
    const factsInsert = this.db.prepare(
      `INSERT INTO daily_order_facts
        (account_id, fact_date, currency, source, dimension_hash, dimensions_json, order_count, line_count,
         gross_sales_minor, discount_minor, net_merchandise_minor, shipping_collected_minor, tax_minor,
         refunds_minor, collected_revenue_minor, cogs_minor, actual_shipping_cost_minor, payment_fees_minor,
         return_cost_minor, contribution_profit_minor, metrics_version, rebuilt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM daily_order_facts WHERE ${deleteClauses.join(' AND ')}`)
        .run(...deleteParams);
      for (const { row, result } of results) {
        for (const snapshot of result.lineSnapshots) {
          const inserted = snapshotsInsert.run(
            createHash('sha256')
              .update(`${context.accountId}:${row.id}:${snapshot.lineId}`)
              .digest('hex'),
            context.accountId,
            row.id,
            snapshot.lineId,
            snapshot.ruleId,
            result.currency,
            snapshot.source,
            snapshot.effectiveAt,
            snapshot.quantity,
            snapshot.unitCostMinor,
            snapshot.totalCostMinor,
            row.source_hash,
            rebuiltAt,
          );
          snapshotsWritten += inserted.changes;
        }
      }
      for (const fact of facts.values()) {
        const dimensionsJson = JSON.stringify(fact.dimensions);
        const totals = fact.totals;
        factsInsert.run(
          context.accountId,
          fact.date,
          fact.currency,
          fact.source,
          createHash('sha256').update(dimensionsJson).digest('hex'),
          dimensionsJson,
          fact.orderCount,
          fact.lineCount,
          totals.grossSalesMinor,
          totals.discountMinor,
          totals.netMerchandiseMinor,
          totals.shippingCollectedMinor,
          totals.taxMinor,
          totals.refundsMinor,
          totals.collectedRevenueMinor,
          totals.cogsMinor,
          totals.actualShippingCostMinor,
          totals.paymentFeesMinor,
          totals.returnCostMinor,
          totals.contributionProfitMinor,
          rebuiltAt,
        );
      }
    })();
    this.audit(context, 'analytics.rebuilt', 'daily_order_facts', context.accountId, {
      from,
      to,
      source,
      currency: currency ?? null,
      factsWritten: facts.size,
      ordersIncluded: included,
      ordersExcluded: excluded,
    });
    return {
      from,
      to,
      factsWritten: facts.size,
      ordersIncluded: included,
      ordersExcluded: excluded,
      snapshotsWritten,
      rebuiltAt,
    };
  }

  private documentTemplateRow(context: AccountContext, templateId: string): DocumentTemplateRow {
    this.assertMember(context);
    const row = this.db
      .prepare(
        `SELECT id, account_id, name, format, locale, direction, version, body,
          company_name, company_address, footer_text, active, created_by, created_at, updated_at
         FROM document_templates WHERE account_id = ? AND id = ?`,
      )
      .get(context.accountId, templateId) as DocumentTemplateRow | undefined;
    if (!row) throw new Error('DOCUMENT_TEMPLATE_NOT_FOUND');
    return row;
  }

  createDocumentTemplate(
    context: AccountContext,
    input: {
      name: string;
      format: DocumentTemplateFormat;
      locale?: 'ar-EG' | 'en-US';
      direction?: 'rtl' | 'ltr';
      body?: string;
      companyName: string;
      companyAddress?: string;
      footerText?: string;
    },
  ): DocumentTemplateRecord {
    const actorId = this.requireMutationActor(context);
    const name = normalizeDocumentText(input.name, 'DOCUMENT_TEMPLATE_NAME_INVALID', 120);
    const format = normalizeDocumentFormat(input.format);
    const locale = normalizeDocumentLocale(input.locale ?? 'ar-EG');
    const direction = normalizeDocumentDirection(
      input.direction ?? (locale === 'ar-EG' ? 'rtl' : 'ltr'),
    );
    const body = normalizeDocumentBody(input.body);
    const companyName = normalizeDocumentText(input.companyName, 'DOCUMENT_COMPANY_INVALID', 240);
    const companyAddress =
      input.companyAddress === undefined
        ? null
        : normalizeDocumentText(input.companyAddress, 'DOCUMENT_COMPANY_ADDRESS_INVALID', 500);
    const footerText =
      input.footerText === undefined
        ? null
        : normalizeDocumentText(input.footerText, 'DOCUMENT_FOOTER_INVALID', 500);
    const existing = this.db
      .prepare('SELECT id FROM document_templates WHERE account_id = ? AND name = ?')
      .get(context.accountId, name);
    if (existing) throw new Error('DOCUMENT_TEMPLATE_NAME_EXISTS');
    const id = randomId();
    const revisionId = randomId();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `INSERT INTO document_templates
            (id, account_id, name, format, locale, direction, version, body, company_name,
             company_address, footer_text, active, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          id,
          context.accountId,
          name,
          format,
          locale,
          direction,
          body,
          companyName,
          companyAddress,
          footerText,
          actorId,
          now,
          now,
        );
      this.db
        .prepare(
          `INSERT INTO document_template_revisions
            (id, account_id, template_id, version, format, locale, direction, body,
             company_name, company_address, footer_text, created_by, created_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          revisionId,
          context.accountId,
          id,
          format,
          locale,
          direction,
          body,
          companyName,
          companyAddress,
          footerText,
          actorId,
          now,
        );
    })();
    this.audit(context, 'document-template.created', 'document_template', id, { version: 1 });
    return documentTemplate(this.documentTemplateRow(context, id));
  }

  listDocumentTemplates(context: AccountContext): DocumentTemplateRecord[] {
    this.assertMember(context);
    const rows = this.db
      .prepare(
        `SELECT id, account_id, name, format, locale, direction, version, body,
          company_name, company_address, footer_text, active, created_by, created_at, updated_at
         FROM document_templates WHERE account_id = ? ORDER BY name COLLATE NOCASE, id`,
      )
      .all(context.accountId) as DocumentTemplateRow[];
    return rows.map(documentTemplate);
  }

  getDocumentTemplate(context: AccountContext, templateId: string): DocumentTemplateRecord {
    return documentTemplate(this.documentTemplateRow(context, templateId));
  }

  updateDocumentTemplate(
    context: AccountContext,
    templateId: string,
    input: Partial<{
      name: string;
      format: DocumentTemplateFormat;
      locale: 'ar-EG' | 'en-US';
      direction: 'rtl' | 'ltr';
      body: string;
      companyName: string;
      companyAddress: string | null;
      footerText: string | null;
      active: boolean;
    }>,
  ): DocumentTemplateRecord {
    const actorId = this.requireMutationActor(context);
    const current = this.documentTemplateRow(context, templateId);
    const name =
      input.name === undefined
        ? current.name
        : normalizeDocumentText(input.name, 'DOCUMENT_TEMPLATE_NAME_INVALID', 120);
    const format =
      input.format === undefined ? current.format : normalizeDocumentFormat(input.format);
    const locale =
      input.locale === undefined ? current.locale : normalizeDocumentLocale(input.locale);
    const direction =
      input.direction === undefined
        ? current.direction
        : normalizeDocumentDirection(input.direction);
    const body = input.body === undefined ? current.body : normalizeDocumentBody(input.body);
    const companyName =
      input.companyName === undefined
        ? current.company_name
        : normalizeDocumentText(input.companyName, 'DOCUMENT_COMPANY_INVALID', 240);
    const companyAddress =
      input.companyAddress === undefined
        ? current.company_address
        : input.companyAddress === null
          ? null
          : normalizeDocumentText(input.companyAddress, 'DOCUMENT_COMPANY_ADDRESS_INVALID', 500);
    const footerText =
      input.footerText === undefined
        ? current.footer_text
        : input.footerText === null
          ? null
          : normalizeDocumentText(input.footerText, 'DOCUMENT_FOOTER_INVALID', 500);
    if (name !== current.name) {
      const existing = this.db
        .prepare('SELECT id FROM document_templates WHERE account_id = ? AND name = ? AND id <> ?')
        .get(context.accountId, name, templateId);
      if (existing) throw new Error('DOCUMENT_TEMPLATE_NAME_EXISTS');
    }
    const version = current.version + 1;
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const updated = this.db
        .prepare(
          `UPDATE document_templates SET name = ?, format = ?, locale = ?, direction = ?,
            version = ?, body = ?, company_name = ?, company_address = ?, footer_text = ?,
            active = ?, updated_at = ? WHERE account_id = ? AND id = ? AND version = ?`,
        )
        .run(
          name,
          format,
          locale,
          direction,
          version,
          body,
          companyName,
          companyAddress,
          footerText,
          input.active === undefined ? current.active : input.active ? 1 : 0,
          now,
          context.accountId,
          templateId,
          current.version,
        );
      if (updated.changes !== 1) throw new Error('DOCUMENT_TEMPLATE_VERSION_CONFLICT');
      this.db
        .prepare(
          `INSERT INTO document_template_revisions
            (id, account_id, template_id, version, format, locale, direction, body,
             company_name, company_address, footer_text, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomId(),
          context.accountId,
          templateId,
          version,
          format,
          locale,
          direction,
          body,
          companyName,
          companyAddress,
          footerText,
          actorId,
          now,
        );
    })();
    this.audit(context, 'document-template.updated', 'document_template', templateId, { version });
    return documentTemplate(this.documentTemplateRow(context, templateId));
  }

  registerDocumentFile(
    context: AccountContext,
    input: {
      id: string;
      orderId: string;
      templateId: string;
      format: DocumentTemplateFormat;
      relativePath: string;
      filename: string;
      byteSize: number;
      checksum: string;
    },
  ): DocumentFileRecord {
    const actorId = this.requireMutationActor(context);
    if (!/^[A-Za-z0-9_-]{1,80}(?:\/[A-Za-z0-9_-]{1,80})*\.pdf$/u.test(input.relativePath))
      throw new Error('DOCUMENT_FILE_PATH_INVALID');
    const filename = normalizeDocumentText(input.filename, 'DOCUMENT_FILE_NAME_INVALID', 180);
    if (/[\r\n]/u.test(filename) || !filename.toLowerCase().endsWith('.pdf'))
      throw new Error('DOCUMENT_FILE_NAME_INVALID');
    if (
      !Number.isInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > 50 * 1024 * 1024
    )
      throw new Error('DOCUMENT_FILE_SIZE_INVALID');
    if (!/^[a-f0-9]{64}$/iu.test(input.checksum)) throw new Error('DOCUMENT_FILE_CHECKSUM_INVALID');
    this.documentTemplateRow(context, input.templateId);
    const order = this.db
      .prepare('SELECT id FROM orders WHERE account_id = ? AND id = ?')
      .get(context.accountId, input.orderId);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO document_files
            (id, account_id, order_id, template_id, format, relative_path, filename,
             mime_type, byte_size, checksum, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          context.accountId,
          input.orderId,
          input.templateId,
          normalizeDocumentFormat(input.format),
          input.relativePath,
          filename,
          input.byteSize,
          input.checksum.toLowerCase(),
          actorId,
          now,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        const existing = this.db
          .prepare(
            `SELECT id, account_id, order_id, template_id, format, relative_path, filename,
              mime_type, byte_size, checksum, created_by, created_at
             FROM document_files WHERE account_id = ? AND id = ?`,
          )
          .get(context.accountId, input.id) as DocumentFileRow | undefined;
        if (existing && existing.checksum === input.checksum.toLowerCase())
          return documentFile(existing);
      }
      throw error;
    }
    this.audit(context, 'document-file.created', 'document_file', input.id, {
      orderId: input.orderId,
    });
    return this.getDocumentFile(context, input.id);
  }

  getDocumentFile(context: AccountContext, fileId: string): DocumentFileRecord {
    this.assertMember(context);
    const row = this.db
      .prepare(
        `SELECT id, account_id, order_id, template_id, format, relative_path, filename,
          mime_type, byte_size, checksum, created_by, created_at
         FROM document_files WHERE account_id = ? AND id = ?`,
      )
      .get(context.accountId, fileId) as DocumentFileRow | undefined;
    if (!row) throw new Error('DOCUMENT_FILE_NOT_FOUND');
    return documentFile(row);
  }

  listDocumentFiles(context: AccountContext, orderId: string): DocumentFileRecord[] {
    this.assertMember(context);
    const rows = this.db
      .prepare(
        `SELECT id, account_id, order_id, template_id, format, relative_path, filename,
          mime_type, byte_size, checksum, created_by, created_at
         FROM document_files WHERE account_id = ? AND order_id = ? ORDER BY created_at DESC, id DESC`,
      )
      .all(context.accountId, orderId) as DocumentFileRow[];
    return rows.map(documentFile);
  }

  private normalizeColumns(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > MAX_VIEW_COLUMNS)
      throw new Error('SAVED_VIEW_COLUMNS_INVALID');
    const columns = value.map((column) => {
      if (typeof column !== 'string' || column.length < 1 || column.length > 80)
        throw new Error('SAVED_VIEW_COLUMNS_INVALID');
      return column;
    });
    if (new Set(columns).size !== columns.length) throw new Error('SAVED_VIEW_COLUMNS_INVALID');
    return columns;
  }

  private savedView(row: SavedViewRow): SavedView {
    const query = normalizeOrderQuery(
      parseStoredJson<unknown>(row.query_json, 'SAVED_VIEW_DATA_INVALID'),
      'SAVED_VIEW_DATA_INVALID',
    );
    const columns = normalizeIdList(
      parseStoredJson<unknown>(row.columns_json, 'SAVED_VIEW_DATA_INVALID'),
      'SAVED_VIEW_DATA_INVALID',
    );
    const sort = row.sort_json
      ? (normalizeOrderQuery(
          { sort: parseStoredJson<unknown>(row.sort_json, 'SAVED_VIEW_DATA_INVALID') },
          'SAVED_VIEW_DATA_INVALID',
        ).sort ?? null)
      : null;
    return {
      id: row.id,
      accountId: row.account_id,
      userId: row.user_id,
      name: row.name,
      query,
      sort,
      columns,
      pageSize: row.page_size,
      visibility: row.visibility,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private savedViewRow(context: AccountContext, viewId: string, ownerOnly = false): SavedViewRow {
    const actorId = context.actorId;
    const row = this.db
      .prepare(
        `SELECT id, account_id, user_id, name, query_json, sort_json, columns_json, page_size, visibility, version, created_at, updated_at FROM saved_views WHERE account_id = ? AND id = ?${ownerOnly ? ' AND user_id = ?' : ''}`,
      )
      .get(...(ownerOnly ? [context.accountId, viewId, actorId] : [context.accountId, viewId])) as
      SavedViewRow | undefined;
    if (!row) throw new Error('SAVED_VIEW_NOT_FOUND');
    if (!ownerOnly && row.visibility !== 'shared' && row.user_id !== actorId)
      throw new Error('SAVED_VIEW_NOT_FOUND');
    return row;
  }

  createSavedView(
    context: AccountContext,
    input: {
      name: string;
      query?: OrderQueryInput;
      sort?: OrderSort | null;
      columns?: readonly string[];
      pageSize?: number;
      visibility?: SavedViewVisibility;
    },
  ): SavedView {
    const actorId = this.requireMutationActor(context);
    const name = input.name.trim();
    if (!name || name.length > 120) throw new Error('SAVED_VIEW_NAME_INVALID');
    const query = normalizeOrderQuery(input.query ?? {}, 'SAVED_VIEW_QUERY_INVALID');
    const sort =
      input.sort === undefined || input.sort === null
        ? (query.sort ?? null)
        : (normalizeOrderQuery({ sort: input.sort }, 'SAVED_VIEW_SORT_INVALID').sort ?? null);
    const columns = this.normalizeColumns(input.columns);
    const pageSize = input.pageSize ?? 50;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new Error('SAVED_VIEW_PAGE_SIZE_INVALID');
    const visibility = input.visibility ?? 'private';
    if (visibility !== 'private' && visibility !== 'shared')
      throw new Error('SAVED_VIEW_VISIBILITY_INVALID');
    const existing = this.db
      .prepare('SELECT id FROM saved_views WHERE account_id = ? AND user_id = ? AND name = ?')
      .get(context.accountId, actorId, name);
    if (existing) throw new Error('SAVED_VIEW_NAME_EXISTS');
    const now = new Date().toISOString();
    const id = randomId();
    this.db
      .prepare(
        'INSERT INTO saved_views (id, account_id, user_id, name, query_json, sort_json, columns_json, page_size, visibility, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      )
      .run(
        id,
        context.accountId,
        actorId,
        name,
        serializeBoundedJson(query, MAX_SELECTION_JSON, 'SAVED_VIEW_QUERY_TOO_LARGE'),
        sort ? serializeBoundedJson(sort, 8 * 1024, 'SAVED_VIEW_SORT_TOO_LARGE') : null,
        serializeBoundedJson(columns, MAX_SELECTION_JSON, 'SAVED_VIEW_COLUMNS_TOO_LARGE'),
        pageSize,
        visibility,
        now,
        now,
      );
    this.audit(context, 'saved-view.created', 'saved_view', id, { visibility });
    return this.savedView(this.savedViewRow(context, id, true));
  }

  listSavedViews(context: AccountContext): SavedView[] {
    this.assertMember(context);
    const rows = this.db
      .prepare(
        "SELECT id, account_id, user_id, name, query_json, sort_json, columns_json, page_size, visibility, version, created_at, updated_at FROM saved_views WHERE account_id = ? AND (visibility = 'shared' OR user_id = ?) ORDER BY name COLLATE NOCASE, id",
      )
      .all(context.accountId, context.actorId) as SavedViewRow[];
    return rows.map((row) => this.savedView(row));
  }

  updateSavedView(
    context: AccountContext,
    viewId: string,
    input: {
      name?: string;
      query?: OrderQueryInput;
      sort?: OrderSort | null;
      columns?: readonly string[];
      pageSize?: number;
      visibility?: SavedViewVisibility;
      version?: number;
    },
  ): SavedView {
    const actorId = this.requireMutationActor(context);
    const current = this.savedViewRow(context, viewId, true);
    if (input.version !== undefined && input.version !== current.version)
      throw new Error('SAVED_VIEW_VERSION_CONFLICT');
    const name = input.name === undefined ? current.name : input.name.trim();
    if (!name || name.length > 120) throw new Error('SAVED_VIEW_NAME_INVALID');
    const query =
      input.query === undefined
        ? normalizeOrderQuery(
            parseStoredJson<unknown>(current.query_json, 'SAVED_VIEW_DATA_INVALID'),
            'SAVED_VIEW_DATA_INVALID',
          )
        : normalizeOrderQuery(input.query, 'SAVED_VIEW_QUERY_INVALID');
    const sort =
      input.sort === undefined
        ? current.sort_json
          ? (normalizeOrderQuery(
              { sort: parseStoredJson<unknown>(current.sort_json, 'SAVED_VIEW_DATA_INVALID') },
              'SAVED_VIEW_DATA_INVALID',
            ).sort ?? null)
          : null
        : input.sort === null
          ? null
          : (normalizeOrderQuery({ sort: input.sort }, 'SAVED_VIEW_SORT_INVALID').sort ?? null);
    const columns =
      input.columns === undefined
        ? this.normalizeColumns(
            parseStoredJson<unknown>(current.columns_json, 'SAVED_VIEW_DATA_INVALID'),
          )
        : this.normalizeColumns(input.columns);
    const pageSize = input.pageSize ?? current.page_size;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
      throw new Error('SAVED_VIEW_PAGE_SIZE_INVALID');
    const visibility = input.visibility ?? current.visibility;
    if (visibility !== 'private' && visibility !== 'shared')
      throw new Error('SAVED_VIEW_VISIBILITY_INVALID');
    const duplicate = this.db
      .prepare(
        'SELECT id FROM saved_views WHERE account_id = ? AND user_id = ? AND name = ? AND id <> ?',
      )
      .get(context.accountId, actorId, name, viewId);
    if (duplicate) throw new Error('SAVED_VIEW_NAME_EXISTS');
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE saved_views SET name = ?, query_json = ?, sort_json = ?, columns_json = ?, page_size = ?, visibility = ?, version = version + 1, updated_at = ? WHERE account_id = ? AND user_id = ? AND id = ? AND version = ?',
      )
      .run(
        name,
        serializeBoundedJson(query, MAX_SELECTION_JSON, 'SAVED_VIEW_QUERY_TOO_LARGE'),
        sort ? serializeBoundedJson(sort, 8 * 1024, 'SAVED_VIEW_SORT_TOO_LARGE') : null,
        serializeBoundedJson(columns, MAX_SELECTION_JSON, 'SAVED_VIEW_COLUMNS_TOO_LARGE'),
        pageSize,
        visibility,
        now,
        context.accountId,
        actorId,
        viewId,
        current.version,
      );
    if (result.changes !== 1) throw new Error('SAVED_VIEW_VERSION_CONFLICT');
    this.audit(context, 'saved-view.updated', 'saved_view', viewId, {
      version: current.version + 1,
    });
    return this.savedView(this.savedViewRow(context, viewId, true));
  }

  deleteSavedView(context: AccountContext, viewId: string): void {
    const actorId = this.requireMutationActor(context);
    const result = this.db
      .prepare('DELETE FROM saved_views WHERE account_id = ? AND user_id = ? AND id = ?')
      .run(context.accountId, actorId, viewId);
    if (result.changes !== 1) throw new Error('SAVED_VIEW_NOT_FOUND');
    this.audit(context, 'saved-view.deleted', 'saved_view', viewId, {});
  }

  private bulkJobRow(context: AccountContext, jobId: string): BulkJobRow {
    this.assertContext(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, selection_id, action, parameters_json, status, progress, total_count, succeeded_count, failed_count, cancelled_count, idempotency_key, created_by, cancel_requested, last_error, created_at, updated_at, completed_at FROM bulk_jobs WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, jobId) as BulkJobRow | undefined;
    if (!row) throw new Error('BULK_JOB_NOT_FOUND');
    return row;
  }

  private bulkJobSummary(row: BulkJobRow): BulkJobSummary {
    return {
      id: row.id,
      accountId: row.account_id,
      selectionId: row.selection_id,
      action: row.action,
      status: row.status,
      progress: row.progress,
      totalCount: row.total_count,
      succeededCount: row.succeeded_count,
      failedCount: row.failed_count,
      cancelledCount: row.cancelled_count,
      idempotencyKey: row.idempotency_key,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }

  private bulkItem(row: {
    job_id: string;
    order_id: string;
    status: BulkItemStatus;
    attempt_count: number;
    last_error: string | null;
    updated_at: string;
  }): BulkJobItem {
    return {
      jobId: row.job_id,
      orderId: row.order_id,
      status: row.status,
      attemptCount: row.attempt_count,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    };
  }

  private audit(
    context: AccountContext,
    action: string,
    targetType: string,
    targetId: string,
    summary: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_events (id, account_id, actor_id, action, target_type, target_id, summary_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomId(),
        context.accountId,
        context.actorId ?? null,
        action,
        targetType,
        targetId,
        serializeBoundedJson(summary, 8 * 1024, 'AUDIT_SUMMARY_TOO_LARGE'),
        context.correlationId,
        new Date().toISOString(),
      );
  }

  private refreshBulkJob(
    context: AccountContext,
    jobId: string,
    now = new Date().toISOString(),
  ): void {
    const counts = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded,
          COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled,
          COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END), 0) AS pending
         FROM bulk_job_items WHERE account_id = ? AND job_id = ?`,
      )
      .get(context.accountId, jobId) as {
      succeeded: number;
      failed: number;
      cancelled: number;
      pending: number;
    };
    const job = this.bulkJobRow(context, jobId);
    const succeededCount = Number(counts.succeeded);
    const failedCount = Number(counts.failed);
    const cancelledCount = Number(counts.cancelled);
    const pending = Number(counts.pending);
    const processed = succeededCount + failedCount + cancelledCount;
    let status = job.status;
    let completedAt = job.completed_at;
    if (job.cancel_requested === 1 && pending === 0) {
      status = 'cancelled';
      completedAt ??= now;
    } else if (pending === 0 && processed >= job.total_count) {
      status = failedCount > 0 ? 'partial' : 'succeeded';
      completedAt ??= now;
    } else if (job.status !== 'queued') {
      status = 'running';
      completedAt = null;
    }
    const progress =
      status === 'succeeded' || status === 'partial' || status === 'cancelled'
        ? 100
        : job.total_count === 0
          ? 0
          : Math.min(99, Math.floor((processed / job.total_count) * 100));
    this.db
      .prepare(
        'UPDATE bulk_jobs SET status = ?, progress = ?, succeeded_count = ?, failed_count = ?, cancelled_count = ?, completed_at = ?, updated_at = ? WHERE account_id = ? AND id = ?',
      )
      .run(
        status,
        progress,
        succeededCount,
        failedCount,
        cancelledCount,
        completedAt,
        now,
        context.accountId,
        jobId,
      );
  }

  previewBulk(
    context: AccountContext,
    input: { selectionId: string; action: BulkAction; parameters?: unknown },
  ): BulkPreview {
    this.assertMember(context);
    if (!isBulkAction(input.action)) throw new Error('BULK_ACTION_NOT_ALLOWED');
    const parameters = normalizeBulkParameters(input.action, input.parameters ?? {});
    void parameters;
    const row = this.selectionRow(context, input.selectionId);
    this.assertSelectionActive(row);
    const selection = this.selectionData(row);
    const currentCount = this.countSelection(context, selection);
    const where = this.compileSelectionWhere(context, selection);
    const facets = this.db
      .prepare(
        `SELECT DISTINCT o.currency AS currency, COALESCE(o.connection_id, 'manual') AS store FROM orders o WHERE ${where.sql} ORDER BY o.currency, store`,
      )
      .all(...where.params) as Array<{ currency: string; store: string }>;
    const warnings: string[] = [];
    if (selection.mode === 'query') warnings.push('SELECTION_WATERMARK_EXCLUDES_LATER_ARRIVALS');
    if (currentCount !== row.estimated_count) warnings.push('SELECTION_COUNT_CHANGED');
    if (input.action === 'resync') warnings.push('RESYNC_IS_READ_ONLY');
    return {
      selectionId: row.id,
      action: input.action,
      estimatedCount: row.estimated_count,
      currentCount,
      watermark: row.watermark,
      expiresAt: row.expires_at,
      currencies: [...new Set(facets.map((facet) => facet.currency))],
      stores: [...new Set(facets.map((facet) => facet.store))],
      warnings,
    };
  }

  createBulkJob(
    context: AccountContext,
    input: {
      selectionId: string;
      action: BulkAction;
      parameters?: unknown;
      idempotencyKey: string;
    },
  ): BulkJobSummary {
    const actorId = this.requireMutationActor(context);
    if (!isBulkAction(input.action)) throw new Error('BULK_ACTION_NOT_ALLOWED');
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 200
    )
      throw new Error('BULK_IDEMPOTENCY_KEY_INVALID');
    const parametersJson = serializeBoundedJson(
      normalizeBulkParameters(input.action, input.parameters ?? {}),
      MAX_BULK_PARAMETERS_JSON,
      'BULK_PARAMETERS_TOO_LARGE',
    );
    const existing = this.db
      .prepare(
        'SELECT id, account_id, selection_id, action, parameters_json, status, progress, total_count, succeeded_count, failed_count, cancelled_count, idempotency_key, created_by, cancel_requested, last_error, created_at, updated_at, completed_at FROM bulk_jobs WHERE account_id = ? AND action = ? AND idempotency_key = ?',
      )
      .get(context.accountId, input.action, input.idempotencyKey) as BulkJobRow | undefined;
    if (existing) {
      if (
        existing.selection_id !== input.selectionId ||
        existing.parameters_json !== parametersJson
      )
        throw new Error('BULK_IDEMPOTENCY_CONFLICT');
      return this.bulkJobSummary(existing);
    }
    const selectionRow = this.selectionRow(context, input.selectionId);
    this.assertSelectionActive(selectionRow);
    const selection = this.selectionData(selectionRow);
    const totalCount = this.countSelection(context, selection);
    const now = new Date().toISOString();
    const jobId = randomId();
    const status: BulkJobStatus = totalCount === 0 ? 'succeeded' : 'queued';
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT INTO bulk_jobs (id, account_id, selection_id, action, parameters_json, status, progress, total_count, idempotency_key, created_by, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          jobId,
          context.accountId,
          input.selectionId,
          input.action,
          parametersJson,
          status,
          totalCount === 0 ? 100 : 0,
          totalCount,
          input.idempotencyKey,
          actorId,
          now,
          now,
          totalCount === 0 ? now : null,
        );
      if (totalCount > 0) {
        this.db
          .prepare(
            `INSERT INTO jobs (id, account_id, type, idempotency_key, status, attempts, created_at, updated_at,
              payload_json, max_attempts, available_at)
             VALUES (?, ?, 'bulk.process', ?, 'queued', 0, ?, ?, ?, 5, ?)`,
          )
          .run(
            randomId(),
            context.accountId,
            `bulk:${jobId}`,
            now,
            now,
            JSON.stringify({ bulkJobId: jobId }),
            now,
          );
        this.audit(context, 'job.queued', 'job', jobId, { type: 'bulk.process' });
      }
      if (selection.mode === 'explicit') {
        const where = this.compileSelectionWhere(context, selection);
        const orders = this.db
          .prepare(`SELECT o.id FROM orders o WHERE ${where.sql} ORDER BY o.id`)
          .all(...where.params) as Array<{ id: string }>;
        const insertItem = this.db.prepare(
          "INSERT INTO bulk_job_items (account_id, job_id, order_id, status, updated_at) VALUES (?, ?, ?, 'queued', ?)",
        );
        for (const order of orders) insertItem.run(context.accountId, jobId, order.id, now);
      }
      this.audit(context, 'bulk-job.created', 'bulk_job', jobId, {
        action: input.action,
        selectionId: input.selectionId,
        totalCount,
      });
    })();
    return this.bulkJobSummary(this.bulkJobRow(context, jobId));
  }

  getBulkJob(context: AccountContext, jobId: string): BulkJobSummary {
    this.assertMember(context);
    return this.bulkJobSummary(this.bulkJobRow(context, jobId));
  }

  getBulkJobForWorker(context: AccountContext, jobId: string): BulkJobSummary {
    return this.bulkJobSummary(this.bulkJobRow(context, jobId));
  }

  listBulkJobs(
    context: AccountContext,
    input: { cursor?: string | null; limit?: number; status?: BulkJobStatus } = {},
  ): { items: readonly BulkJobSummary[]; nextCursor: string | null; hasMore: boolean } {
    this.assertMember(context);
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('BULK_JOB_LIMIT_INVALID');
    const clauses = ['account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.status !== undefined) {
      if (
        !['queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled'].includes(input.status)
      )
        throw new Error('BULK_JOB_STATUS_INVALID');
      clauses.push('status = ?');
      params.push(input.status);
    }
    if (input.cursor) {
      const cursor = decodedCursor(input.cursor);
      clauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      params.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT id, account_id, selection_id, action, parameters_json, status, progress, total_count, succeeded_count, failed_count, cancelled_count, idempotency_key, created_by, cancel_requested, last_error, created_at, updated_at, completed_at FROM bulk_jobs WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as BulkJobRow[];
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.map((row) => this.bulkJobSummary(row)),
      hasMore,
      nextCursor:
        hasMore && last ? encodedCursor({ sortValue: last.updated_at, id: last.id }) : null,
    };
  }

  claimNextBulkItem(context: AccountContext, jobId: string): BulkJobItem | null {
    this.assertContext(context);
    const now = new Date().toISOString();
    const result = this.db.transaction(() => {
      let job = this.bulkJobRow(context, jobId);
      if (
        ['succeeded', 'failed', 'partial', 'cancelled'].includes(job.status) ||
        job.cancel_requested === 1
      )
        return null;
      type BulkItemRow = {
        job_id: string;
        order_id: string;
        status: BulkItemStatus;
        attempt_count: number;
        last_error: string | null;
        updated_at: string;
      };
      let candidate = this.db
        .prepare(
          "SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND status = 'queued' ORDER BY order_id LIMIT 1",
        )
        .get(context.accountId, jobId) as BulkItemRow | undefined;
      if (!candidate) {
        const selectionRow = this.selectionRow(context, job.selection_id);
        const selection = this.selectionData(selectionRow);
        if (selection.mode === 'query') {
          const where = this.compileSelectionWhere(context, selection);
          const dynamicCandidate = this.db
            .prepare(
              `SELECT o.id AS order_id FROM orders o WHERE ${where.sql} AND NOT EXISTS (SELECT 1 FROM bulk_job_items item WHERE item.account_id = ? AND item.job_id = ? AND item.order_id = o.id) ORDER BY o.id LIMIT 1`,
            )
            .get(...where.params, context.accountId, jobId) as
            | {
                order_id: string;
              }
            | undefined;
          if (dynamicCandidate) {
            this.db
              .prepare(
                "INSERT OR IGNORE INTO bulk_job_items (account_id, job_id, order_id, status, updated_at) VALUES (?, ?, ?, 'queued', ?)",
              )
              .run(context.accountId, jobId, dynamicCandidate.order_id, now);
            candidate = this.db
              .prepare(
                "SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND order_id = ? AND status = 'queued'",
              )
              .get(context.accountId, jobId, dynamicCandidate.order_id) as BulkItemRow | undefined;
          }
        }
      }
      if (!candidate) {
        this.refreshBulkJob(context, jobId, now);
        job = this.bulkJobRow(context, jobId);
        if (!['succeeded', 'partial', 'cancelled'].includes(job.status)) {
          this.db
            .prepare(
              "UPDATE bulk_jobs SET status = 'failed', last_error = ?, progress = 100, completed_at = ?, updated_at = ? WHERE account_id = ? AND id = ?",
            )
            .run('BULK_SELECTION_RESOLUTION_INCOMPLETE', now, now, context.accountId, jobId);
        }
        return null;
      }
      const updated = this.db
        .prepare(
          "UPDATE bulk_job_items SET status = 'running', attempt_count = attempt_count + 1, updated_at = ? WHERE account_id = ? AND job_id = ? AND order_id = ? AND status = 'queued'",
        )
        .run(now, context.accountId, jobId, candidate.order_id);
      if (updated.changes !== 1) return null;
      this.db
        .prepare(
          "UPDATE bulk_jobs SET status = 'running', completed_at = NULL, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'queued'",
        )
        .run(now, context.accountId, jobId);
      const claimed = this.db
        .prepare(
          'SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND order_id = ?',
        )
        .get(context.accountId, jobId, candidate.order_id) as {
        job_id: string;
        order_id: string;
        status: BulkItemStatus;
        attempt_count: number;
        last_error: string | null;
        updated_at: string;
      };
      return this.bulkItem(claimed);
    })();
    return result;
  }

  completeBulkItem(
    context: AccountContext,
    jobId: string,
    orderId: string,
    input: { success: boolean; error?: string },
  ): BulkJobItem {
    this.assertContext(context);
    if (typeof input.success !== 'boolean') throw new Error('BULK_ITEM_RESULT_INVALID');
    if (
      input.error !== undefined &&
      (typeof input.error !== 'string' || input.error.length > 1_000)
    )
      throw new Error('BULK_ITEM_ERROR_INVALID');
    const now = new Date().toISOString();
    return this.db.transaction(() => {
      const item = this.db
        .prepare(
          'SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND order_id = ?',
        )
        .get(context.accountId, jobId, orderId) as
        | {
            job_id: string;
            order_id: string;
            status: BulkItemStatus;
            attempt_count: number;
            last_error: string | null;
            updated_at: string;
          }
        | undefined;
      if (!item) throw new Error('BULK_ITEM_NOT_FOUND');
      const nextStatus: BulkItemStatus = input.success ? 'succeeded' : 'failed';
      if (item.status !== 'running') {
        if (item.status === nextStatus) return this.bulkItem(item);
        throw new Error('BULK_ITEM_STATE_INVALID');
      }
      this.db
        .prepare(
          "UPDATE bulk_job_items SET status = ?, last_error = ?, updated_at = ? WHERE account_id = ? AND job_id = ? AND order_id = ? AND status = 'running'",
        )
        .run(
          nextStatus,
          input.success ? null : (input.error?.slice(0, 500) ?? 'BULK_ITEM_FAILED'),
          now,
          context.accountId,
          jobId,
          orderId,
        );
      this.refreshBulkJob(context, jobId, now);
      const updated = this.db
        .prepare(
          'SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND order_id = ?',
        )
        .get(context.accountId, jobId, orderId) as {
        job_id: string;
        order_id: string;
        status: BulkItemStatus;
        attempt_count: number;
        last_error: string | null;
        updated_at: string;
      };
      return this.bulkItem(updated);
    })();
  }

  applyBulkItem(context: AccountContext, jobId: string, orderId: string): void {
    this.assertContext(context);
    const job = this.bulkJobRow(context, jobId);
    const item = this.db
      .prepare(
        'SELECT status FROM bulk_job_items WHERE account_id = ? AND job_id = ? AND order_id = ?',
      )
      .get(context.accountId, jobId, orderId) as { status: BulkItemStatus } | undefined;
    if (!item) throw new Error('BULK_ITEM_NOT_FOUND');
    if (item.status === 'succeeded') return;
    if (item.status !== 'running') throw new Error('BULK_ITEM_STATE_INVALID');
    const parameters = parseStoredJson<Record<string, unknown>>(
      job.parameters_json,
      'BULK_PARAMETERS_INVALID',
    );
    const order = this.db
      .prepare(
        'SELECT id, origin, connection_id, local_status, assignee_id, tags_json, export_state, stale_export_at FROM orders WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, orderId) as
      | {
          id: string;
          origin: 'woo' | 'manual';
          connection_id: string | null;
          local_status: string;
          assignee_id: string | null;
          tags_json: string;
          export_state: string;
          stale_export_at: string | null;
        }
      | undefined;
    if (!order) throw new Error('ORDER_NOT_FOUND');
    const now = new Date().toISOString();
    let changed = false;
    switch (job.action) {
      case 'update-local-status': {
        const status = bulkParameterValue(parameters, 'status');
        if (order.local_status !== status) {
          this.db
            .prepare(
              `UPDATE orders SET local_status = ?, stale_export_at = CASE WHEN export_state = 'exported' THEN COALESCE(stale_export_at, ?) ELSE stale_export_at END,
                version = version + 1, updated_at = ? WHERE account_id = ? AND id = ?`,
            )
            .run(status, now, now, context.accountId, orderId);
          changed = true;
        }
        break;
      }
      case 'assign': {
        const assigneeId = bulkParameterValue(parameters, 'assigneeId');
        this.assertManualAssignee(context, assigneeId);
        if (order.assignee_id !== assigneeId) {
          this.db
            .prepare(
              `UPDATE orders SET assignee_id = ?, stale_export_at = CASE WHEN export_state = 'exported' THEN COALESCE(stale_export_at, ?) ELSE stale_export_at END,
                version = version + 1, updated_at = ? WHERE account_id = ? AND id = ?`,
            )
            .run(assigneeId, now, now, context.accountId, orderId);
          changed = true;
        }
        break;
      }
      case 'add-tag':
      case 'remove-tag': {
        const tag = bulkParameterValue(parameters, 'tag');
        const tags = parseStoredJson<unknown[]>(order.tags_json, 'ORDER_TAGS_INVALID').filter(
          (value): value is string => typeof value === 'string',
        );
        const next =
          job.action === 'add-tag'
            ? [...new Set([...tags, tag])]
            : tags.filter((value) => value !== tag);
        if (next.length > 50 || next.some((value) => value.length > 80))
          throw new Error('ORDER_TAGS_INVALID');
        if (JSON.stringify(next) !== JSON.stringify(tags)) {
          this.db
            .prepare(
              `UPDATE orders SET tags_json = ?, stale_export_at = CASE WHEN export_state = 'exported' THEN COALESCE(stale_export_at, ?) ELSE stale_export_at END,
                version = version + 1, updated_at = ? WHERE account_id = ? AND id = ?`,
            )
            .run(JSON.stringify(next), now, now, context.accountId, orderId);
          changed = true;
        }
        break;
      }
      case 'mark-export-ready':
        if (order.local_status !== 'ready-for-export') {
          this.db
            .prepare(
              `UPDATE orders SET local_status = 'ready-for-export', updated_at = ?, version = version + 1 WHERE account_id = ? AND id = ?`,
            )
            .run(now, context.accountId, orderId);
          changed = true;
        }
        break;
      case 'resync':
        if (order.origin === 'woo' && order.connection_id) {
          this.enqueueJob(context, {
            id: randomId(),
            type: 'sync.incremental',
            idempotencyKey: `bulk:${jobId}:${orderId}:resync`,
            payload: { connectionId: order.connection_id, orderId },
            maxAttempts: 5,
          });
        }
        break;
      case 'create-export':
        this.enqueueJob(context, {
          id: randomId(),
          type: 'export.generate',
          idempotencyKey: `bulk:${jobId}:${orderId}:export`,
          payload: { orderId, profileId: bulkParameterValue(parameters, 'profileId') },
          maxAttempts: 3,
        });
        break;
      case 'generate-invoice':
      case 'generate-thermal':
      case 'generate-label':
      case 'print-documents':
        this.enqueueJob(context, {
          id: randomId(),
          type: 'document.generate',
          idempotencyKey: `bulk:${jobId}:${orderId}:document`,
          payload: {
            orderId,
            templateId: bulkParameterValue(parameters, 'templateId'),
            action: job.action,
          },
          maxAttempts: 3,
        });
        break;
      default:
        throw new Error('BULK_ACTION_HANDLER_NOT_CONFIGURED');
    }
    this.audit(context, 'bulk-item.applied', 'bulk_job_item', `${jobId}:${orderId}`, {
      action: job.action,
      changed,
    });
  }

  retryBulkFailures(context: AccountContext, jobId: string): BulkJobSummary {
    this.requireMutationActor(context);
    const job = this.bulkJobRow(context, jobId);
    if (!['partial', 'failed'].includes(job.status)) throw new Error('BULK_RETRY_NOT_AVAILABLE');
    const now = new Date().toISOString();
    const result = this.db.transaction(() => {
      const retried = this.db
        .prepare(
          "UPDATE bulk_job_items SET status = 'queued', updated_at = ? WHERE account_id = ? AND job_id = ? AND status = 'failed'",
        )
        .run(now, context.accountId, jobId).changes;
      if (retried === 0) throw new Error('BULK_NO_FAILURES');
      this.db
        .prepare(
          "UPDATE bulk_jobs SET status = 'queued', cancel_requested = 0, last_error = NULL, completed_at = NULL, updated_at = ? WHERE account_id = ? AND id = ?",
        )
        .run(now, context.accountId, jobId);
      this.refreshBulkJob(context, jobId, now);
      return this.bulkJobSummary(this.bulkJobRow(context, jobId));
    })();
    this.audit(context, 'bulk-job.retried', 'bulk_job', jobId, { failedCount: job.failed_count });
    return result;
  }

  cancelBulkJob(context: AccountContext, jobId: string): BulkJobSummary {
    this.requireMutationActor(context);
    const job = this.bulkJobRow(context, jobId);
    if (!['queued', 'running'].includes(job.status)) return this.bulkJobSummary(job);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE bulk_job_items SET status = 'cancelled', updated_at = ? WHERE account_id = ? AND job_id = ? AND status = 'queued'",
        )
        .run(now, context.accountId, jobId);
      this.db
        .prepare(
          'UPDATE bulk_jobs SET cancel_requested = 1, updated_at = ? WHERE account_id = ? AND id = ?',
        )
        .run(now, context.accountId, jobId);
      this.refreshBulkJob(context, jobId, now);
    })();
    this.audit(context, 'bulk-job.cancelled', 'bulk_job', jobId, {});
    return this.bulkJobSummary(this.bulkJobRow(context, jobId));
  }

  cancelBulkJobForWorker(context: AccountContext, jobId: string): BulkJobSummary {
    this.assertContext(context);
    const job = this.bulkJobRow(context, jobId);
    if (!['queued', 'running'].includes(job.status)) return this.bulkJobSummary(job);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE bulk_job_items SET status = 'cancelled', updated_at = ? WHERE account_id = ? AND job_id = ? AND status = 'queued'",
        )
        .run(now, context.accountId, jobId);
      this.db
        .prepare(
          'UPDATE bulk_jobs SET cancel_requested = 1, updated_at = ? WHERE account_id = ? AND id = ?',
        )
        .run(now, context.accountId, jobId);
      this.refreshBulkJob(context, jobId, now);
    })();
    this.audit(context, 'bulk-job.cancelled-by-worker', 'bulk_job', jobId, {});
    return this.bulkJobSummary(this.bulkJobRow(context, jobId));
  }

  listBulkFailures(
    context: AccountContext,
    jobId: string,
    input: { cursor?: string | null; limit?: number } = {},
  ): { items: readonly BulkJobItem[]; nextCursor: string | null; hasMore: boolean } {
    this.assertMember(context);
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('BULK_FAILURE_LIMIT_INVALID');
    this.bulkJobRow(context, jobId);
    const cursor = input.cursor ? readSelectionCursor(input.cursor) : null;
    const params: (string | number)[] = [context.accountId, jobId];
    const clauses = ['account_id = ?', 'job_id = ?', "status = 'failed'"];
    if (cursor) {
      clauses.push('order_id > ?');
      params.push(cursor);
    }
    const rows = this.db
      .prepare(
        `SELECT job_id, order_id, status, attempt_count, last_error, updated_at FROM bulk_job_items WHERE ${clauses.join(' AND ')} ORDER BY order_id LIMIT ?`,
      )
      .all(...params, limit + 1) as Array<{
      job_id: string;
      order_id: string;
      status: BulkItemStatus;
      attempt_count: number;
      last_error: string | null;
      updated_at: string;
    }>;
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit).map((row) => this.bulkItem(row));
    return {
      items: visible,
      hasMore,
      nextCursor: hasMore && visible.length > 0 ? selectionCursor(visible.at(-1)!.orderId) : null,
    };
  }

  queryOrders(context: AccountContext, input: OrderQueryInput = {}): OrderQueryResult {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('ORDER_LIMIT_INVALID');
    const sort = input.sort ?? { field: 'remoteCreatedAt' as const, direction: 'desc' as const };
    const sortColumns = {
      remoteCreatedAt: 'o.remote_modified_at',
      updatedAt: 'o.updated_at',
      orderNumber: 'o.order_number',
      grandTotalMinor: 'o.grand_total_minor',
      id: 'o.id',
    } as const;
    const sortColumn = sortColumns[sort.field];
    if (!sortColumn || !['asc', 'desc'].includes(sort.direction))
      throw new Error('ORDER_SORT_NOT_ALLOWED');
    const clauses = ['o.account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.search !== undefined) {
      if (typeof input.search !== 'string' || input.search.length > 200)
        throw new Error('ORDER_SEARCH_INVALID');
      clauses.push(
        `(o.order_number LIKE ? OR o.external_order_id LIKE ? OR o.remote_status LIKE ? OR o.local_status LIKE ? OR o.currency LIKE ? OR o.normalized_json LIKE ?)`,
      );
      const search = `%${input.search}%`;
      params.push(search, search, search, search, search, search);
    }
    if (input.filter) {
      const compiled = compileFilter(input.filter);
      clauses.push(compiled.sql);
      params.push(...compiled.params);
    }
    if (input.cursor) {
      const cursor = decodedCursor(input.cursor);
      const comparison = sort.direction === 'desc' ? '<' : '>';
      clauses.push(
        `(COALESCE(${sortColumn}, '') ${comparison} ? OR (COALESCE(${sortColumn}, '') = ? AND o.id ${comparison} ?))`,
      );
      params.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT o.id, o.order_number, o.external_order_id, o.origin, o.connection_id, o.remote_status, o.local_status, o.export_state, o.stale_export_at, o.currency, o.grand_total_minor, o.remote_modified_at, o.updated_at, o.normalized_json, o.assignee_id, o.tags_json, o.notes_json, o.version, COALESCE(${sortColumn}, '') AS sort_value FROM orders o WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(${sortColumn}, '') ${sort.direction}, o.id ${sort.direction} LIMIT ?`,
      )
      .all(...params, limit + 1) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const items = visible.map((row) => {
      let normalized: Record<string, unknown> = {};
      if (typeof row.normalized_json === 'string') {
        try {
          normalized = JSON.parse(row.normalized_json) as Record<string, unknown>;
        } catch {
          normalized = {};
        }
      }
      let tags: unknown[] = [];
      if (typeof row.tags_json === 'string') {
        try {
          const parsed = JSON.parse(row.tags_json) as unknown;
          if (Array.isArray(parsed)) tags = parsed;
        } catch {
          tags = [];
        }
      }
      return {
        ...normalized,
        id: row.id,
        orderNumber: row.order_number,
        externalOrderId: row.external_order_id,
        origin: row.origin,
        connectionId: row.connection_id,
        remoteStatus: row.remote_status,
        localStatus: row.local_status,
        exportState:
          row.stale_export_at && row.export_state === 'exported'
            ? 'changed-after-export'
            : row.export_state,
        currency: row.currency,
        grandTotalMinor: row.grand_total_minor,
        remoteCreatedAt: row.remote_modified_at,
        updatedAt: row.updated_at,
        assigneeId: row.assignee_id,
        tags,
        version: row.version,
      };
    });
    const last = visible.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodedCursor({ sortValue: String(last.sort_value ?? ''), id: String(last.id) })
          : null,
    };
  }

  getOrder(context: AccountContext, orderId: string): Record<string, unknown> | null {
    if (!orderId || orderId.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT o.id, o.order_number, o.external_order_id, o.origin, o.connection_id,
          o.remote_status, o.local_status, o.export_state, o.currency, o.grand_total_minor,
          o.remote_modified_at, o.remote_deleted_at, o.stale_export_at, o.updated_at,
          o.assignee_id, o.tags_json, o.notes_json, o.version, o.normalized_json
         FROM orders o WHERE o.account_id = ? AND o.id = ?`,
      )
      .get(context.accountId, orderId) as Record<string, unknown> | undefined;
    if (!row) return null;

    let normalized: Record<string, unknown> = {};
    if (typeof row.normalized_json === 'string') {
      try {
        normalized = JSON.parse(row.normalized_json) as Record<string, unknown>;
      } catch {
        normalized = {};
      }
    }
    const refunds = this.db
      .prepare(
        `SELECT external_refund_id AS externalRefundId, amount_minor AS amountMinor,
          reason, source_json AS sourceJson, created_at AS createdAt
         FROM order_refunds WHERE account_id = ? AND order_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(context.accountId, orderId) as Array<Record<string, unknown>>;
    let tags: unknown[] = [];
    let notes: unknown[] = [];
    try {
      const parsedTags = JSON.parse(String(row.tags_json ?? '[]')) as unknown;
      if (Array.isArray(parsedTags)) tags = parsedTags;
      const parsedNotes = JSON.parse(String(row.notes_json ?? '[]')) as unknown;
      if (Array.isArray(parsedNotes)) notes = parsedNotes;
    } catch {
      tags = [];
      notes = [];
    }

    return {
      ...normalized,
      id: row.id,
      orderNumber: row.order_number,
      externalOrderId: row.external_order_id,
      origin: row.origin,
      connectionId: row.connection_id,
      remoteStatus: row.remote_status,
      localStatus: row.local_status,
      exportState:
        row.stale_export_at && row.export_state === 'exported'
          ? 'changed-after-export'
          : row.export_state,
      currency: row.currency,
      grandTotalMinor: row.grand_total_minor,
      remoteCreatedAt: row.remote_modified_at,
      remoteDeletedAt: row.remote_deleted_at,
      staleExportAt: row.stale_export_at,
      updatedAt: row.updated_at,
      assigneeId: row.assignee_id,
      tags,
      notesHistory: notes,
      version: row.version,
      refunds: refunds.length > 0 ? refunds : normalized.refunds,
    };
  }

  private applyMigrations(): void {
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (row) => row.version,
      ),
    );
    this.db.transaction(() => {
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
      }
    })();
  }

  complete(context: AccountContext, id: string): void {
    this.assertContext(context);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        "UPDATE jobs SET status = 'succeeded', progress = 100, lease_until = NULL, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running' AND cancel_requested = 0",
      )
      .run(now, context.accountId, id);
    if (result.changes === 1) {
      this.audit(context, 'job.succeeded', 'job', id, {});
      return;
    }
    const row = this.db
      .prepare('SELECT status, cancel_requested FROM jobs WHERE account_id = ? AND id = ?')
      .get(context.accountId, id) as
      { status: DurableJob['status']; cancel_requested: number } | undefined;
    if (!row) throw new Error('JOB_NOT_FOUND');
    if (row.status === 'running' && row.cancel_requested === 1) {
      this.cancelRunningJob(context, id);
      throw new Error('JOB_CANCELLED');
    }
    if (row.status === 'succeeded') return;
    throw new Error('JOB_STATE_INVALID');
  }

  enqueueJob(
    context: AccountContext,
    input: {
      id: string;
      type: string;
      idempotencyKey: string;
      payload: unknown;
      maxAttempts?: number;
    },
  ): DurableJob {
    this.assertContext(context);
    if (
      typeof input.id !== 'string' ||
      input.id.length < 1 ||
      input.id.length > MAX_JOB_ID_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(input.id)
    )
      throw new Error('JOB_ID_INVALID');
    if (!isDurableJobType(input.type)) throw new Error('JOB_TYPE_NOT_ALLOWED');
    if (
      typeof input.idempotencyKey !== 'string' ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > MAX_JOB_IDEMPOTENCY_LENGTH ||
      /[\u0000-\u001f\u007f]/u.test(input.idempotencyKey)
    )
      throw new Error('JOB_IDEMPOTENCY_KEY_INVALID');
    const maxAttempts = input.maxAttempts ?? 3;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_JOB_ATTEMPTS)
      throw new Error('JOB_MAX_ATTEMPTS_INVALID');
    const payloadJson = serializeJobPayload(input.payload);
    if (!this.db.prepare('SELECT id FROM accounts WHERE id = ?').get(context.accountId))
      throw new Error('JOB_ACCOUNT_NOT_FOUND');
    const now = new Date().toISOString();
    const row = this.db.transaction(() => {
      const existing = this.db
        .prepare(
          'SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress, payload_json, cancel_requested, lease_until, last_error, created_at, updated_at FROM jobs WHERE account_id = ? AND type = ? AND idempotency_key = ?',
        )
        .get(context.accountId, input.type, input.idempotencyKey) as JobRow | undefined;
      if (existing) {
        if (existing.payload_json !== payloadJson) throw new Error('JOB_IDEMPOTENCY_CONFLICT');
        return existing;
      }
      this.db
        .prepare(
          `INSERT INTO jobs (id, account_id, type, idempotency_key, status, attempts, created_at, updated_at, payload_json, max_attempts, available_at)
          VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.id,
          context.accountId,
          input.type,
          input.idempotencyKey,
          now,
          now,
          payloadJson,
          maxAttempts,
          now,
        );
      this.audit(context, 'job.queued', 'job', input.id, { type: input.type });
      return this.db
        .prepare(
          'SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress, payload_json, cancel_requested, lease_until, last_error, created_at, updated_at FROM jobs WHERE account_id = ? AND id = ?',
        )
        .get(context.accountId, input.id) as JobRow;
    })();
    return jobFromRow(row);
  }

  claimNext(context: AccountContext, leaseSeconds = 60): DurableJob | null {
    this.assertContext(context);
    return this.claimNextForAccount(context.accountId, leaseSeconds, context.correlationId);
  }

  recoverExpiredJobs(context: AccountContext): number {
    this.assertContext(context);
    return this.recoverExpiredJobsForAccount(context.accountId, context.correlationId);
  }

  updateJobProgress(context: AccountContext, id: string, progress: number): void {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new Error('JOB_PROGRESS_INVALID');
    }
    const result = this.db
      .prepare(
        `UPDATE jobs SET progress = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running'`,
      )
      .run(progress, new Date().toISOString(), context.accountId, id);
    if (result.changes !== 1) throw new Error('JOB_NOT_RUNNING');
  }

  updateProgress(context: AccountContext, id: string, progress: number): void {
    this.updateJobProgress(context, id, progress);
  }

  claimNextAny(input: { leaseSeconds: number; correlationId: string }): DurableJob | null {
    if (
      !Number.isInteger(input.leaseSeconds) ||
      input.leaseSeconds < 0 ||
      input.leaseSeconds > 3600 ||
      !input.correlationId
    )
      throw new Error('JOB_LEASE_INVALID');
    const candidate = this.db
      .prepare(
        `SELECT account_id FROM jobs WHERE status = 'queued' AND available_at <= ? AND cancel_requested = 0 ORDER BY created_at ASC, id ASC LIMIT 1`,
      )
      .get(new Date().toISOString()) as { account_id: string } | undefined;
    if (!candidate) return null;
    return this.claimNextForAccount(candidate.account_id, input.leaseSeconds, input.correlationId);
  }

  recoverExpiredJobsAny(correlationId: string): number {
    if (!correlationId) throw new Error('ACCOUNT_CONTEXT_INVALID');
    const accounts = this.db
      .prepare(
        "SELECT DISTINCT account_id FROM jobs WHERE status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?",
      )
      .all(new Date().toISOString()) as Array<{ account_id: string }>;
    return accounts.reduce(
      (count, account) =>
        count + this.recoverExpiredJobsForAccount(account.account_id, correlationId),
      0,
    );
  }

  private claimNextForAccount(
    accountId: string,
    leaseSeconds: number,
    correlationId: string,
  ): DurableJob | null {
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 0 || leaseSeconds > 3600)
      throw new Error('JOB_LEASE_INVALID');
    const now = new Date();
    const nowIso = now.toISOString();
    const id = this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `SELECT id FROM jobs WHERE account_id = ? AND status = 'queued' AND available_at <= ? AND cancel_requested = 0 ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get(accountId, nowIso) as { id: string } | undefined;
      if (!candidate) return null;
      const result = this.db
        .prepare(
          `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'queued'`,
        )
        .run(
          new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
          nowIso,
          accountId,
          candidate.id,
        );
      return result.changes === 1 ? candidate.id : null;
    })();
    if (!id) return null;
    const row = this.db
      .prepare(
        'SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress, payload_json, cancel_requested, lease_until, last_error, created_at, updated_at FROM jobs WHERE account_id = ? AND id = ?',
      )
      .get(accountId, id) as JobRow;
    void correlationId;
    return jobFromRow(row);
  }

  private recoverExpiredJobsForAccount(accountId: string, correlationId: string): number {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        "SELECT id, cancel_requested FROM jobs WHERE account_id = ? AND status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?",
      )
      .all(accountId, now) as Array<{ id: string; cancel_requested: number }>;
    if (rows.length === 0) return 0;
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = CASE WHEN cancel_requested = 1 THEN 'failed' ELSE 'queued' END,
          lease_until = NULL, available_at = ?, last_error = CASE WHEN cancel_requested = 1 THEN 'JOB_CANCELLED' ELSE last_error END,
          updated_at = ? WHERE account_id = ? AND status = 'running' AND lease_until IS NOT NULL AND lease_until <= ?`,
      )
      .run(now, now, accountId, now);
    for (const row of rows) {
      this.audit(
        { accountId, correlationId },
        row.cancel_requested === 1 ? 'job.cancelled-after-lease' : 'job.lease-recovered',
        'job',
        row.id,
        {},
      );
    }
    return result.changes;
  }

  getWorkerJob(context: AccountContext, id: string): DurableJob {
    this.assertContext(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress, payload_json, cancel_requested, lease_until, last_error, created_at, updated_at FROM jobs WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, id) as JobRow | undefined;
    if (!row) throw new Error('JOB_NOT_FOUND');
    return jobFromRow(row);
  }

  isCancellationRequested(context: AccountContext, id: string): boolean {
    this.assertContext(context);
    const row = this.db
      .prepare('SELECT cancel_requested FROM jobs WHERE account_id = ? AND id = ?')
      .get(context.accountId, id) as { cancel_requested: number } | undefined;
    if (!row) throw new Error('JOB_NOT_FOUND');
    return row.cancel_requested === 1;
  }

  heartbeatJob(context: AccountContext, id: string, leaseSeconds: number): void {
    this.assertContext(context);
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600)
      throw new Error('JOB_LEASE_INVALID');
    const now = new Date();
    const result = this.db
      .prepare(
        "UPDATE jobs SET lease_until = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running' AND lease_until > ?",
      )
      .run(
        new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        now.toISOString(),
        context.accountId,
        id,
        now.toISOString(),
      );
    if (result.changes !== 1) throw new Error('JOB_LEASE_LOST');
  }

  upsertCatalogPage(
    context: AccountContext,
    input: {
      connectionId: string;
      cursor: string;
      items: readonly CatalogItem[];
      pages: number;
    },
  ): { insertedOrUpdated: number } {
    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO catalog_items (id, account_id, connection_id, kind, external_id, parent_external_id, name, sku, source_json, source_hash, remote_modified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, connection_id, kind, external_id) DO UPDATE SET parent_external_id = excluded.parent_external_id, name = excluded.name, sku = excluded.sku, source_json = excluded.source_json, source_hash = excluded.source_hash, remote_modified_at = excluded.remote_modified_at, remote_deleted_at = NULL, updated_at = excluded.updated_at`,
    );
    const run = this.db.transaction(() => {
      let count = 0;
      for (const item of input.items) {
        if (item.sourceJson.length > 256 * 1024) throw new Error('CATALOG_SOURCE_TOO_LARGE');
        statement.run(
          `${context.accountId}:${input.connectionId}:${item.identity}`,
          context.accountId,
          input.connectionId,
          item.kind,
          item.externalId,
          item.parentExternalId,
          item.name,
          item.sku,
          item.sourceJson,
          requireHash(item.sourceJson),
          null,
          now,
          now,
        );
        count += 1;
      }
      this.db
        .prepare(
          `UPDATE connections SET catalog_cursor = ?, catalog_status = 'running', catalog_last_error = NULL, updated_at = ? WHERE id = ? AND account_id = ?`,
        )
        .run(input.cursor, now, input.connectionId, context.accountId);
      return count;
    })();
    return { insertedOrUpdated: run };
  }

  markCatalogDeleted(
    context: AccountContext,
    connectionId: string,
    identities: readonly string[],
  ): number {
    if (identities.length === 0) return 0;
    const now = new Date().toISOString();
    const placeholders = identities.map(() => '?').join(',');
    const result = this.db
      .prepare(
        `UPDATE catalog_items SET remote_deleted_at = ?, updated_at = ? WHERE account_id = ? AND connection_id = ? AND id IN (${placeholders}) AND remote_deleted_at IS NULL`,
      )
      .run(now, now, context.accountId, connectionId, ...identities);
    this.db
      .prepare(
        `UPDATE connections SET catalog_deleted_count = catalog_deleted_count + ?, updated_at = ? WHERE id = ? AND account_id = ?`,
      )
      .run(result.changes, now, connectionId, context.accountId);
    return result.changes;
  }

  completeCatalogSync(
    context: AccountContext,
    connectionId: string,
    success: boolean,
    errorCode?: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE connections SET catalog_status = ?, catalog_last_error = ?, catalog_last_success = CASE WHEN ? = 'succeeded' THEN ? ELSE catalog_last_success END, updated_at = ? WHERE id = ? AND account_id = ?`,
      )
      .run(
        success ? 'idle' : 'failed',
        errorCode ?? null,
        success ? 'succeeded' : 'failed',
        now,
        now,
        connectionId,
        context.accountId,
      );
  }

  private assertManualAssignee(context: AccountContext, assigneeId: string | null): void {
    if (
      assigneeId &&
      !this.db
        .prepare('SELECT 1 FROM account_memberships WHERE account_id = ? AND user_id = ?')
        .get(context.accountId, assigneeId)
    )
      throw new Error('MANUAL_ORDER_ASSIGNEE_INVALID');
  }

  createManualOrder(context: AccountContext, input: ManualOrderInput): Record<string, unknown> {
    const actorId = this.requireMutationActor(context);
    const normalized = normalizeManualOrder(input);
    this.assertManualAssignee(context, normalized.assigneeId);
    const now = new Date().toISOString();
    const id = randomId();
    const notes = normalized.notes
      ? [{ id: randomId(), text: normalized.notes, createdAt: now, createdBy: actorId }]
      : [];
    const payload = {
      ...normalized,
      origin: 'manual',
      syncPolicy: 'never',
      inventoryPolicy: 'ignore',
      createdAt: now,
      modifiedAt: now,
      notes: normalized.notes,
      noteHistory: notes,
    };
    const payloadJson = serializeBoundedJson(payload, 512 * 1024, 'MANUAL_ORDER_TOO_LARGE');
    const result = this.db.transaction(() => {
      const account = this.db
        .prepare('SELECT manual_order_sequence FROM accounts WHERE id = ?')
        .get(context.accountId) as { manual_order_sequence: number } | undefined;
      if (!account) throw new Error('ACCOUNT_NOT_FOUND');
      const sequence = account.manual_order_sequence + 1;
      this.db
        .prepare('UPDATE accounts SET manual_order_sequence = ?, updated_at = ? WHERE id = ?')
        .run(sequence, now, context.accountId);
      const orderNumber = `MAN-${String(sequence).padStart(6, '0')}`;
      this.db
        .prepare(
          `INSERT INTO orders (id, account_id, connection_id, origin, order_number, external_order_id, remote_status, local_status, export_state, currency, grand_total_minor, source_hash, remote_modified_at, remote_payload_json, normalized_json, stale_export_at, assignee_id, tags_json, notes_json, version, created_at, updated_at)
           VALUES (?, ?, NULL, 'manual', ?, NULL, NULL, ?, 'never-exported', ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, 1, ?, ?)`,
        )
        .run(
          id,
          context.accountId,
          orderNumber,
          normalized.localStatus,
          normalized.currency,
          normalized.amounts.grandTotalMinor,
          requireHash(payloadJson),
          payloadJson,
          normalized.assigneeId,
          JSON.stringify(normalized.tags),
          JSON.stringify(notes),
          now,
          now,
        );
      return { id, orderNumber };
    })();
    this.audit(context, 'manual-order.created', 'order', result.id, {
      orderNumber: result.orderNumber,
      lineCount: normalized.lines.length,
      currency: normalized.currency,
    });
    return this.getOrder(context, result.id) as Record<string, unknown>;
  }

  updateManualOrder(
    context: AccountContext,
    orderId: string,
    input: ManualOrderPatch,
  ): Record<string, unknown> {
    const actorId = this.requireMutationActor(context);
    if (!Number.isInteger(input.version) || input.version < 1)
      throw new Error('MANUAL_ORDER_VERSION_INVALID');
    const row = this.db
      .prepare(
        'SELECT origin, export_state, normalized_json, local_status, assignee_id, tags_json, notes_json, version FROM orders WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, orderId) as
      | {
          origin: string;
          export_state: string;
          normalized_json: string | null;
          local_status: string;
          assignee_id: string | null;
          tags_json: string;
          notes_json: string;
          version: number;
        }
      | undefined;
    if (!row || row.origin !== 'manual') throw new Error('MANUAL_ORDER_NOT_FOUND');
    if (row.version !== input.version) throw new Error('MANUAL_ORDER_VERSION_CONFLICT');
    const existing = row.normalized_json
      ? parseStoredJson<Record<string, unknown>>(row.normalized_json, 'MANUAL_ORDER_DATA_INVALID')
      : {};
    const current: ManualOrderInput = {
      currency: String(existing.currency ?? 'EGP'),
      customer: isRecord(existing.customer) ? existing.customer : {},
      billing: isRecord(existing.billing) ? existing.billing : {},
      shipping: isRecord(existing.shipping) ? existing.shipping : {},
      payment: isRecord(existing.payment) ? existing.payment : {},
      shippingMethod: isRecord(existing.shippingMethod) ? existing.shippingMethod : {},
      lines: Array.isArray(existing.lines)
        ? (existing.lines as unknown as ManualOrderLineInput[])
        : [],
      shippingCollectedMinor: String(
        isRecord(existing.amounts) ? (existing.amounts.shippingCollectedMinor ?? '0') : '0',
      ),
      taxMinor: String(isRecord(existing.amounts) ? (existing.amounts.taxMinor ?? '0') : '0'),
      discountMinor: String(
        isRecord(existing.amounts) ? (existing.amounts.discountMinor ?? '0') : '0',
      ),
      feesMinor: String(isRecord(existing.amounts) ? (existing.amounts.feesMinor ?? '0') : '0'),
      localStatus: row.local_status,
      tags: parseStoredJson<unknown[]>(row.tags_json, 'MANUAL_ORDER_DATA_INVALID') as string[],
      notes: typeof existing.notes === 'string' ? existing.notes : '',
      assigneeId: row.assignee_id,
    };
    const merged: ManualOrderInput = {
      ...current,
      ...input,
      lines: input.lines ?? current.lines,
    };
    const normalized = normalizeManualOrder(merged);
    this.assertManualAssignee(context, normalized.assigneeId);
    const now = new Date().toISOString();
    const noteHistory = parseStoredJson<unknown[]>(row.notes_json, 'MANUAL_ORDER_DATA_INVALID');
    if (input.notes !== undefined && input.notes.trim()) {
      noteHistory.push({
        id: randomId(),
        text: input.notes.trim(),
        createdAt: now,
        createdBy: actorId,
      });
    }
    const payload = {
      ...normalized,
      origin: 'manual',
      syncPolicy: 'never',
      inventoryPolicy: 'ignore',
      createdAt: existing.createdAt ?? now,
      modifiedAt: now,
      noteHistory,
    };
    const payloadJson = serializeBoundedJson(payload, 512 * 1024, 'MANUAL_ORDER_TOO_LARGE');
    const hasDocuments = Array.isArray(existing.documents) && existing.documents.length > 0;
    const isStale = row.export_state !== 'never-exported' || hasDocuments;
    const updated = this.db
      .prepare(
        `UPDATE orders SET local_status = ?, currency = ?, grand_total_minor = ?, assignee_id = ?, tags_json = ?, notes_json = ?, normalized_json = ?, source_hash = ?, stale_export_at = CASE WHEN ? = 1 THEN COALESCE(stale_export_at, ?) ELSE stale_export_at END, version = version + 1, updated_at = ? WHERE account_id = ? AND id = ? AND origin = 'manual' AND version = ?`,
      )
      .run(
        normalized.localStatus,
        normalized.currency,
        normalized.amounts.grandTotalMinor,
        normalized.assigneeId,
        JSON.stringify(normalized.tags),
        JSON.stringify(noteHistory),
        payloadJson,
        requireHash(payloadJson),
        isStale ? 1 : 0,
        now,
        now,
        context.accountId,
        orderId,
        input.version,
      );
    if (updated.changes !== 1) throw new Error('MANUAL_ORDER_VERSION_CONFLICT');
    this.audit(context, 'manual-order.updated', 'order', orderId, {
      version: input.version + 1,
      stale: isStale,
      lineCount: normalized.lines.length,
    });
    return this.getOrder(context, orderId) as Record<string, unknown>;
  }

  upsertRemoteOrder(
    context: AccountContext,
    connectionId: string,
    input: NormalizedOrderInput,
  ): string {
    const now = new Date().toISOString();
    const id = `${context.accountId}:${connectionId}:order:${input.externalOrderId}`;
    const existing = this.db
      .prepare(
        'SELECT source_hash, export_state FROM orders WHERE account_id = ? AND connection_id = ? AND external_order_id = ?',
      )
      .get(context.accountId, connectionId, input.externalOrderId) as
      { source_hash: string | null; export_state: string } | undefined;
    const stale = Boolean(
      existing?.source_hash &&
      existing.source_hash !== input.sourceHash &&
      existing.export_state !== 'never-exported',
    );
    this.db
      .prepare(
        `INSERT INTO orders (id, account_id, connection_id, origin, order_number, external_order_id, remote_status, currency, grand_total_minor, source_hash, remote_modified_at, remote_payload_json, normalized_json, stale_export_at, created_at, updated_at)
         VALUES (?, ?, ?, 'woo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, connection_id, external_order_id) DO UPDATE SET order_number = excluded.order_number, remote_status = excluded.remote_status, currency = excluded.currency, grand_total_minor = excluded.grand_total_minor, source_hash = excluded.source_hash, remote_modified_at = excluded.remote_modified_at, remote_payload_json = excluded.remote_payload_json, normalized_json = excluded.normalized_json, stale_export_at = CASE WHEN excluded.stale_export_at IS NOT NULL THEN excluded.stale_export_at ELSE orders.stale_export_at END, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        context.accountId,
        connectionId,
        input.orderNumber,
        input.externalOrderId,
        input.remoteStatus,
        input.currency,
        input.grandTotalMinor,
        input.sourceHash,
        input.modifiedAt,
        input.sourceJson,
        JSON.stringify(input),
        stale ? now : null,
        now,
        now,
      );
    for (const refund of input.refunds) {
      this.db
        .prepare(
          `INSERT INTO order_refunds (id, account_id, order_id, external_refund_id, amount_minor, reason, source_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, order_id, external_refund_id) DO UPDATE SET amount_minor = excluded.amount_minor, reason = excluded.reason, source_json = excluded.source_json`,
        )
        .run(
          `${id}:refund:${refund.externalRefundId}`,
          context.accountId,
          id,
          refund.externalRefundId,
          refund.amountMinor,
          typeof refund.reason === 'string' ? refund.reason : null,
          JSON.stringify(refund),
          now,
        );
    }
    return id;
  }

  markRemoteOrderDeleted(
    context: AccountContext,
    connectionId: string,
    externalOrderId: string,
  ): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE orders SET remote_deleted_at = ?, updated_at = ? WHERE account_id = ? AND connection_id = ? AND external_order_id = ? AND remote_deleted_at IS NULL',
      )
      .run(now, now, context.accountId, connectionId, externalOrderId);
    return result.changes === 1;
  }

  discoverOrderMetadata(
    context: AccountContext,
    connectionId: string,
    samples: readonly unknown[],
    scope = 'order',
  ): MetadataEntry[] {
    const entries = discoverMetadata(samples, scope);
    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO field_catalogs (id, account_id, connection_id, scope, source_key, sensitivity, inferred_type, occurrences, sample_json, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, connection_id, scope, source_key) DO UPDATE SET sensitivity = excluded.sensitivity, inferred_type = excluded.inferred_type, occurrences = field_catalogs.occurrences + excluded.occurrences, sample_json = CASE WHEN field_catalogs.sensitivity = 'safe' THEN excluded.sample_json ELSE NULL END, discovered_at = excluded.discovered_at`,
    );
    this.db.transaction(() => {
      for (const entry of entries)
        statement.run(
          `${context.accountId}:${connectionId}:${scope}:${entry.sourceKey}`,
          context.accountId,
          connectionId,
          scope,
          entry.sourceKey,
          entry.sensitivity,
          entry.inferredType,
          entry.occurrences,
          entry.sensitivity === 'safe' ? JSON.stringify(entry.sample) : null,
          now,
        );
    })();
    return entries;
  }

  createFieldMapping(
    context: AccountContext,
    input: {
      connectionId: string;
      sourceKey: string;
      label: string;
      type: MetadataType;
      targetFacet?: string;
    },
  ): FieldMapping {
    if (
      !input.label.trim() ||
      input.label.length > 120 ||
      !['text', 'number', 'money', 'boolean', 'date', 'enum', 'entity'].includes(input.type)
    )
      throw new Error('FIELD_MAPPING_INVALID');
    const catalog = this.db
      .prepare(
        'SELECT id, sensitivity FROM field_catalogs WHERE account_id = ? AND connection_id = ? AND scope = ? AND source_key = ?',
      )
      .get(context.accountId, input.connectionId, 'order', input.sourceKey) as
      { id: string; sensitivity: MetadataSensitivity } | undefined;
    if (!catalog || catalog.sensitivity !== 'safe') throw new Error('FIELD_MAPPING_PRIVATE');
    const now = new Date().toISOString();
    const id = `${context.accountId}:${input.connectionId}:mapping:${input.sourceKey}`;
    this.db
      .prepare(
        `INSERT INTO field_mappings (id, account_id, connection_id, source_key, label, type, target_facet, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, connection_id, source_key) DO UPDATE SET label = excluded.label, type = excluded.type, target_facet = excluded.target_facet, version = field_mappings.version + 1, active = 1, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        context.accountId,
        input.connectionId,
        input.sourceKey,
        input.label.trim(),
        input.type,
        input.targetFacet ?? null,
        now,
        now,
      );
    const mapping = this.db
      .prepare(
        'SELECT id, source_key, label, type, target_facet, version FROM field_mappings WHERE id = ? AND account_id = ?',
      )
      .get(id, context.accountId) as {
      id: string;
      source_key: string;
      label: string;
      type: MetadataType;
      target_facet: string | null;
      version: number;
    };
    this.db
      .prepare(
        'INSERT INTO audit_events (id, account_id, actor_id, action, target_type, target_id, summary_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomId(),
        context.accountId,
        context.actorId ?? null,
        'field-mapping.created',
        'field_mapping',
        id,
        JSON.stringify({
          sourceKey: input.sourceKey,
          type: input.type,
          targetFacet: input.targetFacet ?? null,
        }),
        context.correlationId,
        now,
      );
    return {
      id: mapping.id,
      sourceKey: mapping.source_key,
      label: mapping.label,
      type: mapping.type,
      targetFacet: mapping.target_facet,
      version: mapping.version,
    };
  }

  backfillFieldMapping(
    context: AccountContext,
    mappingId: string,
    cursor: string | null = null,
    limit = 100,
  ): { processed: number; mapped: number; errors: number; nextCursor: string | null } {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('FIELD_BACKFILL_LIMIT_INVALID');
    const mapping = this.db
      .prepare(
        'SELECT id, connection_id, source_key, type FROM field_mappings WHERE id = ? AND account_id = ? AND active = 1',
      )
      .get(mappingId, context.accountId) as
      { id: string; connection_id: string; source_key: string; type: MetadataType } | undefined;
    if (!mapping) throw new Error('FIELD_MAPPING_NOT_FOUND');
    const rows = this.db
      .prepare(
        `SELECT id, remote_payload_json FROM orders WHERE account_id = ? AND connection_id = ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .all(context.accountId, mapping.connection_id, cursor ?? '', limit) as Array<{
      id: string;
      remote_payload_json: string | null;
    }>;
    let mapped = 0;
    let errors = 0;
    const upsert = this.db.prepare(
      'INSERT INTO order_mapped_fields (account_id, order_id, mapping_id, value_text, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account_id, order_id, mapping_id) DO UPDATE SET value_text = excluded.value_text, updated_at = excluded.updated_at',
    );
    this.db.transaction(() => {
      for (const row of rows) {
        try {
          const source = row.remote_payload_json
            ? (JSON.parse(row.remote_payload_json) as unknown)
            : null;
          const item = readMetadata(source).find((entry) => entry.key === mapping.source_key);
          const value = item ? coerceMappedValue(item.value, mapping.type) : null;
          if (value === null) {
            errors += 1;
            continue;
          }
          upsert.run(context.accountId, row.id, mapping.id, value, new Date().toISOString());
          mapped += 1;
        } catch {
          errors += 1;
        }
      }
    })();
    return {
      processed: rows.length,
      mapped,
      errors,
      nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
    };
  }

  listJobs(
    context: AccountContext,
    input: {
      cursor?: string | null | undefined;
      limit?: number | undefined;
      status?: DurableJob['status'] | undefined;
      type?: DurableJobType | undefined;
    } = {},
  ): { items: readonly JobSummary[]; nextCursor: string | null; hasMore: boolean } {
    this.assertMember(context);
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('JOB_LIST_LIMIT_INVALID');
    const clauses = ['account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.status !== undefined) {
      if (!['queued', 'running', 'succeeded', 'failed', 'dead-lettered'].includes(input.status))
        throw new Error('JOB_STATUS_INVALID');
      clauses.push('status = ?');
      params.push(input.status);
    }
    if (input.type !== undefined) {
      if (!isDurableJobType(input.type)) throw new Error('JOB_TYPE_NOT_ALLOWED');
      clauses.push('type = ?');
      params.push(input.type);
    }
    if (input.cursor) {
      const cursor = decodedCursor(input.cursor);
      clauses.push('(updated_at < ? OR (updated_at = ? AND id < ?))');
      params.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress,
          cancel_requested, lease_until, last_error, created_at, updated_at, payload_json
         FROM jobs WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(...params, limit + 1) as JobRow[];
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const last = visible.at(-1);
    return {
      items: visible.map(jobSummary),
      hasMore,
      nextCursor:
        hasMore && last ? encodedCursor({ sortValue: last.updated_at, id: last.id }) : null,
    };
  }

  getJob(context: AccountContext, id: string): JobSummary {
    this.assertMember(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, type, idempotency_key, status, attempts, max_attempts, progress, payload_json, cancel_requested, lease_until, last_error, created_at, updated_at FROM jobs WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, id) as JobRow | undefined;
    if (!row) throw new Error('JOB_NOT_FOUND');
    return jobSummary(row);
  }

  listDeadLetters(
    context: AccountContext,
    input: {
      cursor?: string | null | undefined;
      limit?: number | undefined;
      type?: DurableJobType | undefined;
    } = {},
  ): { items: readonly JobSummary[]; nextCursor: string | null; hasMore: boolean } {
    return this.listJobs(context, { ...input, status: 'dead-lettered' });
  }

  replayDeadLetter(context: AccountContext, id: string): JobSummary {
    const actorId = this.requireMutationActor(context);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = 'queued', attempts = 0, progress = 0, cancel_requested = 0,
          lease_until = NULL, available_at = ?, last_error = NULL, updated_at = ?
         WHERE account_id = ? AND id = ? AND status = 'dead-lettered'`,
      )
      .run(now, now, context.accountId, id);
    if (result.changes !== 1) {
      const row = this.db
        .prepare('SELECT status FROM jobs WHERE account_id = ? AND id = ?')
        .get(context.accountId, id) as { status: DurableJob['status'] } | undefined;
      if (!row) throw new Error('JOB_NOT_FOUND');
      throw new Error('JOB_REPLAY_NOT_AVAILABLE');
    }
    this.audit(context, 'job.replayed', 'job', id, { actorId });
    return this.getJob(context, id);
  }

  getJobUsage(context: AccountContext): JobUsage {
    this.assertMember(context);
    const counts = this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          COALESCE(SUM(status = 'queued'), 0) AS queued,
          COALESCE(SUM(status = 'running'), 0) AS running,
          COALESCE(SUM(status = 'succeeded'), 0) AS succeeded,
          COALESCE(SUM(status = 'failed'), 0) AS failed,
          COALESCE(SUM(status = 'dead-lettered'), 0) AS dead_lettered,
          COALESCE(SUM(LENGTH(payload_json)), 0) AS payload_bytes
         FROM jobs WHERE account_id = ?`,
      )
      .get(context.accountId) as {
      total: number;
      queued: number;
      running: number;
      succeeded: number;
      failed: number;
      dead_lettered: number;
      payload_bytes: number;
    };
    const byType = this.db
      .prepare(
        `SELECT type, COUNT(*) AS total,
          COALESCE(SUM(status = 'queued'), 0) AS queued,
          COALESCE(SUM(status = 'running'), 0) AS running,
          COALESCE(SUM(status = 'dead-lettered'), 0) AS dead_lettered
         FROM jobs WHERE account_id = ? GROUP BY type ORDER BY type LIMIT 100`,
      )
      .all(context.accountId) as Array<{
      type: string;
      total: number;
      queued: number;
      running: number;
      dead_lettered: number;
    }>;
    return {
      total: Number(counts.total),
      queued: Number(counts.queued),
      running: Number(counts.running),
      succeeded: Number(counts.succeeded),
      failed: Number(counts.failed),
      deadLettered: Number(counts.dead_lettered),
      payloadBytes: Number(counts.payload_bytes),
      byType: byType.map((row) => ({
        type: row.type,
        total: Number(row.total),
        queued: Number(row.queued),
        running: Number(row.running),
        deadLettered: Number(row.dead_lettered),
      })),
    };
  }

  accountHealthSnapshot(context: AccountContext): StoreHealth {
    this.assertMember(context);
    const queue = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(status = 'queued'), 0) AS queued,
          COALESCE(SUM(status = 'running'), 0) AS running,
          COALESCE(SUM(status = 'dead-lettered'), 0) AS dead_lettered
         FROM jobs WHERE account_id = ?`,
      )
      .get(context.accountId) as { queued: number; running: number; dead_lettered: number };
    return {
      database: this.db.open ? 'connected' : 'degraded',
      schemaVersion,
      queue: {
        queued: Number(queue.queued),
        running: Number(queue.running),
        deadLettered: Number(queue.dead_lettered),
      },
    };
  }

  failJob(context: AccountContext, id: string, error: string): void {
    this.assertContext(context);
    const now = new Date();
    const nowIso = now.toISOString();
    const row = this.db
      .prepare(
        'SELECT type, attempts, max_attempts, status FROM jobs WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, id) as
      | { type: string; attempts: number; max_attempts: number; status: DurableJob['status'] }
      | undefined;
    if (!row) throw new Error('JOB_NOT_FOUND');
    if (row.status !== 'running') {
      if (row.status === 'dead-lettered') return;
      throw new Error('JOB_STATE_INVALID');
    }
    const deadLettered = row.attempts >= row.max_attempts;
    const delayMs = Math.min(
      JOB_RETRY_MAX_MS,
      JOB_RETRY_BASE_MS * 2 ** Math.max(0, row.attempts - 1),
    );
    const nextAvailable = new Date(now.getTime() + delayMs).toISOString();
    const safeError = redactedJobError(error);
    this.db
      .prepare(
        `UPDATE jobs SET status = ?, available_at = ?, lease_until = NULL, last_error = ?, updated_at = ?
         WHERE account_id = ? AND id = ? AND status = 'running'`,
      )
      .run(
        deadLettered ? 'dead-lettered' : 'queued',
        deadLettered ? nowIso : nextAvailable,
        safeError,
        nowIso,
        context.accountId,
        id,
      );
    this.audit(context, deadLettered ? 'job.dead-lettered' : 'job.retry-scheduled', 'job', id, {
      type: row.type,
      attempts: row.attempts,
      retryAt: deadLettered ? null : nextAvailable,
    });
  }

  cancelJob(context: AccountContext, id: string): void {
    this.requireMutationActor(context);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE jobs SET cancel_requested = 1,
          status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END,
          last_error = CASE WHEN status = 'queued' THEN 'JOB_CANCELLED' ELSE last_error END,
          lease_until = CASE WHEN status = 'queued' THEN NULL ELSE lease_until END,
          updated_at = ? WHERE account_id = ? AND id = ? AND status IN ('queued', 'running')`,
      )
      .run(now, context.accountId, id);
    if (result.changes !== 1) {
      const exists = this.db
        .prepare('SELECT id FROM jobs WHERE account_id = ? AND id = ?')
        .get(context.accountId, id);
      if (!exists) throw new Error('JOB_NOT_FOUND');
      return;
    }
    this.audit(context, 'job.cancel-requested', 'job', id, {});
  }

  cancelRunningJob(context: AccountContext, id: string): void {
    this.assertContext(context);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE jobs SET cancel_requested = 1, status = 'failed', last_error = 'JOB_CANCELLED',
          lease_until = NULL, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running'`,
      )
      .run(now, context.accountId, id);
    if (result.changes === 1) this.audit(context, 'job.cancelled', 'job', id, {});
  }

  beginWebhookProcessing(
    context: AccountContext,
    inboxId: string,
  ): {
    id: string;
    accountId: string;
    connectionId: string;
    topic: string;
    rawBody: Uint8Array;
    status: 'processing';
    attempts: number;
  } | null {
    this.assertContext(context);
    const row = this.db
      .prepare(
        'SELECT id, account_id, connection_id, topic, raw_body, status, attempts FROM webhook_inbox WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, inboxId) as
      | {
          id: string;
          account_id: string;
          connection_id: string;
          topic: string;
          raw_body: Buffer;
          status: 'accepted' | 'processing' | 'processed' | 'failed' | 'dead-lettered';
          attempts: number;
        }
      | undefined;
    if (!row) throw new Error('WEBHOOK_NOT_FOUND');
    if (row.status === 'processed') return null;
    const result = this.db
      .prepare(
        `UPDATE webhook_inbox SET status = 'processing', attempts = attempts + 1
         WHERE account_id = ? AND id = ? AND status IN ('accepted', 'failed', 'processing')`,
      )
      .run(context.accountId, inboxId);
    if (result.changes !== 1) return null;
    const updated = this.db
      .prepare('SELECT attempts FROM webhook_inbox WHERE account_id = ? AND id = ?')
      .get(context.accountId, inboxId) as { attempts: number };
    return {
      id: row.id,
      accountId: row.account_id,
      connectionId: row.connection_id,
      topic: row.topic,
      rawBody: new Uint8Array(row.raw_body),
      status: 'processing',
      attempts: updated.attempts,
    };
  }

  completeWebhook(context: AccountContext, inboxId: string): void {
    this.assertContext(context);
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE webhook_inbox SET status = 'processed', processed_at = ?, last_error = NULL
         WHERE account_id = ? AND id = ? AND status = 'processing'`,
      )
      .run(now, context.accountId, inboxId);
    if (result.changes === 1)
      this.audit(context, 'webhook.processed', 'webhook_inbox', inboxId, {});
  }

  failWebhook(context: AccountContext, inboxId: string, error: string): void {
    this.assertContext(context);
    const row = this.db
      .prepare('SELECT attempts FROM webhook_inbox WHERE account_id = ? AND id = ?')
      .get(context.accountId, inboxId) as { attempts: number } | undefined;
    if (!row) throw new Error('WEBHOOK_NOT_FOUND');
    const status = row.attempts >= 5 ? 'dead-lettered' : 'failed';
    const safeError = redactedJobError(error);
    const result = this.db
      .prepare(
        "UPDATE webhook_inbox SET status = ?, last_error = ? WHERE account_id = ? AND id = ? AND status = 'processing'",
      )
      .run(status, safeError, context.accountId, inboxId);
    if (result.changes === 1)
      this.audit(
        context,
        status === 'dead-lettered' ? 'webhook.dead-lettered' : 'webhook.failed',
        'webhook_inbox',
        inboxId,
        {
          attempts: row.attempts,
        },
      );
  }

  acceptWebhook(input: {
    id: string;
    accountId: string;
    connectionId: string;
    deliveryKey: string;
    topic: string;
    body: Uint8Array;
    checksum: string;
  }): { accepted: boolean; inboxId: string } {
    if (
      typeof input.accountId !== 'string' ||
      typeof input.connectionId !== 'string' ||
      typeof input.deliveryKey !== 'string' ||
      typeof input.topic !== 'string' ||
      !(input.body instanceof Uint8Array) ||
      typeof input.checksum !== 'string' ||
      input.deliveryKey.length < 1 ||
      input.deliveryKey.length > 200 ||
      /[\u0000-\u001f\u007f]/u.test(input.deliveryKey) ||
      input.topic.length < 1 ||
      input.topic.length > 120 ||
      /[\u0000-\u001f\u007f]/u.test(input.topic) ||
      input.body.byteLength > 256 * 1024 ||
      !/^[a-f0-9]{64}$/iu.test(input.checksum)
    )
      throw new Error('WEBHOOK_INPUT_INVALID');
    const connection = this.db
      .prepare('SELECT account_id FROM connections WHERE id = ? AND platform = ?')
      .get(input.connectionId, 'woocommerce') as { account_id: string } | undefined;
    if (!connection || connection.account_id !== input.accountId)
      throw new Error('WEBHOOK_CONNECTION_NOT_FOUND');
    const body = Buffer.from(input.body);
    const actualChecksum = createHash('sha256').update(body).digest('hex');
    if (actualChecksum !== input.checksum.toLowerCase())
      throw new Error('WEBHOOK_CHECKSUM_INVALID');
    const result = this.db
      .prepare(
        `INSERT INTO webhook_inbox (id, account_id, connection_id, delivery_key, topic, body_checksum, raw_body, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?) ON CONFLICT(account_id, connection_id, delivery_key) DO NOTHING`,
      )
      .run(
        input.id,
        input.accountId,
        input.connectionId,
        input.deliveryKey,
        input.topic,
        actualChecksum,
        body,
        new Date().toISOString(),
      );
    if (result.changes === 1) return { accepted: true, inboxId: input.id };
    const existing = this.db
      .prepare(
        'SELECT id FROM webhook_inbox WHERE account_id = ? AND connection_id = ? AND delivery_key = ?',
      )
      .get(input.accountId, input.connectionId, input.deliveryKey) as { id: string };
    if (!existing) throw new Error('WEBHOOK_DUPLICATE_LOOKUP_FAILED');
    return { accepted: false, inboxId: existing.id };
  }
}
