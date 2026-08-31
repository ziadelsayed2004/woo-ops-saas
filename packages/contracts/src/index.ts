import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.string(),
  database: z.enum(['connected', 'degraded']),
  version: z.string(),
  schemaVersion: z.number().int().nonnegative().optional(),
  queue: z
    .object({
      queued: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      deadLettered: z.number().int().nonnegative(),
    })
    .optional(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

const accountLocaleSchema = z.enum(['ar-EG', 'en-US']);
const accountDirectionSchema = z.enum(['rtl', 'ltr']);
const accountRoleSchema = z.enum(['owner', 'admin', 'operator', 'viewer']);
const memberRoleSchema = z.enum(['admin', 'operator', 'viewer']);

export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    locale: accountLocaleSchema.optional(),
    direction: accountDirectionSchema.optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    baseCurrency: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
  })
  .strict();
export const memberRoleUpdateSchema = z.object({ role: accountRoleSchema }).strict();
export const invitationCreateSchema = z
  .object({
    email: z.string().trim().email().max(320),
    role: memberRoleSchema,
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const invitationAcceptSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/u) })
  .strict();
export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(12).max(1024),
    newPassword: z.string().min(12).max(1024),
  })
  .strict();
export const passwordResetRequestSchema = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();
export const passwordResetConfirmSchema = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{32,80}$/u),
    newPassword: z.string().min(12).max(1024),
  })
  .strict();
export const sessionTargetSchema = z
  .object({ targetUserId: z.string().trim().min(1).max(256).optional() })
  .strict();

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), correlationId: z.string() }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

const selectionModeSchema = z.enum(['explicit', 'query']);
const bulkActionSchema = z.enum([
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
]);
const orderSortSchema = z
  .object({
    field: z.enum([
      'remoteCreatedAt',
      'remoteModifiedAt',
      'createdAt',
      'updatedAt',
      'orderNumber',
      'grandTotalMinor',
      'total',
      'id',
    ]),
    direction: z.enum(['asc', 'desc']),
  })
  .strict();
export const orderQuerySchema = z
  .object({
    search: z.string().max(200).optional(),
    filter: z.unknown().optional(),
    includeFacets: z.boolean().optional(),
    cursor: z.string().max(2_000).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    sort: orderSortSchema.optional(),
  })
  .strict();
export const orderLocalWorkflowSchema = z
  .object({
    version: z.number().int().min(1),
    localStatus: z.string().trim().min(1).max(80).optional(),
    assigneeId: z.string().trim().min(1).max(256).nullable().optional(),
  })
  .strict()
  .refine((value) => value.localStatus !== undefined || value.assigneeId !== undefined);
export const orderTagSchema = z
  .object({ tag: z.string().trim().min(1).max(80), version: z.number().int().min(1) })
  .strict();
export const orderNoteSchema = z
  .object({ text: z.string().trim().min(1).max(5_000), version: z.number().int().min(1) })
  .strict();
const savedViewVisibilitySchema = z.enum(['private', 'shared']);
const exportFormatSchema = z.enum(['csv', 'xlsx']);
const exportRowModeSchema = z.enum(['order', 'line', 'package', 'carrier']);
const exportColumnSchema = z
  .object({
    key: z.string().trim().min(1).max(180),
    label: z.string().trim().min(1).max(160),
    type: z.enum(['text', 'number', 'date', 'money']).optional(),
  })
  .strict();
export const exportProfileCreateSchema = z
  .object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional() })
  .strict();
