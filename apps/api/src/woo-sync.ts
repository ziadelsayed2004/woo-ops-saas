import {
  canonicalizeStoreUrl,
  classifyWooError,
  decryptCredentialEnvelope,
  toCatalogItems,
  validateWooOrder,
  WooCommerceConnector,
} from '@woo-ops/connectors';
import type { DurableJob, JobExecutionContext } from '@woo-ops/application';
import type {
  AccountContext,
  ConnectionSummary,
  SqliteStore,
  SyncErrorCategory,
  SyncRunType,
} from '@woo-ops/persistence';

type SyncCursor = Readonly<{
  phase?: 'catalog' | 'orders' | 'complete';
  kind?: 'categories' | 'tags' | 'shipping_classes' | 'products';
  page?: number;
  lastPage?: boolean;
  modifiedAfter?: string | null;
  lastModifiedAt?: string | null;
  reconcileToken?: string;
  startedAt?: string;
}>;
type SyncCatalogKind = NonNullable<SyncCursor['kind']>;

type SyncContext = Readonly<{
  store: SqliteStore;
  job: DurableJob;
  execution: JobExecutionContext;
  account: AccountContext;
  connector: WooCommerceConnector;
  connectionId: string;
  type: SyncRunType;
  overlapSeconds: number;
}>;

export type WooSyncOptions = Readonly<{
  encryptionKey?: string;
  overlapSeconds?: number;
  request?: typeof fetch;
  resolveHost?: (hostname: string) => Promise<readonly { address: string }[]>;
}>;

const CATALOG_KINDS: readonly SyncCatalogKind[] = [
  'categories',
  'tags',
  'shipping_classes',
  'products',
];
const isSyncCatalogKind = (value: unknown): value is SyncCatalogKind =>
  typeof value === 'string' && CATALOG_KINDS.includes(value as SyncCatalogKind);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredString = (value: unknown, code: string): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new Error(code);
  return value;
};

const encodeCursor = (cursor: SyncCursor): string => {
  const value = JSON.stringify(cursor);
  if (value.length > 4_096) throw new Error('SYNC_CURSOR_INVALID');
  return value;
};

const parseCursor = (value: string): SyncCursor => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isRecord(parsed)) throw new Error('SYNC_CURSOR_INVALID');
    const phase = parsed.phase;
    if (phase !== undefined && phase !== 'catalog' && phase !== 'orders' && phase !== 'complete')
      throw new Error('SYNC_CURSOR_INVALID');
    let kind: SyncCatalogKind | undefined;
    if (parsed.kind !== undefined) {
      if (!isSyncCatalogKind(parsed.kind)) throw new Error('SYNC_CURSOR_INVALID');
      kind = parsed.kind;
    }
    const page = parsed.page;
    if (
      page !== undefined &&
      (!Number.isInteger(page) || Number(page) < 1 || Number(page) > 100_000)
    )
      throw new Error('SYNC_CURSOR_INVALID');
    const lastPage = parsed.lastPage;
    if (lastPage !== undefined && typeof lastPage !== 'boolean')
      throw new Error('SYNC_CURSOR_INVALID');
    for (const key of ['modifiedAfter', 'lastModifiedAt', 'reconcileToken', 'startedAt']) {
      const item = parsed[key];
      if (item !== undefined && item !== null && (typeof item !== 'string' || item.length > 256))
        throw new Error('SYNC_CURSOR_INVALID');
    }
    return {
      ...(phase === undefined ? {} : { phase }),
      ...(kind === undefined ? {} : { kind }),
      ...(page === undefined ? {} : { page: Number(page) }),
      ...(lastPage === undefined ? {} : { lastPage }),
      ...(parsed.modifiedAfter === undefined
        ? {}
        : { modifiedAfter: parsed.modifiedAfter as string | null }),
      ...(parsed.lastModifiedAt === undefined
        ? {}
        : { lastModifiedAt: parsed.lastModifiedAt as string | null }),
      ...(parsed.reconcileToken === undefined
        ? {}
        : { reconcileToken: parsed.reconcileToken as string }),
      ...(parsed.startedAt === undefined ? {} : { startedAt: parsed.startedAt as string }),
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'SYNC_CURSOR_INVALID') throw error;
    throw new Error('SYNC_CURSOR_INVALID');
  }
};

