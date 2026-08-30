import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';

type AccountContext = Readonly<{ accountId: string; actorId?: string; correlationId: string }>;
type DurableJob = {
  id: string;
  type: string;
  idempotencyKey: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';
  attempts: number;
};
export type CatalogItem = {
  identity: string;
  kind: 'product' | 'variation' | 'category' | 'tag' | 'shipping_class';
  externalId: string;
  parentExternalId: string | null;
  name: string;
  sku: string | null;
  sourceJson: string;
};
export type NormalizedOrderInput = {
  externalOrderId: string;
  orderNumber: string;
  remoteStatus: string;
  currency: string;
  grandTotalMinor: string;
  createdAt: string | null;
  modifiedAt: string | null;
  customer: unknown;
  billing: unknown;
  shipping: unknown;
  lines: readonly unknown[];
  refunds: readonly { externalRefundId: string; amountMinor: string; reason: unknown }[];
  sourceJson: string;
  sourceHash: string;
};
export type OrderFilter =
  | { op: 'and' | 'or'; children: readonly OrderFilter[] }
  | { field: OrderFilterField; operator: string; value?: unknown };
export type OrderFilterField =
  | 'orderNumber'
  | 'externalOrderId'
  | 'remoteStatus'
  | 'localStatus'
  | 'exportState'
  | 'origin'
  | 'currency'
  | 'connectionId'
  | 'remoteCreatedAt'
  | 'grandTotalMinor';
export type OrderQueryInput = {
  search?: string;
  filter?: OrderFilter;
  cursor?: string | null;
  limit?: number;
  sort?: {
    field: 'remoteCreatedAt' | 'updatedAt' | 'orderNumber' | 'grandTotalMinor' | 'id';
    direction: 'asc' | 'desc';
  };
};
export type OrderQueryResult = {
  items: readonly Record<string, unknown>[];
  nextCursor: string | null;
  hasMore: boolean;
};

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 8) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).every((item) =>
      isJsonValue(item, depth + 1),
    );
  }
  return false;
};

const serializeJobPayload = (payload: unknown): string => {
  if (!isJsonValue(payload)) throw new Error('JOB_PAYLOAD_INVALID');
  const serialized = JSON.stringify(payload);
  if (serialized.length > 64 * 1024) throw new Error('JOB_PAYLOAD_TOO_LARGE');
  return serialized;
};

const requireHash = (value: string): string => createHash('sha256').update(value).digest('hex');

