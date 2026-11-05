export type SpreadsheetBatch = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  format: 'csv' | 'xlsx';
  orderCount: number;
  rowCount: number;
  filename: string | null;
  createdAt?: string;
  error: string | null;
};

export type SpreadsheetSource = 'orders' | 'customer-recovery';
export const spreadsheetApiPath = (source: SpreadsheetSource): string =>
  source === 'customer-recovery' ? '/api/v1/customer-recovery/reports' : '/api/v1/export-batches';

export function downloadSpreadsheet(
  batch: Pick<SpreadsheetBatch, 'id' | 'filename'>,
  source: SpreadsheetSource = 'orders',
): void {
  const anchor = document.createElement('a');
  anchor.href = `${spreadsheetApiPath(source)}/${encodeURIComponent(batch.id)}/download`;
  anchor.download = batch.filename ?? '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

// Poll one durable job rather than repeatedly loading the entire export history.
// Keep longer jobs downloadable without forcing the operator to find them below the form.
export async function downloadWhenSpreadsheetReady(
  batchId: string,
  source: SpreadsheetSource = 'orders',
): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  let delay = 750;
  while (Date.now() < deadline) {
    const response = await fetch(`${spreadsheetApiPath(source)}/${encodeURIComponent(batchId)}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`EXPORT_DOWNLOAD_HTTP_${response.status}`);
    const body = (await response.json()) as { batch?: SpreadsheetBatch; report?: SpreadsheetBatch };
    const batch = source === 'customer-recovery' ? body.report : body.batch;
    if (!batch) throw new Error('EXPORT_STATUS_INVALID');
    if (batch.status === 'completed') {
      downloadSpreadsheet(batch, source);
      return;
    }
    if (batch.status === 'failed') throw new Error(batch.error ?? 'EXPORT_CREATE_FAILED');
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    delay = Math.min(3_000, Math.round(delay * 1.3));
  }
  throw new Error('EXPORT_DOWNLOAD_TIMEOUT');
}