const jsonCredentials = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('CREDENTIAL_ENVELOPE_INVALID');
  }
};

const connectionAccount = (job: DurableJob, execution: JobExecutionContext): AccountContext => ({
  accountId: job.accountId,
  correlationId: execution.correlationId,
});

const connectionIdFromJob = (job: DurableJob): string => {
  if (!isRecord(job.payload)) throw new Error('SYNC_JOB_PAYLOAD_INVALID');
  return requiredString(job.payload.connectionId, 'SYNC_JOB_PAYLOAD_INVALID');
};

const connectorFor = (
  store: SqliteStore,
  account: AccountContext,
  connectionId: string,
  options: WooSyncOptions,
): {
  record: ReturnType<SqliteStore['getConnectionForWorker']>;
  connector: WooCommerceConnector;
} => {
  const record = store.getConnectionForWorker(account, connectionId);
  if (record.status === 'disabled') throw new Error('CONNECTION_DISABLED');
  if (!record.encryptedCredentials) throw new Error('CREDENTIALS_NOT_CONFIGURED');
  const encryptionKey = options.encryptionKey ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('CREDENTIAL_ENCRYPTION_UNAVAILABLE');
  const credentials = decryptCredentialEnvelope(
    jsonCredentials(record.encryptedCredentials),
    encryptionKey,
  );
  const storeUrl = canonicalizeStoreUrl(record.storeUrl);
  return {
    record,
    connector: new WooCommerceConnector(
      '',
      storeUrl,
      credentials,
      options.request,
      options.resolveHost,
    ),
  };
};

const maxModified = (current: string | null, value: string | null): string | null => {
  if (!value) return current;
  if (!current) return value;
  return value > current ? value : current;
};

const overlapTimestamp = (value: string | null, seconds: number): string | undefined => {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('SYNC_CURSOR_INVALID');
  return new Date(parsed - seconds * 1000).toISOString();
};

const boundedOverlapSeconds = (value: number | undefined): number => {
  const candidate = value ?? 300;
  if (!Number.isInteger(candidate) || candidate < 0 || candidate > 86_400)
    throw new Error('SYNC_OVERLAP_INVALID');
  return candidate;
};

const updateProgress = async (execution: JobExecutionContext, value: number): Promise<void> => {
  await execution.reportProgress(Math.max(0, Math.min(99, Math.trunc(value))));
};

const syncCatalog = async (context: SyncContext, cursor: SyncCursor): Promise<SyncCursor> => {
  let current = cursor;
  const startKindIndex = current.kind ? Math.max(0, CATALOG_KINDS.indexOf(current.kind)) : 0;
  for (let kindIndex = startKindIndex; kindIndex < CATALOG_KINDS.length; kindIndex += 1) {
    const kind = CATALOG_KINDS[kindIndex];
    if (!kind) continue;
    let pageNumber = current.kind === kind ? (current.page ?? 1) : 1;
    for await (const page of context.connector.pullCatalog(kind, 100, pageNumber)) {
      const items = toCatalogItems(page);
      const isLastPage = page.page >= page.totalPages || page.items.length < 100;
      const nextKind = isLastPage ? CATALOG_KINDS[kindIndex + 1] : kind;
      const nextCursor: SyncCursor = nextKind
        ? { phase: 'catalog', kind: nextKind, page: isLastPage ? 1 : page.page + 1 }
        : { phase: 'orders', page: 1 };
      context.store.upsertCatalogPage(context.account, {
        connectionId: context.connectionId,
        cursor: encodeCursor(nextCursor),
        items,
        pages: page.totalPages,
      });
      context.store.updateSyncRun(context.account, context.job.id, {
        cursor: encodeCursor(nextCursor),
        pages: 1,
        catalogItems: items.length,
      });
      current = nextCursor;
      await updateProgress(context.execution, ((kindIndex * 100 + page.page) / 500) * 40);
      pageNumber = page.page + 1;
    }
    context.store.completeCatalogSync(context.account, context.connectionId, true);
    current = current.phase === 'orders' ? current : { phase: 'orders', page: 1 };
  }
  return current;
};