const filterColumns: Record<OrderFilterField, string> = {
  orderNumber: 'o.order_number',
  externalOrderId: 'o.external_order_id',
  remoteStatus: 'o.remote_status',
  localStatus: 'o.local_status',
  exportState: 'o.export_state',
  origin: 'o.origin',
  currency: 'o.currency',
  connectionId: 'o.connection_id',
  remoteCreatedAt: 'o.remote_modified_at',
  grandTotalMinor: 'o.grand_total_minor',
};
const allowedOperators: Record<OrderFilterField, readonly string[]> = {
  orderNumber: [
    'equals',
    'not-equals',
    'contains',
    'starts-with',
    'is-empty',
    'is-not-empty',
    'in',
  ],
  externalOrderId: [
    'equals',
    'not-equals',
    'contains',
    'starts-with',
    'is-empty',
    'is-not-empty',
    'in',
  ],
  remoteStatus: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  localStatus: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  exportState: ['equals', 'not-equals', 'is-any-of', 'is-empty', 'is-not-empty'],
  origin: ['equals', 'is-any-of'],
  currency: ['equals', 'is-any-of'],
  connectionId: ['equals', 'is-any-of'],
  remoteCreatedAt: [
    'equals',
    'greater-than',
    'greater-or-equal',
    'less-than',
    'less-or-equal',
    'between',
    'is-empty',
    'is-not-empty',
  ],
  grandTotalMinor: [
    'equals',
    'greater-than',
    'greater-or-equal',
    'less-than',
    'less-or-equal',
    'between',
  ],
};
const encodedCursor = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const decodedCursor = (value: string): { sortValue: string; id: string } => {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (typeof parsed.sortValue !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return { sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw new Error('ORDER_CURSOR_INVALID');
  }
};

const compileFilter = (filter: OrderFilter): { sql: string; params: (string | number)[] } => {
  if (!filter || typeof filter !== 'object') throw new Error('ORDER_FILTER_INVALID');
  if ('op' in filter) {
    if (filter.children.length === 0) throw new Error('ORDER_FILTER_EMPTY_GROUP');
    const children = filter.children.map(compileFilter);
    return {
      sql: `(${children.map((child) => child.sql).join(` ${filter.op.toUpperCase()} `)})`,
      params: children.flatMap((child) => child.params),
    };
  }
  if (
    !Object.hasOwn(filterColumns, filter.field) ||
    !allowedOperators[filter.field].includes(filter.operator)
  ) {
    throw new Error('ORDER_FILTER_NOT_ALLOWED');
  }
  const column = filterColumns[filter.field];
  const operator = filter.operator;
  if (operator === 'is-empty') return { sql: `(${column} IS NULL OR ${column} = '')`, params: [] };
  if (operator === 'is-not-empty')
    return { sql: `(${column} IS NOT NULL AND ${column} <> '')`, params: [] };
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (operator === 'in' || operator === 'is-any-of') {
    if (
      values.length === 0 ||
      values.some((value) => typeof value !== 'string' && typeof value !== 'number')
    )
      throw new Error('ORDER_FILTER_VALUE_INVALID');
    return {
      sql: `${column} IN (${values.map(() => '?').join(',')})`,
      params: values as (string | number)[],
    };
  }
  if (operator === 'between') {
    if (
      values.length !== 2 ||
      values.some((value) => typeof value !== 'string' && typeof value !== 'number')
    )
      throw new Error('ORDER_FILTER_VALUE_INVALID');
    return { sql: `${column} BETWEEN ? AND ?`, params: values as (string | number)[] };
  }
  if (typeof filter.value !== 'string' && typeof filter.value !== 'number')
    throw new Error('ORDER_FILTER_VALUE_INVALID');
  if (operator === 'contains' || operator === 'starts-with') {
    const value = String(filter.value);
    return {
      sql: `${column} LIKE ?`,
      params: [operator === 'contains' ? `%${value}%` : `${value}%`],
    };
  }
  const operators: Record<string, string> = {
    equals: '=',
    'not-equals': '<>',
    'greater-than': '>',
    'greater-or-equal': '>=',
    'less-than': '<',
    'less-or-equal': '<=',
  };
  const sqlOperator = operators[operator];
  if (!sqlOperator) throw new Error('ORDER_FILTER_NOT_ALLOWED');
  return { sql: `${column} ${sqlOperator} ?`, params: [filter.value] };
};

export const schemaVersion = 7;

type Migration = { version: number; name: string; sql: string };
const migrations: readonly Migration[] = [
  {
    version: 1,
    name: 'core-account-and-jobs',
    sql: `
      CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL,
        locale TEXT NOT NULL DEFAULT 'ar-EG', direction TEXT NOT NULL DEFAULT 'rtl'
          CHECK (direction IN ('rtl', 'ltr')), timezone TEXT NOT NULL DEFAULT 'Africa/Cairo',
        base_currency TEXT NOT NULL DEFAULT 'EGP', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE account_memberships (account_id TEXT NOT NULL REFERENCES accounts(id),
        user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL
          CHECK (role IN ('owner', 'admin', 'operator', 'viewer')), created_at TEXT NOT NULL,
        PRIMARY KEY (account_id, user_id));
      CREATE TABLE jobs (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        type TEXT NOT NULL, idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'dead-lettered')),
        attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, type, idempotency_key));
      CREATE INDEX jobs_account_status_created ON jobs(account_id, status, created_at);
    `,
  },
  {
    version: 2,
    name: 'operational-order-foundation',
    sql: `
      CREATE TABLE connections (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        platform TEXT NOT NULL, store_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
        encrypted_credentials TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, platform, store_url));
      CREATE TABLE orders (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        connection_id TEXT REFERENCES connections(id), origin TEXT NOT NULL CHECK (origin IN ('woo', 'manual')),
        order_number TEXT NOT NULL, external_order_id TEXT, remote_status TEXT,
        local_status TEXT NOT NULL DEFAULT 'new', export_state TEXT NOT NULL DEFAULT 'never-exported',
        currency TEXT NOT NULL, grand_total_minor TEXT NOT NULL, source_hash TEXT,
        remote_modified_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, order_number), UNIQUE (account_id, connection_id, external_order_id));
      CREATE INDEX orders_account_remote_modified ON orders(account_id, remote_modified_at, id);
      CREATE INDEX orders_account_local_export ON orders(account_id, local_status, export_state);
      CREATE TABLE audit_events (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
        actor_id TEXT, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT,
        summary_json TEXT NOT NULL, correlation_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX audit_account_created ON audit_events(account_id, created_at, id);
    `,
  },
  {
    version: 3,
    name: 'secure-sessions',
    sql: `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT NOT NULL REFERENCES accounts(id),
        token_hash TEXT NOT NULL UNIQUE, csrf_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE INDEX sessions_user_active ON sessions(user_id, revoked_at, expires_at);
      CREATE INDEX sessions_account_active ON sessions(account_id, revoked_at, expires_at);
    `,
  },
  {
    version: 4,
    name: 'woocommerce-authorization-states',
    sql: `CREATE TABLE authorization_states (
      state_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), user_id TEXT NOT NULL REFERENCES users(id),
      store_url TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    ); CREATE INDEX authorization_states_expiry ON authorization_states(expires_at, used_at);`,
  },
  {
    version: 5,
    name: 'durable-job-and-webhook-state',
    sql: `
      ALTER TABLE jobs ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
      ALTER TABLE jobs ADD COLUMN available_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE jobs ADD COLUMN lease_until TEXT;
      ALTER TABLE jobs ADD COLUMN last_error TEXT;
      ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE jobs ADD COLUMN progress INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX jobs_claimable ON jobs(account_id, status, available_at, created_at);
      CREATE TABLE webhook_inbox (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        delivery_key TEXT NOT NULL, topic TEXT NOT NULL, body_checksum TEXT NOT NULL, raw_body BLOB NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('accepted', 'processing', 'processed', 'failed', 'dead-lettered')),
        attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, received_at TEXT NOT NULL, processed_at TEXT,
        UNIQUE (account_id, connection_id, delivery_key)
      );
      CREATE INDEX webhook_inbox_account_status ON webhook_inbox(account_id, status, received_at);
    `,
  },
  {
    version: 6,
    name: 'catalog-sync-state',
    sql: `
      ALTER TABLE connections ADD COLUMN catalog_cursor TEXT;
      ALTER TABLE connections ADD COLUMN catalog_status TEXT NOT NULL DEFAULT 'idle';
      ALTER TABLE connections ADD COLUMN catalog_last_error TEXT;
      ALTER TABLE connections ADD COLUMN catalog_last_success TEXT;
      ALTER TABLE connections ADD COLUMN catalog_deleted_count INTEGER NOT NULL DEFAULT 0;
      CREATE TABLE catalog_items (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        kind TEXT NOT NULL CHECK (kind IN ('product', 'variation', 'category', 'tag', 'shipping_class')),
        external_id TEXT NOT NULL, parent_external_id TEXT, name TEXT NOT NULL, sku TEXT,
        source_json TEXT NOT NULL, source_hash TEXT NOT NULL, remote_modified_at TEXT,
        remote_deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (account_id, connection_id, kind, external_id)
      );
      CREATE INDEX catalog_items_account_connection ON catalog_items(account_id, connection_id, kind, remote_deleted_at);
      CREATE TABLE catalog_sync_runs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        cursor TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
        pages INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
        error_code TEXT, started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE INDEX catalog_sync_runs_account ON catalog_sync_runs(account_id, connection_id, started_at);
    `,
  },
  {
    version: 7,
    name: 'normalized-order-sync',
    sql: `
      ALTER TABLE orders ADD COLUMN remote_payload_json TEXT;
      ALTER TABLE orders ADD COLUMN normalized_json TEXT;
      ALTER TABLE orders ADD COLUMN remote_deleted_at TEXT;
      ALTER TABLE orders ADD COLUMN stale_export_at TEXT;
      CREATE TABLE order_refunds (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), order_id TEXT NOT NULL REFERENCES orders(id),
        external_refund_id TEXT NOT NULL, amount_minor TEXT NOT NULL, reason TEXT, source_json TEXT NOT NULL,
        created_at TEXT NOT NULL, UNIQUE(account_id, order_id, external_refund_id)
      );
      CREATE INDEX order_refunds_account_order ON order_refunds(account_id, order_id);
      CREATE TABLE order_sync_runs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), connection_id TEXT NOT NULL REFERENCES connections(id),
        cursor TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
        pages INTEGER NOT NULL DEFAULT 0, items INTEGER NOT NULL DEFAULT 0, error_code TEXT,
        started_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE INDEX order_sync_runs_account ON order_sync_runs(account_id, connection_id, started_at);
    `,
  },
];

export class SqliteStore {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
    );
    this.applyMigrations();
  }

  queryOrders(context: AccountContext, input: OrderQueryInput = {}): OrderQueryResult {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('ORDER_LIMIT_INVALID');
    const sort = input.sort ?? { field: 'remoteCreatedAt' as const, direction: 'desc' as const };
    const sortColumns = {
      remoteCreatedAt: 'o.remote_modified_at',
      updatedAt: 'o.updated_at',
      orderNumber: 'o.order_number',
      grandTotalMinor: 'o.grand_total_minor',
      id: 'o.id',
    } as const;
    const sortColumn = sortColumns[sort.field];
    if (!sortColumn || !['asc', 'desc'].includes(sort.direction))
      throw new Error('ORDER_SORT_NOT_ALLOWED');
    const clauses = ['o.account_id = ?'];
    const params: (string | number)[] = [context.accountId];
    if (input.search !== undefined) {
      if (typeof input.search !== 'string' || input.search.length > 200)
        throw new Error('ORDER_SEARCH_INVALID');
      clauses.push(
        `(o.order_number LIKE ? OR o.external_order_id LIKE ? OR o.remote_status LIKE ? OR o.local_status LIKE ? OR o.currency LIKE ? OR o.normalized_json LIKE ?)`,
      );
      const search = `%${input.search}%`;
      params.push(search, search, search, search, search, search);
    }
    if (input.filter) {
      const compiled = compileFilter(input.filter);
      clauses.push(compiled.sql);
      params.push(...compiled.params);
    }
    if (input.cursor) {
      const cursor = decodedCursor(input.cursor);
      const comparison = sort.direction === 'desc' ? '<' : '>';
      clauses.push(
        `(COALESCE(${sortColumn}, '') ${comparison} ? OR (COALESCE(${sortColumn}, '') = ? AND o.id ${comparison} ?))`,
      );
      params.push(cursor.sortValue, cursor.sortValue, cursor.id);
    }
    const rows = this.db
      .prepare(
        `SELECT o.id, o.order_number, o.external_order_id, o.origin, o.connection_id, o.remote_status, o.local_status, o.export_state, o.currency, o.grand_total_minor, o.remote_modified_at, o.updated_at, o.normalized_json, COALESCE(${sortColumn}, '') AS sort_value FROM orders o WHERE ${clauses.join(' AND ')} ORDER BY COALESCE(${sortColumn}, '') ${sort.direction}, o.id ${sort.direction} LIMIT ?`,
      )
      .all(...params, limit + 1) as Array<Record<string, unknown>>;
    const hasMore = rows.length > limit;
    const visible = rows.slice(0, limit);
    const items = visible.map((row) => {
      let normalized: Record<string, unknown> = {};
      if (typeof row.normalized_json === 'string') {
        try {
          normalized = JSON.parse(row.normalized_json) as Record<string, unknown>;
        } catch {
          normalized = {};
        }
      }
      return {
        ...normalized,
        id: row.id,
        orderNumber: row.order_number,
        externalOrderId: row.external_order_id,
        origin: row.origin,
        connectionId: row.connection_id,
        remoteStatus: row.remote_status,
        localStatus: row.local_status,
        exportState: row.export_state,
        currency: row.currency,
        grandTotalMinor: row.grand_total_minor,
        remoteCreatedAt: row.remote_modified_at,
        updatedAt: row.updated_at,
      };
    });
    const last = visible.at(-1);
    return {
      items,
      hasMore,
      nextCursor:
        hasMore && last
          ? encodedCursor({ sortValue: String(last.sort_value ?? ''), id: String(last.id) })
          : null,
    };
  }

  getOrder(context: AccountContext, orderId: string): Record<string, unknown> | null {
    if (!orderId || orderId.length > 200) return null;
    const row = this.db
      .prepare(
        `SELECT o.id, o.order_number, o.external_order_id, o.origin, o.connection_id,
          o.remote_status, o.local_status, o.export_state, o.currency, o.grand_total_minor,
          o.remote_modified_at, o.remote_deleted_at, o.stale_export_at, o.updated_at,
          o.normalized_json
         FROM orders o WHERE o.account_id = ? AND o.id = ?`,
      )
      .get(context.accountId, orderId) as Record<string, unknown> | undefined;
    if (!row) return null;

    let normalized: Record<string, unknown> = {};
    if (typeof row.normalized_json === 'string') {
      try {
        normalized = JSON.parse(row.normalized_json) as Record<string, unknown>;
      } catch {
        normalized = {};
      }
    }
    const refunds = this.db
      .prepare(
        `SELECT external_refund_id AS externalRefundId, amount_minor AS amountMinor,
          reason, source_json AS sourceJson, created_at AS createdAt
         FROM order_refunds WHERE account_id = ? AND order_id = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(context.accountId, orderId) as Array<Record<string, unknown>>;

    return {
      ...normalized,
      id: row.id,
      orderNumber: row.order_number,
      externalOrderId: row.external_order_id,
      origin: row.origin,
      connectionId: row.connection_id,
      remoteStatus: row.remote_status,
      localStatus: row.local_status,
      exportState: row.export_state,
      currency: row.currency,
      grandTotalMinor: row.grand_total_minor,
      remoteCreatedAt: row.remote_modified_at,
      remoteDeletedAt: row.remote_deleted_at,
      staleExportAt: row.stale_export_at,
      updatedAt: row.updated_at,
      refunds: refunds.length > 0 ? refunds : normalized.refunds,
    };
  }

  private applyMigrations(): void {
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map(
        (row) => row.version,
      ),
    );
    this.db.transaction(() => {
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        this.db.exec(migration.sql);
        this.db
          .prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.version, migration.name, new Date().toISOString());
      }
    })();
  }

  complete(context: AccountContext, id: string): Promise<void> {
    this.db
      .prepare(
        "UPDATE jobs SET status = 'succeeded', updated_at = ? WHERE account_id = ? AND id = ?",
      )
      .run(new Date().toISOString(), context.accountId, id);
    return Promise.resolve();
  }

  enqueueJob(
    context: AccountContext,
    input: {
      id: string;
      type: string;
      idempotencyKey: string;
      payload: unknown;
      maxAttempts?: number;
    },
  ): DurableJob {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO jobs (id, account_id, type, idempotency_key, status, attempts, created_at, updated_at, payload_json, max_attempts, available_at)
      VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?) ON CONFLICT(account_id, type, idempotency_key) DO NOTHING`,
      )
      .run(
        input.id,
        context.accountId,
        input.type,
        input.idempotencyKey,
        now,
        now,
        serializeJobPayload(input.payload),
        input.maxAttempts ?? 3,
        now,
      );
    const row = this.db
      .prepare(
        'SELECT id, type, idempotency_key, status, attempts FROM jobs WHERE account_id = ? AND type = ? AND idempotency_key = ?',
      )
      .get(context.accountId, input.type, input.idempotencyKey) as {
      id: string;
      type: string;
      idempotency_key: string;
      status: DurableJob['status'];
      attempts: number;
    };
    return {
      id: row.id,
      type: row.type,
      idempotencyKey: row.idempotency_key,
      status: row.status,
      attempts: row.attempts,
    };
  }

  claimNext(context: AccountContext, leaseSeconds = 60): DurableJob | null {
    const now = new Date();
    const nowIso = now.toISOString();
    const id = this.db.transaction(() => {
      const candidate = this.db
        .prepare(
          `SELECT id FROM jobs WHERE account_id = ? AND status = 'queued' AND available_at <= ? AND cancel_requested = 0 ORDER BY created_at LIMIT 1`,
        )
        .get(context.accountId, nowIso) as { id: string } | undefined;
      if (!candidate) return null;
      const result = this.db
        .prepare(
          `UPDATE jobs SET status = 'running', attempts = attempts + 1, lease_until = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'queued'`,
        )
        .run(
          new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
          nowIso,
          context.accountId,
          candidate.id,
        );
      return result.changes === 1 ? candidate.id : null;
    })();
    if (!id) return null;
    const job = this.db
      .prepare(
        'SELECT id, type, idempotency_key, status, attempts FROM jobs WHERE account_id = ? AND id = ?',
      )
      .get(context.accountId, id) as {
      id: string;
      type: string;
      idempotency_key: string;
      status: DurableJob['status'];
      attempts: number;
    };
    return {
      id: job.id,
      type: job.type,
      idempotencyKey: job.idempotency_key,
      status: job.status,
      attempts: job.attempts,
    };
  }

  recoverExpiredJobs(context: AccountContext): number {
    const now = new Date().toISOString();
    return this.db
      .prepare(
        `UPDATE jobs SET status = CASE WHEN cancel_requested = 1 THEN 'failed' ELSE 'queued' END, lease_until = NULL, available_at = ?, updated_at = ? WHERE account_id = ? AND status = 'running' AND lease_until <= ?`,
      )
      .run(now, now, context.accountId, now).changes;
  }

  updateJobProgress(context: AccountContext, id: string, progress: number): void {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new Error('JOB_PROGRESS_INVALID');
    }
    this.db
      .prepare(
        `UPDATE jobs SET progress = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running'`,
      )
      .run(progress, new Date().toISOString(), context.accountId, id);
  }

  upsertCatalogPage(
    context: AccountContext,
    input: {
      connectionId: string;
      cursor: string;
      items: readonly CatalogItem[];
      pages: number;
    },
  ): { insertedOrUpdated: number } {
    const now = new Date().toISOString();
    const statement = this.db.prepare(
      `INSERT INTO catalog_items (id, account_id, connection_id, kind, external_id, parent_external_id, name, sku, source_json, source_hash, remote_modified_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, connection_id, kind, external_id) DO UPDATE SET parent_external_id = excluded.parent_external_id, name = excluded.name, sku = excluded.sku, source_json = excluded.source_json, source_hash = excluded.source_hash, remote_modified_at = excluded.remote_modified_at, remote_deleted_at = NULL, updated_at = excluded.updated_at`,
    );
    const run = this.db.transaction(() => {
      let count = 0;
      for (const item of input.items) {
        if (item.sourceJson.length > 256 * 1024) throw new Error('CATALOG_SOURCE_TOO_LARGE');
        statement.run(
          `${context.accountId}:${input.connectionId}:${item.identity}`,
          context.accountId,
          input.connectionId,
          item.kind,
          item.externalId,
          item.parentExternalId,
          item.name,
          item.sku,
          item.sourceJson,
          requireHash(item.sourceJson),
          null,
          now,
          now,
        );
        count += 1;
      }
      this.db
        .prepare(
          `UPDATE connections SET catalog_cursor = ?, catalog_status = 'running', catalog_last_error = NULL, updated_at = ? WHERE id = ? AND account_id = ?`,
        )
        .run(input.cursor, now, input.connectionId, context.accountId);
      return count;
    })();
    return { insertedOrUpdated: run };
  }

  markCatalogDeleted(
    context: AccountContext,
    connectionId: string,
    identities: readonly string[],
  ): number {
    if (identities.length === 0) return 0;
    const now = new Date().toISOString();
    const placeholders = identities.map(() => '?').join(',');
    const result = this.db
      .prepare(
        `UPDATE catalog_items SET remote_deleted_at = ?, updated_at = ? WHERE account_id = ? AND connection_id = ? AND id IN (${placeholders}) AND remote_deleted_at IS NULL`,
      )
      .run(now, now, context.accountId, connectionId, ...identities);
    this.db
      .prepare(
        `UPDATE connections SET catalog_deleted_count = catalog_deleted_count + ?, updated_at = ? WHERE id = ? AND account_id = ?`,
      )
      .run(result.changes, now, connectionId, context.accountId);
    return result.changes;
  }

  completeCatalogSync(
    context: AccountContext,
    connectionId: string,
    success: boolean,
    errorCode?: string,
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE connections SET catalog_status = ?, catalog_last_error = ?, catalog_last_success = CASE WHEN ? = 'succeeded' THEN ? ELSE catalog_last_success END, updated_at = ? WHERE id = ? AND account_id = ?`,
      )
      .run(
        success ? 'idle' : 'failed',
        errorCode ?? null,
        success ? 'succeeded' : 'failed',
        now,
        now,
        connectionId,
        context.accountId,
      );
  }

  upsertRemoteOrder(
    context: AccountContext,
    connectionId: string,
    input: NormalizedOrderInput,
  ): string {
    const now = new Date().toISOString();
    const id = `${context.accountId}:${connectionId}:order:${input.externalOrderId}`;
    const existing = this.db
      .prepare(
        'SELECT source_hash, export_state FROM orders WHERE account_id = ? AND connection_id = ? AND external_order_id = ?',
      )
      .get(context.accountId, connectionId, input.externalOrderId) as
      { source_hash: string | null; export_state: string } | undefined;
    const stale = Boolean(
      existing?.source_hash &&
      existing.source_hash !== input.sourceHash &&
      existing.export_state !== 'never-exported',
    );
    this.db
      .prepare(
        `INSERT INTO orders (id, account_id, connection_id, origin, order_number, external_order_id, remote_status, currency, grand_total_minor, source_hash, remote_modified_at, remote_payload_json, normalized_json, stale_export_at, created_at, updated_at)
         VALUES (?, ?, ?, 'woo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, connection_id, external_order_id) DO UPDATE SET order_number = excluded.order_number, remote_status = excluded.remote_status, currency = excluded.currency, grand_total_minor = excluded.grand_total_minor, source_hash = excluded.source_hash, remote_modified_at = excluded.remote_modified_at, remote_payload_json = excluded.remote_payload_json, normalized_json = excluded.normalized_json, stale_export_at = CASE WHEN excluded.stale_export_at IS NOT NULL THEN excluded.stale_export_at ELSE orders.stale_export_at END, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        context.accountId,
        connectionId,
        input.orderNumber,
        input.externalOrderId,
        input.remoteStatus,
        input.currency,
        input.grandTotalMinor,
        input.sourceHash,
        input.modifiedAt,
        input.sourceJson,
        JSON.stringify(input),
        stale ? now : null,
        now,
        now,
      );
    for (const refund of input.refunds) {
      this.db
        .prepare(
          `INSERT INTO order_refunds (id, account_id, order_id, external_refund_id, amount_minor, reason, source_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(account_id, order_id, external_refund_id) DO UPDATE SET amount_minor = excluded.amount_minor, reason = excluded.reason, source_json = excluded.source_json`,
        )
        .run(
          `${id}:refund:${refund.externalRefundId}`,
          context.accountId,
          id,
          refund.externalRefundId,
          refund.amountMinor,
          typeof refund.reason === 'string' ? refund.reason : null,
          JSON.stringify(refund),
          now,
        );
    }
    return id;
  }

  markRemoteOrderDeleted(
    context: AccountContext,
    connectionId: string,
    externalOrderId: string,
  ): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE orders SET remote_deleted_at = ?, updated_at = ? WHERE account_id = ? AND connection_id = ? AND external_order_id = ? AND remote_deleted_at IS NULL',
      )
      .run(now, now, context.accountId, connectionId, externalOrderId);
    return result.changes === 1;
  }

  failJob(context: AccountContext, id: string, error: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE jobs SET status = CASE WHEN attempts >= max_attempts THEN 'dead-lettered' ELSE 'queued' END, available_at = CASE WHEN attempts >= max_attempts THEN available_at ELSE ? END, lease_until = NULL, last_error = ?, updated_at = ? WHERE account_id = ? AND id = ? AND status = 'running'`,
      )
      .run(
        new Date(Date.now() + 2000).toISOString(),
        error.slice(0, 500),
        now,
        context.accountId,
        id,
      );
  }

  cancelJob(context: AccountContext, id: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET cancel_requested = 1, status = CASE WHEN status = 'queued' THEN 'failed' ELSE status END, updated_at = ? WHERE account_id = ? AND id = ? AND status IN ('queued', 'running')`,
      )
      .run(new Date().toISOString(), context.accountId, id);
  }

  acceptWebhook(input: {
    id: string;
    accountId: string;
    connectionId: string;
    deliveryKey: string;
    topic: string;
    body: Uint8Array;
    checksum: string;
  }): { accepted: boolean; inboxId: string } {
    const result = this.db
      .prepare(
        `INSERT INTO webhook_inbox (id, account_id, connection_id, delivery_key, topic, body_checksum, raw_body, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?) ON CONFLICT(account_id, connection_id, delivery_key) DO NOTHING`,
      )
      .run(
        input.id,
        input.accountId,
        input.connectionId,
        input.deliveryKey,
        input.topic,
        input.checksum,
        Buffer.from(input.body),
        new Date().toISOString(),
      );
    if (result.changes === 1) return { accepted: true, inboxId: input.id };
    const existing = this.db
      .prepare(
        'SELECT id FROM webhook_inbox WHERE account_id = ? AND connection_id = ? AND delivery_key = ?',
      )
      .get(input.accountId, input.connectionId, input.deliveryKey) as { id: string };
    return { accepted: false, inboxId: existing.id };
  }
}