export const exportProfileVersionCreateSchema = z
  .object({
    format: exportFormatSchema,
    rowMode: exportRowModeSchema,
    columns: z.array(exportColumnSchema).min(1).max(100),
    filenameTemplate: z.string().trim().min(1).max(180),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const exportBatchCreateSchema = z
  .object({
    selectionId: z.string().min(1).max(256),
    profileVersionId: z.string().min(1).max(256),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();
export const exportUnexportSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();
export const exportMarkOrdersSchema = z
  .object({
    orderIds: z.array(z.string().min(1).max(256)).min(1).max(5_000),
    snapshotHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
  })
  .strict();

const documentFormatSchema = z.enum(['a4', 'a5', 'thermal-80mm', 'label-100x150mm']);
const documentLocaleSchema = z.enum(['ar-EG', 'en-US']);
const documentDirectionSchema = z.enum(['rtl', 'ltr']);
const documentOrderSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 128 * 1024, 'Document order is too large');
export const documentTemplateCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    format: documentFormatSchema,
    locale: documentLocaleSchema.optional(),
    direction: documentDirectionSchema.optional(),
    body: z.string().max(5_000).optional(),
    companyName: z.string().trim().min(1).max(240),
    companyAddress: z.string().max(500).optional(),
    footerText: z.string().max(500).optional(),
  })
  .strict();
export const documentTemplateUpdateSchema = documentTemplateCreateSchema
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict();
export const documentPreviewSchema = z
  .object({
    order: documentOrderSchema.default({}),
    format: documentFormatSchema.optional(),
    orderId: z.string().trim().min(1).max(256).optional(),
    documentNumber: z.string().trim().min(1).max(120).optional(),
    barcodeValue: z.string().trim().min(1).max(120).optional(),
    qrValue: z.string().trim().min(1).max(500).optional(),
    thermalHeightMm: z.number().finite().min(50).max(500).optional(),
  })
  .strict();
export const documentJobCreateSchema = z
  .object({
    selectionId: z.string().trim().min(1).max(256),
    action: z.enum(['generate-invoice', 'generate-thermal', 'generate-label', 'print-documents']),
    templateId: z.string().trim().min(1).max(256),
    format: documentFormatSchema.optional(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict();

const minorAmountSchema = z.string().regex(/^-?\d{1,18}$/);
const analyticsDateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const analyticsSourceSchema = z.enum(['woo', 'manual', 'combined']);
export const analyticsFilterSchema = z
  .object({
    from: analyticsDateKeySchema.optional(),
    to: analyticsDateKeySchema.optional(),
    source: analyticsSourceSchema.optional(),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .optional(),
    store: z.string().trim().min(1).max(256).optional(),
    status: z.string().trim().min(1).max(120).optional(),
    shippingMethod: z.string().trim().min(1).max(256).optional(),
    product: z.string().trim().min(1).max(256).optional(),
    category: z.string().trim().min(1).max(256).optional(),
    author: z.string().trim().min(1).max(256).optional(),
  })
  .strict();
export const analyticsBreakdownSchema = analyticsFilterSchema
  .extend({
    dimension: z
      .enum([
        'source',
        'currency',
        'channel',
        'pos',
        'store',
        'shippingMethod',
        'paymentMethod',
        'status',
        'product',
        'category',
        'author',
      ])
      .optional(),
  })
  .strict();
export const costRuleCreateSchema = z
  .object({
    scope: z.enum(['product', 'variation', 'shipping', 'payment', 'return']),
    key: z.string().trim().min(1).max(256),
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    amountMinor: z.string().regex(/^(?:0|[1-9]\d{0,17})$/),
    source: z.string().trim().min(1).max(120),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();
export const costRuleUpdateSchema = z
  .object({
    active: z.boolean().optional(),
    effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();
const manualJsonObjectSchema = z.record(z.string(), z.unknown());
const manualLineSchema = z
  .object({
    name: z.string().trim().min(1).max(240),
    sku: z.string().trim().max(120).optional(),
    productId: z.string().trim().max(256).optional(),
    variationId: z.string().trim().max(256).optional(),
    quantity: z.number().int().min(1).max(100000),
    unitPriceMinor: minorAmountSchema,
    discountMinor: minorAmountSchema.optional(),
    taxMinor: minorAmountSchema.optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();
const manualOrderFieldsSchema = {
  currency: z
    .string()
    .regex(/^[A-Za-z]{3}$/)
    .optional(),
  customer: manualJsonObjectSchema.optional(),
  billing: manualJsonObjectSchema.optional(),
  shipping: manualJsonObjectSchema.optional(),
  payment: manualJsonObjectSchema.optional(),
  shippingMethod: manualJsonObjectSchema.optional(),
  lines: z.array(manualLineSchema).min(1).max(500).optional(),
  shippingCollectedMinor: minorAmountSchema.optional(),
  taxMinor: minorAmountSchema.optional(),
  discountMinor: minorAmountSchema.optional(),
  feesMinor: minorAmountSchema.optional(),
  localStatus: z.string().trim().min(1).max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  notes: z.string().max(5000).optional(),
  assigneeId: z.string().trim().max(256).nullable().optional(),
};
export const manualOrderCreateSchema = z
  .object({
    ...manualOrderFieldsSchema,
    currency: z.string().regex(/^[A-Za-z]{3}$/),
    lines: z.array(manualLineSchema).min(1).max(500),
  })
  .strict();
export const manualOrderUpdateSchema = z
  .object({ ...manualOrderFieldsSchema, version: z.number().int().min(1) })
  .strict();

export const selectionCreateSchema = z
  .object({
    mode: selectionModeSchema,
    orderIds: z.array(z.string().min(1).max(256)).max(1_000).optional(),
    query: z.unknown().optional(),
    exclusions: z.array(z.string().min(1).max(256)).max(1_000).optional(),
    watermark: z.string().max(64).optional(),
    expiresAt: z.string().max(64).optional(),
  })
  .strict();
export const selectionResolveSchema = z
  .object({
    cursor: z.string().max(512).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const bulkPreviewSchema = z
  .object({
    selectionId: z.string().min(1).max(256),
    action: bulkActionSchema,
    parameters: z.unknown().optional(),
  })
  .strict();
export const bulkCreateSchema = z
  .object({
    selectionId: z.string().min(1).max(256),
    action: bulkActionSchema,
    parameters: z.unknown().optional(),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();
export const savedViewCreateSchema = z
  .object({
    name: z.string().min(1).max(120),
    query: z.unknown().optional(),
    sort: orderSortSchema.nullable().optional(),
    columns: z.array(z.string().min(1).max(80)).max(100).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    visibility: savedViewVisibilitySchema.optional(),
  })
  .strict();
export const savedViewUpdateSchema = savedViewCreateSchema
  .extend({ version: z.number().int().min(1).optional() })
  .partial()
  .strict();
export const bulkFailuresSchema = selectionResolveSchema;
export const bulkJobListSchema = z
  .object({
    cursor: z.string().max(512).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    status: z.enum(['queued', 'running', 'succeeded', 'failed', 'partial', 'cancelled']).optional(),
  })
  .strict();

export const durableJobTypeSchema = z.enum([
  'webhook.process',
  'sync.initial',
  'sync.incremental',
  'sync.reconcile',
  'bulk.process',
  'export.generate',
  'document.generate',
  'analytics.rebuild',
  'backup.create',
  'maintenance',
]);
export const durableJobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead-lettered',
]);
export const operationJobListSchema = z
  .object({
    cursor: z.string().max(512).nullable().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    status: durableJobStatusSchema.optional(),
    type: durableJobTypeSchema.optional(),
  })
  .strict();

export const wooCredentialSchema = z
  .object({
    key: z.string().regex(/^ck_[A-Za-z0-9_-]{1,200}$/u),
    secret: z.string().regex(/^cs_[A-Za-z0-9_-]{1,200}$/u),
  })
  .strict();
export const connectionSyncRequestSchema = z
  .object({ idempotencyKey: z.string().trim().min(1).max(200) })
  .strict();
export const connectionRotateSchema = wooCredentialSchema;
export const connectionWebhookSecretSchema = z
  .object({ secret: z.string().trim().min(16).max(512) })
  .strict();
