import {
  InProcessJobRunner,
  type DurableJob,
  type JobExecutionContext,
  type JobRunnerLogger,
} from '@woo-ops/application';
import { validateWooOrder } from '@woo-ops/connectors';
import type { AnalyticsFilter, SqliteStore } from '@woo-ops/persistence';

type WorkerContext = Readonly<{ accountId: string; correlationId: string }>;

export type ApiJobEffect = (job: DurableJob, context: JobExecutionContext) => void | Promise<void>;

export type ApiJobRunnerOptions = Readonly<{
  concurrency?: number;
  leaseSeconds?: number;
  pollIntervalMs?: number;
  effects?: Readonly<{
    sync?: ApiJobEffect;
    export?: ApiJobEffect;
    document?: ApiJobEffect;
    backup?: ApiJobEffect;
  }>;
  logger?: JobRunnerLogger;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error(code);
  return value;
};

const workerContext = (job: DurableJob, context: JobExecutionContext): WorkerContext => ({
  accountId: job.accountId,
  correlationId: context.correlationId,
});

const analyticsFilter = (payload: unknown): AnalyticsFilter => {
  if (!isRecord(payload)) throw new Error('ANALYTICS_JOB_PAYLOAD_INVALID');
  const input: AnalyticsFilter = {};
  const textFields = [
    'from',
    'to',
    'currency',
    'store',
    'status',
    'shippingMethod',
    'product',
    'category',
    'author',
  ] as const;
  for (const field of textFields) {
    const value = payload[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.length > 256)
        throw new Error('ANALYTICS_JOB_PAYLOAD_INVALID');
      input[field] = value;
    }
  }
  if (payload.source !== undefined) {
    if (payload.source !== 'woo' && payload.source !== 'manual' && payload.source !== 'combined')
      throw new Error('ANALYTICS_JOB_PAYLOAD_INVALID');
    input.source = payload.source;
  }
  return input;
};

const requiredEffect = (name: string, effect: ApiJobEffect | undefined): ApiJobEffect =>
  effect ??
  (async () => {
    throw new Error(`${name}_HANDLER_NOT_CONFIGURED`);
  });

export const createApiJobRunner = (
  store: SqliteStore,
  options: ApiJobRunnerOptions = {},
): InProcessJobRunner => {
  const runner = new InProcessJobRunner({
    repository: store,
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.leaseSeconds === undefined ? {} : { leaseSeconds: options.leaseSeconds }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  runner.register('webhook.process', async (job, context) => {
    const payload = job.payload;
    if (!isRecord(payload)) throw new Error('WEBHOOK_JOB_PAYLOAD_INVALID');
    const inboxId = requiredString(payload.inboxId, 'WEBHOOK_JOB_PAYLOAD_INVALID');
    const account = workerContext(job, context);
    const inbox = store.beginWebhookProcessing(account, inboxId);
    if (!inbox) return;
    try {
      const body = JSON.parse(Buffer.from(inbox.rawBody).toString('utf8')) as unknown;
      if (inbox.topic === 'order.deleted') {
        if (!isRecord(body) || !Number.isInteger(body.id) || Number(body.id) < 1)
          throw new Error('WEBHOOK_SCHEMA_DRIFT');
        store.markRemoteOrderDeleted(account, inbox.connectionId, String(body.id));
        store.completeWebhook(account, inbox.id);
        return;
      }
      if (inbox.topic !== 'order.created' && inbox.topic !== 'order.updated')
        throw new Error('WEBHOOK_TOPIC_UNSUPPORTED');
      const validation = validateWooOrder(body);
      if (validation.status !== 'accepted') throw new Error('WEBHOOK_SCHEMA_DRIFT');
      store.upsertRemoteOrder(account, inbox.connectionId, {
        ...validation.value,
        refunds: validation.value.refunds.map((refund) => ({
          externalRefundId: requiredString(refund.externalRefundId, 'WEBHOOK_REFUND_INVALID'),
          amountMinor: requiredString(refund.amountMinor, 'WEBHOOK_REFUND_INVALID'),
          reason: refund.reason ?? null,
        })),
      });
      store.completeWebhook(account, inbox.id);
    } catch (error) {
      store.failWebhook(
        account,
        inbox.id,
        error instanceof Error ? error.message : 'WEBHOOK_PROCESSING_FAILED',
      );
      throw error;
    }
  });

  runner.register('bulk.process', async (job, context) => {
    if (!isRecord(job.payload)) throw new Error('BULK_JOB_PAYLOAD_INVALID');
    const bulkJobId = requiredString(job.payload.bulkJobId, 'BULK_JOB_PAYLOAD_INVALID');
    const account = workerContext(job, context);
    const initial = store.getBulkJobForWorker(account, bulkJobId);
    if (['succeeded', 'partial', 'cancelled', 'failed'].includes(initial.status)) return;
    for (;;) {
      if (await context.isCancellationRequested()) {
        store.cancelBulkJobForWorker(account, bulkJobId);
        return;
      }
      const item = store.claimNextBulkItem(account, bulkJobId);
      if (!item) return;
      try {
        store.applyBulkItem(account, bulkJobId, item.orderId);
        store.completeBulkItem(account, bulkJobId, item.orderId, { success: true });
      } catch (error) {
        store.completeBulkItem(account, bulkJobId, item.orderId, {
          success: false,
          error: error instanceof Error ? error.message : 'BULK_ITEM_FAILED',
        });
      }
      const current = store.getBulkJobForWorker(account, bulkJobId);
      await context.reportProgress(current.progress);
    }
  });

  const syncEffect = requiredEffect('SYNC', options.effects?.sync);
  runner.register('sync.initial', syncEffect);
  runner.register('sync.incremental', syncEffect);
  runner.register('sync.reconcile', syncEffect);

  runner.register('export.generate', requiredEffect('EXPORT', options.effects?.export));
  runner.register('document.generate', requiredEffect('DOCUMENT', options.effects?.document));

  runner.register('analytics.rebuild', async (job, context) => {
    const account = workerContext(job, context);
    const filter = analyticsFilter(job.payload);
    const total = store.getAnalyticsOrderCountForWorker(account, filter);
    await context.reportProgress(0);
    store.rebuildAnalyticsFactsForWorker(account, filter, (processed) => {
      const progress = total === 0 ? 100 : Math.min(99, Math.floor((processed / total) * 100));
      void context.reportProgress(progress);
    });
    await context.reportProgress(100);
  });

  runner.register('field-mapping.backfill', async (job, context) => {
    if (!isRecord(job.payload)) throw new Error('FIELD_MAPPING_JOB_PAYLOAD_INVALID');
    const mappingId = requiredString(job.payload.mappingId, 'FIELD_MAPPING_JOB_PAYLOAD_INVALID');
    const account = workerContext(job, context);
    const total = store.getFieldMappingOrderCountForWorker(account, mappingId);
    let cursor: string | null = null;
    let processed = 0;
    await context.reportProgress(0);
    for (;;) {
      if (await context.isCancellationRequested()) return;
      const page = store.backfillFieldMapping(account, mappingId, cursor, 100);
      processed += page.processed;
      cursor = page.nextCursor;
      await context.reportProgress(
        cursor === null || total === 0 ? 100 : Math.min(99, Math.floor((processed / total) * 100)),
      );
      if (cursor === null) break;
    }
  });

  runner.register('backup.create', requiredEffect('BACKUP', options.effects?.backup));
  runner.register('maintenance', async (_job, context) => {
    await context.reportProgress(0);
    await store.recoverExpiredJobsAny(context.correlationId);
    await context.reportProgress(100);
  });

  return runner;
};
