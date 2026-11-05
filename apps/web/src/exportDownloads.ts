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

export function downloadSpreadsheet(batch: Pick<SpreadsheetBatch, 'id' | 'filename'>): void {
  const anchor = document.createElement('a');
  anchor.href = `/api/v1/export-batches/${encodeURIComponent(batch.id)}/download`;
  anchor.download = batch.filename ?? '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

// Poll one durable job rather than repeatedly loading the entire export history.
// Keep longer jobs downloadable without forcing the operator to find them below the form.
export async function downloadWhenSpreadsheetReady(batchId: string): Promise<void> {
  const deadline = Date.now() + 10 * 60_000;
  let delay = 750;
  while (Date.now() < deadline) {
    const response = await fetch(`/api/v1/export-batches/${encodeURIComponent(batchId)}`, {
      credentials: 'include',
    });
    if (!response.ok) throw new Error(`EXPORT_DOWNLOAD_HTTP_${response.status}`);
    const { batch } = (await response.json()) as { batch: SpreadsheetBatch };
    if (batch.status === 'completed') {
      downloadSpreadsheet(batch);
      return;
    }
    if (batch.status === 'failed') throw new Error(batch.error ?? 'EXPORT_CREATE_FAILED');
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    delay = Math.min(3_000, Math.round(delay * 1.3));
  }
  throw new Error('EXPORT_DOWNLOAD_TIMEOUT');
}
