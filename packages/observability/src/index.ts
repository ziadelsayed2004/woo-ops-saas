export type LogContext = Readonly<{ correlationId: string; event: string }>;
export const redact = (value: unknown): unknown =>
  typeof value === 'object' && value !== null ? '[redacted-object]' : value;
