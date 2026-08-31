import type { DurableJob, JobExecutionContext } from '@woo-ops/application';
import { createZipArchive, generateDocument, mergeDocumentPdfs } from '@woo-ops/documents';
import type { DocumentOrder, DocumentTemplate } from '@woo-ops/documents';
import type {
  AccountContext,
  DocumentBatchItemRecord,
  DocumentTemplateRecord,
  SqliteStore,
} from '@woo-ops/persistence';
import { readPrivateDocumentArtifact, writePrivateDocumentArtifact } from './document-artifacts.js';

type DocumentEffect = (job: DurableJob, context: JobExecutionContext) => void | Promise<void>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const batchIdFrom = (payload: unknown): string => {
  if (!isRecord(payload) || typeof payload.documentBatchId !== 'string')
    throw new Error('DOCUMENT_JOB_PAYLOAD_INVALID');
  if (payload.documentBatchId.length < 1 || payload.documentBatchId.length > 256)
    throw new Error('DOCUMENT_JOB_PAYLOAD_INVALID');
  return payload.documentBatchId;
};

const workerContext = (job: DurableJob, execution: JobExecutionContext): AccountContext => ({
  accountId: job.accountId,
  correlationId: execution.correlationId,
});

const throwIfCancelled = async (execution: JobExecutionContext): Promise<void> => {
  if (await execution.isCancellationRequested()) throw new Error('JOB_CANCELLED');
};

const progress = (processed: number, total: number, lower: number, upper: number): number =>
  total < 1 ? upper : Math.min(upper, lower + Math.floor((processed / total) * (upper - lower)));

const safeOrderName = (item: DocumentBatchItemRecord): string =>
  `order-${String(item.position + 1).padStart(4, '0')}-${item.orderId.slice(-12)}`;

const artifactIdForOrder = (batchId: string, item: DocumentBatchItemRecord): string =>
  `order-${batchId.slice(0, 32)}-${item.position}`;

const artifactIdForBatch = (
  kind: 'merged' | 'zip' | 'manifest',
  batchId: string,
  attempt: number,
): string => `${kind}-${batchId.slice(0, 32)}-${attempt}`;

const documentTemplateForEngine = (
  template: DocumentTemplateRecord,
  fontBytes: Uint8Array | undefined,
): DocumentTemplate => ({
  id: template.id,
  version: template.version,
  name: template.name,
  companyName: template.companyName,
  ...(template.companyAddress === null ? {} : { companyAddress: template.companyAddress }),
  ...(template.footerText === null ? {} : { footerText: template.footerText }),
  locale: template.locale,
  direction: template.direction,
  ...(template.body ? { body: template.body } : {}),
  ...(fontBytes === undefined ? {} : { fontBytes }),
});

const documentArtifactName = (
  kind: 'merged' | 'zip' | 'manifest',
  batchId: string,
  attempt: number,
): string => {
  const extension = kind === 'merged' ? 'pdf' : kind === 'zip' ? 'zip' : 'json';
  return `documents-${batchId.slice(0, 12)}-${kind}-${attempt}.${extension}`;
};

