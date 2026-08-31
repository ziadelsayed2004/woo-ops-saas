import type { DurableJob, JobExecutionContext } from '@woo-ops/application';
import { generateExport } from '@woo-ops/exports';
import type { ExportProfile as EngineExportProfile } from '@woo-ops/exports';
import type { AccountContext, ExportProfileVersion, SqliteStore } from '@woo-ops/persistence';
import { readPrivateExport, writePrivateExport } from './export-files.js';

type ExportEffect = (job: DurableJob, context: JobExecutionContext) => void | Promise<void>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const batchIdFrom = (payload: unknown): string => {
  if (!isRecord(payload) || typeof payload.exportBatchId !== 'string')
    throw new Error('EXPORT_JOB_PAYLOAD_INVALID');
  if (payload.exportBatchId.length < 1 || payload.exportBatchId.length > 256)
    throw new Error('EXPORT_JOB_PAYLOAD_INVALID');
  return payload.exportBatchId;
};

const engineProfile = (version: ExportProfileVersion): EngineExportProfile => ({
  id: version.id,
  name: `Woo Ops export ${version.version}`,
  version: version.version,
  format: version.format,
  rowMode: version.rowMode,
  columns: version.columns,
  filenameTemplate: version.filenameTemplate,
  ...(Object.keys(version.config).length === 0 ? {} : { config: version.config }),
});

const workerContext = (job: DurableJob, context: JobExecutionContext): AccountContext => ({
  accountId: job.accountId,
  correlationId: context.correlationId,
});

const throwIfCancelled = async (context: JobExecutionContext): Promise<void> => {
  if (await context.isCancellationRequested()) throw new Error('JOB_CANCELLED');
};

const pageProgress = (
  processed: number,
  expected: number,
  lower: number,
  upper: number,
): number => {
  if (expected < 1) return upper;
  return Math.min(upper, lower + Math.floor((processed / expected) * (upper - lower)));
};

export const createExportEffect =
  (store: SqliteStore, storageRoot: string): ExportEffect =>
  async (job, execution) => {
    const batchId = batchIdFrom(job.payload);
    const context = workerContext(job, execution);
    let batch = store.getExportBatchForWorker(context, batchId);
    if (batch.status === 'failed') throw new Error('EXPORT_BATCH_FAILED_RETRY_REQUIRED');
    try {
      if (batch.status === 'queued') batch = store.startExportBatchForWorker(context, batchId);
      const version = store.getExportProfileVersionForWorker(context, batch.profileVersionId);
      const profile = engineProfile(version);

      while (!batch.snapshotComplete) {
        await throwIfCancelled(execution);
        const page = store.materializeExportSnapshotPage(context, batchId);
        batch = store.getExportBatchForWorker(context, batchId);
        await execution.reportProgress(
          pageProgress(batch.snapshotOrderCount, Math.max(batch.orderCount, 1), 5, 45),
        );
        if (!page.hasMore) break;
      }

      batch = store.getExportBatchForWorker(context, batchId);
      if (!batch.snapshotComplete) throw new Error('EXPORT_SNAPSHOT_INCOMPLETE');
      const snapshotHash = store.getExportSnapshotHashForWorker(context, batchId);
      await throwIfCancelled(execution);

      if (batch.status !== 'completed') {
        const orders: Record<string, unknown>[] = [];
        let offset = 0;
        for (;;) {
          const page = store.getExportSnapshotPageForWorker(context, batchId, offset);
          orders.push(...page.items);
          offset = page.nextOffset ?? offset;
          await execution.reportProgress(
            pageProgress(orders.length, Math.max(batch.snapshotOrderCount, 1), 45, 75),
          );
          if (!page.hasMore) break;
        }
        const result = await generateExport({
          profile,
          orders,
          snapshotHash,
          maxRows: 200_000,
        });
        await throwIfCancelled(execution);
        const stored = writePrivateExport(
          storageRoot,
          context.accountId,
          batch.id,
          result.format,
          result.bytes,
        );
        const completionInput = {
          orderCount: result.orderCount,
          rowCount: result.rowCount,
          filename: result.filename,
          filePath: stored.relativePath,
          checksum: stored.checksum,
          ...(batch.snapshotHash === null ? {} : { snapshotHash: batch.snapshotHash }),
          ...(result.snapshotHash === null ? {} : { orderSnapshotHash: result.snapshotHash }),
        };
        batch = store.completeExportBatchForWorker(context, batch.id, completionInput);
      }

      const completedHash = batch.orderSnapshotHash ?? snapshotHash;
      let offset = 0;
      for (;;) {
        await throwIfCancelled(execution);
        const page = store.getExportSnapshotPageForWorker(context, batchId, offset);
        if (page.orderIds.length > 0)
          store.recordExportedOrdersForWorker(context, batchId, page.orderIds, completedHash);
        offset = page.nextOffset ?? offset;
        await execution.reportProgress(
          pageProgress(offset, Math.max(batch.snapshotOrderCount, 1), 75, 99),
        );
        if (!page.hasMore) break;
      }
      await execution.reportProgress(100);
    } catch (error) {
      const current = store.getExportBatchForWorker(context, batchId);
      if (current.status !== 'completed' && (error as Error).message !== 'JOB_CANCELLED')
        store.failExportBatchForWorker(
          context,
          batchId,
          error instanceof Error ? error.message : 'EXPORT_GENERATION_FAILED',
        );
      throw error;
    }
  };

export { readPrivateExport };
