import type { DurableJob, JobExecutionContext } from '@woo-ops/application';
import {
  createHtmlPdfRenderSession,
  createZipArchive,
  generateDocument,
  mergeDocumentPdfs,
} from '@woo-ops/documents';
import type { DocumentOrder, DocumentTemplate, HtmlPdfRenderSession } from '@woo-ops/documents';
import type {
  AccountContext,
  DocumentBatchItemRecord,
  DocumentTemplateRecord,
  SqliteStore,
} from '@woo-ops/persistence';
import { readPrivateDocumentArtifact, writePrivateDocumentArtifact } from './document-artifacts.js';

type DocumentEffect = (job: DurableJob, context: JobExecutionContext) => void | Promise<void>;

type DocumentEffectOptions = Readonly<{
  createRenderSession?: () => Promise<HtmlPdfRenderSession>;
  maxDocumentsPerSession?: number;
}>;

const DEFAULT_MAX_DOCUMENTS_PER_SESSION = 50;

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

const safeDocumentError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'DOCUMENT_GENERATION_FAILED';
  if (error.message === 'DOCUMENT_RENDER_SESSION_CLOSED') return 'DOCUMENT_RENDERER_UNAVAILABLE';
  if (/^DOCUMENT_[A-Z0-9_]+$/u.test(error.message)) return error.message;
  const message = error.message.toLowerCase();
  if (
    message.includes('executable') ||
    message.includes('failed to launch') ||
    message.includes('playwright') ||
    message.includes('browser') ||
    message.includes('target page') ||
    message.includes('connection closed') ||
    message.includes('page crashed')
  )
    return 'DOCUMENT_RENDERER_UNAVAILABLE';
  return 'DOCUMENT_GENERATION_FAILED';
};

const safeOrderNumber = (item: DocumentBatchItemRecord): string => {
  const snapshot = isRecord(item.snapshot) ? item.snapshot : {};
  const candidate = String(snapshot.orderNumber ?? snapshot.number ?? item.orderId)
    .replace(/[^A-Za-z0-9_-]/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 48);
  return candidate || String(item.position + 1).padStart(4, '0');
};

const safeOrderName = (
  item: DocumentBatchItemRecord,
  format: DocumentTemplateRecord['format'],
  createdAt: string,
): string => {
  const prefix =
    format === 'a4'
      ? 'invoice'
      : format === 'a5'
        ? 'invoice-a5'
        : format === 'thermal-80mm'
          ? 'receipt-80mm'
          : 'shipping-label-80mm';
  return `${prefix}-order-${safeOrderNumber(item)}-${artifactDate(createdAt)}`;
};

const artifactDate = (createdAt: string): string => {
  const value = createdAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) ? value : 'undated';
};

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
  createdAt: string,
  format: DocumentTemplateRecord['format'],
): string => {
  const extension = kind === 'merged' ? 'pdf' : kind === 'zip' ? 'zip' : 'json';
  const documentType =
    format === 'a4'
      ? 'invoices-a4'
      : format === 'a5'
        ? 'invoices-a5'
        : format === 'thermal-80mm'
          ? 'receipts-80mm'
          : 'shipping-labels-80mm';
  const date = artifactDate(createdAt);
  if (kind === 'zip') return `${documentType}-${date}.zip`;
  return `${documentType}-${date}-${kind}.${extension}`;
};

export const createDocumentEffect =
  (
    store: SqliteStore,
    storageRoot: string,
    fontBytes?: Uint8Array,
    options: DocumentEffectOptions = {},
  ): DocumentEffect =>
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
      const createRenderSession = options.createRenderSession ?? createHtmlPdfRenderSession;
      const maxDocumentsPerSession = Math.max(
        1,
        Math.min(100, options.maxDocumentsPerSession ?? DEFAULT_MAX_DOCUMENTS_PER_SESSION),
      );
      let renderSession: HtmlPdfRenderSession | undefined;
      let renderedDocuments = 0;
      const closeRenderSession = async (): Promise<void> => {
        const current = renderSession;
        renderSession = undefined;
        renderedDocuments = 0;
        await current?.close().catch(() => undefined);
      };
      try {
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
              if (renderSession && renderedDocuments >= maxDocumentsPerSession)
                await closeRenderSession();
              renderSession ??= await createRenderSession();
              const result = await generateDocument(
                {
                  order: item.snapshot as DocumentOrder,
                  format: batch.format,
                  template,
                  orderId: item.orderId,
                  ...(item.documentNumber === null ? {} : { documentNumber: item.documentNumber }),
                  documentKind: batch.legalInvoiceEnabled ? 'invoice' : 'order',
                },
                renderSession.render,
              );
              renderedDocuments += 1;
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
                filename: `${safeOrderName(item, batch.format, batch.createdAt)}.pdf`,
                mimeType: 'application/pdf',
                byteSize: stored.byteSize,
                checksum: stored.checksum,
                snapshotHash: item.snapshotHash,
              });
            }
            void artifact;
            store.completeDocumentBatchItemForWorker(context, batchId, item.position, artifactId);
          } catch (error) {
            const safeError = safeDocumentError(error);
            if (safeError === 'DOCUMENT_RENDERER_UNAVAILABLE') {
              await closeRenderSession();
              throw new Error(safeError);
            }
            store.failDocumentBatchItemForWorker(context, batchId, item.position, safeError);
          }
          batch = store.getDocumentBatchForWorker(context, batchId);
          await execution.reportProgress(progress(batch.processedCount, batch.totalCount, 5, 88));
        }
      } finally {
        await closeRenderSession();
      }

      batch = store.getDocumentBatchForWorker(context, batchId);
      if (batch.processedCount < batch.totalCount)
        throw new Error('DOCUMENT_BATCH_ITEMS_INCOMPLETE');
      const items = store.getDocumentBatchItemsForWorker(context, batchId);
      const successful = items.filter((item) => item.status === 'succeeded' && item.artifactId);
      const failed = items.filter((item) => item.status === 'failed');
      if (successful.length === 0) throw new Error('DOCUMENT_BATCH_ALL_ITEMS_FAILED');
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
        filename: documentArtifactName('manifest', batch.createdAt, batch.format),
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
          filename: documentArtifactName('merged', batch.createdAt, batch.format),
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
        filename: documentArtifactName('zip', batch.createdAt, batch.format),
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
      const rawMessage = error instanceof Error ? error.message : 'DOCUMENT_BATCH_FAILED';
      const message = rawMessage === 'JOB_CANCELLED' ? rawMessage : safeDocumentError(error);
      if (message === 'JOB_CANCELLED') {
        store.cancelDocumentBatchForWorker(context, batchId);
      } else {
        const current = store.getDocumentBatchForWorker(context, batchId);
        const waitingForDurableRetry =
          message === 'DOCUMENT_RENDERER_UNAVAILABLE' && job.attempts < job.maxAttempts;
        if (
          !waitingForDurableRetry &&
          current.status !== 'completed' &&
          current.status !== 'partial'
        )
          store.failDocumentBatchForWorker(context, batchId, message);
      }
      throw new Error(message);
    }
  };