export const createDocumentEffect =
  (store: SqliteStore, storageRoot: string, fontBytes?: Uint8Array): DocumentEffect =>
  async (job, execution) => {
    const batchId = batchIdFrom(job.payload);
    const context = workerContext(job, execution);
    let batch = store.getDocumentBatchForWorker(context, batchId);
    if (['completed', 'partial', 'cancelled'].includes(batch.status)) return;
    if (batch.jobId !== job.id) return;
    try {
      if (batch.status === 'queued') batch = store.startDocumentBatchForWorker(context, batchId);
      else if (batch.status === 'running' || batch.status === 'failed')
        batch = store.resumeDocumentBatchForWorker(context, batchId);
      const template = documentTemplateForEngine(batch.template, fontBytes);
      for (;;) {
        await throwIfCancelled(execution);
        const item = store.claimNextDocumentItem(context, batchId);
        if (!item) break;
        try {
          const artifactId = artifactIdForOrder(batch.id, item);
          let artifact;
          try {
            artifact = store.getDocumentArtifactForWorker(context, artifactId);
            readPrivateDocumentArtifact(storageRoot, artifact.relativePath, artifact.checksum);
          } catch (error) {
            const code =
              error instanceof Error ? (error as Error & { code?: string }).code : undefined;
            if (
              !(error instanceof Error && error.message === 'DOCUMENT_ARTIFACT_NOT_FOUND') &&
              code !== 'ENOENT'
            )
              throw error;
            const result = await generateDocument({
              order: item.snapshot as DocumentOrder,
              format: batch.format,
              template,
              orderId: item.orderId,
              ...(item.documentNumber === null ? {} : { documentNumber: item.documentNumber }),
              documentKind: batch.legalInvoiceEnabled ? 'invoice' : 'order',
            });
            const stored = writePrivateDocumentArtifact(
              storageRoot,
              context.accountId,
              batch.id,
              artifactId,
              'pdf',
              result.bytes,
            );
            artifact = store.registerDocumentArtifactForWorker(context, {
              id: artifactId,
              batchId: batch.id,
              orderId: item.orderId,
              templateId: batch.templateId,
              templateVersion: batch.templateVersion,
              format: batch.format,
              kind: 'order-pdf',
              relativePath: stored.relativePath,
              filename: `${safeOrderName(item)}.pdf`,
              mimeType: 'application/pdf',
              byteSize: stored.byteSize,
              checksum: stored.checksum,
              snapshotHash: item.snapshotHash,
            });
          }
          void artifact;
          store.completeDocumentBatchItemForWorker(context, batchId, item.position, artifactId);
        } catch (error) {
          store.failDocumentBatchItemForWorker(
            context,
            batchId,
            item.position,
            error instanceof Error ? error.message : 'DOCUMENT_GENERATION_FAILED',
          );
        }
        batch = store.getDocumentBatchForWorker(context, batchId);
        await execution.reportProgress(progress(batch.processedCount, batch.totalCount, 5, 88));
      }

      batch = store.getDocumentBatchForWorker(context, batchId);
      if (batch.processedCount < batch.totalCount)
        throw new Error('DOCUMENT_BATCH_ITEMS_INCOMPLETE');
      const items = store.getDocumentBatchItemsForWorker(context, batchId);
      const successful = items.filter((item) => item.status === 'succeeded' && item.artifactId);
      const failed = items.filter((item) => item.status === 'failed');
      const pdfEntries = successful.map((item) => {
        const artifact = store.getDocumentArtifactForWorker(context, item.artifactId as string);
        const bytes = readPrivateDocumentArtifact(
          storageRoot,
          artifact.relativePath,
          artifact.checksum,
        );
        return { item, artifact, bytes };
      });
      await throwIfCancelled(execution);
      const manifest = {
        version: 1,
        batchId: batch.id,
        accountId: context.accountId,
        templateId: batch.templateId,
        templateVersion: batch.templateVersion,
        action: batch.action,
        format: batch.format,
        snapshotHash: batch.snapshotHash,
        generatedAt: batch.createdAt,
        documents: items.map((item) => {
          const artifact = item.artifactId
            ? store.getDocumentArtifactForWorker(context, item.artifactId)
            : null;
          return {
            position: item.position,
            orderId: item.orderId,
            documentNumber: item.documentNumber,
            status: item.status,
            snapshotHash: item.snapshotHash,
            ...(artifact === null
              ? {}
              : {
                  artifactId: artifact.id,
                  filename: artifact.filename,
                  checksum: artifact.checksum,
                }),
            ...(item.error === null ? {} : { error: item.error }),
          };
        }),
        failures: failed.map((item) => ({
          position: item.position,
          orderId: item.orderId,
          error: item.error ?? 'DOCUMENT_GENERATION_FAILED',
        })),
      };
      const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
      const manifestId = artifactIdForBatch('manifest', batch.id, batch.attemptCount);
      const storedManifest = writePrivateDocumentArtifact(
        storageRoot,
        context.accountId,
        batch.id,
        manifestId,
        'json',
        manifestBytes,
      );
      const manifestArtifact = store.registerDocumentArtifactForWorker(context, {
        id: manifestId,
        batchId: batch.id,
        templateId: batch.templateId,
        templateVersion: batch.templateVersion,
        format: batch.format,
        kind: 'manifest',
        relativePath: storedManifest.relativePath,
        filename: documentArtifactName('manifest', batch.id, batch.attemptCount),
        mimeType: 'application/json',
        byteSize: storedManifest.byteSize,
        checksum: storedManifest.checksum,
        snapshotHash: batch.snapshotHash,
      });

      let mergedArtifactId: string | null = null;
      if (pdfEntries.length > 0) {
        const mergedBytes = await mergeDocumentPdfs(pdfEntries.map((entry) => entry.bytes));
        mergedArtifactId = artifactIdForBatch('merged', batch.id, batch.attemptCount);
        const storedMerged = writePrivateDocumentArtifact(
          storageRoot,
          context.accountId,
          batch.id,
          mergedArtifactId,
          'pdf',
          mergedBytes,
        );
        store.registerDocumentArtifactForWorker(context, {
          id: mergedArtifactId,
          batchId: batch.id,
          templateId: batch.templateId,
          templateVersion: batch.templateVersion,
          format: batch.format,
          kind: 'merged-pdf',
          relativePath: storedMerged.relativePath,
          filename: documentArtifactName('merged', batch.id, batch.attemptCount),
          mimeType: 'application/pdf',
          byteSize: storedMerged.byteSize,
          checksum: storedMerged.checksum,
          snapshotHash: batch.snapshotHash,
        });
      }

      const zipEntries = [
        { name: 'manifest.json', bytes: manifestBytes },
        ...pdfEntries.map((entry) => ({ name: entry.artifact.filename, bytes: entry.bytes })),
      ];
      const zipBytes = createZipArchive(zipEntries);
      const zipArtifactId = artifactIdForBatch('zip', batch.id, batch.attemptCount);
      const storedZip = writePrivateDocumentArtifact(
        storageRoot,
        context.accountId,
        batch.id,
        zipArtifactId,
        'zip',
        zipBytes,
      );
      store.registerDocumentArtifactForWorker(context, {
        id: zipArtifactId,
        batchId: batch.id,
        templateId: batch.templateId,
        templateVersion: batch.templateVersion,
        format: batch.format,
        kind: 'zip',
        relativePath: storedZip.relativePath,
        filename: documentArtifactName('zip', batch.id, batch.attemptCount),
        mimeType: 'application/zip',
        byteSize: storedZip.byteSize,
        checksum: storedZip.checksum,
        snapshotHash: batch.snapshotHash,
      });
      store.completeDocumentBatchForWorker(context, batch.id, {
        ...(mergedArtifactId === null ? {} : { mergedArtifactId }),
        zipArtifactId,
        manifestArtifactId: manifestArtifact.id,
      });
      await execution.reportProgress(100);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'DOCUMENT_BATCH_FAILED';
      if (message === 'JOB_CANCELLED') {
        store.cancelDocumentBatchForWorker(context, batchId);
      } else {
        const current = store.getDocumentBatchForWorker(context, batchId);
        if (current.status !== 'completed' && current.status !== 'partial')
          store.failDocumentBatchForWorker(context, batchId, message);
      }
      throw error;
    }
  };
