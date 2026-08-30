import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  database: z.enum(['connected', 'degraded']),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

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
    field: z.enum(['remoteCreatedAt', 'updatedAt', 'orderNumber', 'grandTotalMinor', 'id']),
    direction: z.enum(['asc', 'desc']),
  })
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

const minorAmountSchema = z.string().regex(/^-?\d{1,18}$/);
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
