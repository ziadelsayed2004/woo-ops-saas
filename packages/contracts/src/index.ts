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