const syncOrders = async (context: SyncContext, cursor: SyncCursor): Promise<SyncCursor> => {
  const reconcile = context.type === 'reconcile';
  const incremental = context.type === 'incremental';
  const startedAt = cursor.startedAt ?? new Date().toISOString();
  const reconcileToken = reconcile
    ? (cursor.reconcileToken ?? `reconcile:${context.job.id}`)
    : undefined;
  const modifiedAfter = incremental
    ? (cursor.modifiedAfter ??
      overlapTimestamp(cursor.lastModifiedAt ?? null, context.overlapSeconds))
    : undefined;
  let pageNumber = cursor.phase === 'orders' ? (cursor.page ?? 1) : 1;
  let lastModified = cursor.lastModifiedAt ?? null;
  let totalDeleted = 0;
  if (!cursor.lastPage) {
    for await (const remotePage of context.connector.pullOrderPages('orders', 100, pageNumber, {
      ...(modifiedAfter === undefined ? {} : { modifiedAfter }),
      orderby: 'modified',
      order: 'asc',
    })) {
      for (const raw of remotePage.items) {
        const validation = validateWooOrder(raw);
        if (validation.status !== 'accepted') throw new Error('WOO_SCHEMA_DRIFT');
        const normalized = validation.value;
        context.store.upsertRemoteOrder(context.account, context.connectionId, {
          ...normalized,
          refunds: normalized.refunds.map((refund) => ({
            externalRefundId: requiredString(refund.externalRefundId, 'WOO_REFUND_INVALID'),
            amountMinor: requiredString(refund.amountMinor, 'WOO_REFUND_INVALID'),
            reason: refund.reason ?? null,
          })),
          ...(reconcileToken === undefined ? {} : { reconcileToken }),
        });
        lastModified = maxModified(lastModified, normalized.modifiedAt);
      }
      const isLastPage = remotePage.page >= remotePage.totalPages || remotePage.items.length === 0;
      const nextCursor: SyncCursor = {
        phase: 'orders',
        page: remotePage.page + 1,
        ...(isLastPage ? { lastPage: true } : {}),
        ...(modifiedAfter === undefined ? {} : { modifiedAfter }),
        ...(lastModified === null ? {} : { lastModifiedAt: lastModified }),
        ...(reconcileToken === undefined ? {} : { reconcileToken, startedAt }),
      };
      context.store.updateSyncRun(context.account, context.job.id, {
        cursor: encodeCursor(nextCursor),
        pages: 1,
        items: remotePage.items.length,
      });
      await updateProgress(
        context.execution,
        40 + Math.min(55, Math.round((remotePage.page / Math.max(remotePage.totalPages, 1)) * 55)),
      );
      if (isLastPage) break;
      pageNumber = remotePage.page + 1;
    }
  }
  if (reconcileToken !== undefined) {
    totalDeleted = context.store.markRemoteOrdersNotSeen(
      context.account,
      context.connectionId,
      reconcileToken,
      startedAt,
    );
  }
  const completeCursor: SyncCursor = {
    phase: 'complete',
    ...(modifiedAfter === undefined ? {} : { modifiedAfter }),
    ...(lastModified === null ? {} : { lastModifiedAt: lastModified }),
    ...(reconcileToken === undefined ? {} : { reconcileToken, startedAt }),
  };
  context.store.completeSyncRun(context.account, context.job.id, {
    cursor: encodeCursor(completeCursor),
    deleted: totalDeleted,
  });
  context.store.enqueueJob(context.account, {
    id: `analytics-${context.job.id}`,
    type: 'analytics.rebuild',
    idempotencyKey: `analytics-after-sync:${context.job.id}`,
    payload: {},
    maxAttempts: 3,
  });
  await context.execution.reportProgress(100);
  return completeCursor;
};

