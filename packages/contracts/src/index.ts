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