const syncType = (jobType: string): SyncRunType => {
  if (jobType === 'sync.initial') return 'initial';
  if (jobType === 'sync.incremental') return 'incremental';
  if (jobType === 'sync.reconcile') return 'reconcile';
  throw new Error('SYNC_JOB_TYPE_INVALID');
};

export const createWooSyncEffect =
  (store: SqliteStore, options: WooSyncOptions = {}) =>
  async (job: DurableJob, execution: JobExecutionContext): Promise<void> => {
    const type = syncType(job.type);
    const connectionId = connectionIdFromJob(job);
    const account = connectionAccount(job, execution);
    const run = store.beginSyncRun(account, { id: job.id, connectionId, type });
    if (run.status === 'succeeded') return;
    const initialCursor = parseCursor(run.cursor);
    let syncContext: SyncContext | undefined;
    try {
      const resolved = connectorFor(store, account, connectionId, options);
      syncContext = {
        store,
        job,
        execution,
        account,
        connector: resolved.connector,
        connectionId,
        type,
        overlapSeconds: boundedOverlapSeconds(options.overlapSeconds),
      };
      let cursor = initialCursor;
      if (type !== 'initial' && cursor.phase === 'complete') {
        cursor = {
          phase: 'orders',
          page: 1,
          ...(type === 'incremental' && cursor.lastModifiedAt === undefined
            ? {}
            : { lastModifiedAt: cursor.lastModifiedAt ?? null }),
        };
      }
      if (type === 'initial' && cursor.phase !== 'orders' && cursor.phase !== 'complete')
        cursor = await syncCatalog(syncContext, cursor);
      if (type === 'initial') {
        try {
          const shippingRates = await syncContext.connector.readEgyptShippingRates();
          store.replaceWooShippingRates(account, connectionId, shippingRates);
        } catch {
          // Shipping zones are optional for read-only keys and must never block catalog/orders.
          // Keep the last successful snapshot on permission, plugin, or transient failures.
        }
      }
      if (cursor.phase !== 'complete') await syncOrders(syncContext, cursor);
    } catch (error) {
      const category = classifyWooError(error) as SyncErrorCategory;
      try {
        store.failSyncRun(account, job.id, {
          errorCode: error instanceof Error ? error.message : 'SYNC_FAILED',
          errorCategory: category,
          retryAfterAt: category === 'rate' ? new Date(Date.now() + 60_000).toISOString() : null,
        });
      } catch {
        // Preserve the original handler failure; the durable job failure path remains authoritative.
      }
      throw error;
    }
  };

export const healthCheckWooConnection = async (
  store: SqliteStore,
  context: AccountContext,
  connectionId: string,
  options: WooSyncOptions = {},
): Promise<ConnectionSummary> => {
  try {
    const resolved = connectorFor(store, context, connectionId, options);
    const health = await resolved.connector.healthCheck();
    return store.recordConnectionHealth(context, connectionId, {
      status: health.status,
      platformVersion: health.platformVersion,
      wordpressVersion: health.wordpressVersion,
      capabilities: health.capabilities,
      errorCategory: health.errorCategory as SyncErrorCategory | null,
    });
  } catch (error) {
    const category = classifyWooError(error) as SyncErrorCategory;
    store.recordConnectionHealth(context, connectionId, {
      status: 'degraded',
      capabilities: {},
      errorCategory: category,
      error: error instanceof Error ? error.message : 'CONNECTION_HEALTH_CHECK_FAILED',
    });
    throw error;
  }
};
