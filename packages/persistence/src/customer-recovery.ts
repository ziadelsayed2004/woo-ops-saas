import { createHash } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';

export type RecoveryFilter = {
  search?: string | undefined;
  productId?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};
export type RecoveryItem = {
  orderId: string;
  customerKey: string;
  connectionId: string;
  email: string;
  name: string;
  phone: string;
  governorate: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  totalMinor: string;
  currency: string;
  products: string;
  failedCount: number;
};
export type RecoveryFreshness = { lastSuccessAt: string | null; stale: boolean };
export type RecoveryReport = {
  id: string;
  jobId: string;
  status: string;
  rowCount: number;
  createdAt: string;
  snapshotAt: string | null;
  lastSuccessAt: string | null;
  stale: boolean;
  filename: string | null;
  error: string | null;
};
export const RECOVERY_EXPORT_LIMIT = 10_000;

export function recoveryFilter(input: RecoveryFilter): RecoveryFilter {
  const result: RecoveryFilter = {};
  for (const key of ['search', 'productId', 'from', 'to'] as const) {
    const value = input[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || value.length > (key === 'search' ? 200 : 100))
      throw new Error('CUSTOMER_RECOVERY_FILTER_INVALID');
    result[key] = value.trim();
  }
  for (const key of ['from', 'to'] as const) {
    const value = result[key];
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      throw new Error('CUSTOMER_RECOVERY_DATE_INVALID');
  }
  if (result.from && result.to && result.from > result.to)
    throw new Error('CUSTOMER_RECOVERY_DATE_INVALID');
  return result;
}

const email = (alias: string) => `LOWER(TRIM(${alias}.customer_email))`;
const date = (alias: string) => `COALESCE(${alias}.remote_created_at, ${alias}.created_at)`;
// Keep the expressions identical to migration 24 so the anti-join uses its index.
export function recoveryQuery(accountId: string, raw: RecoveryFilter) {
  const filter = recoveryFilter(raw);
  const clauses = [
    'o.account_id = ?',
    "o.origin = 'woo'",
    'o.remote_deleted_at IS NULL',
    "o.remote_status IN ('cancelled', 'failed')",
    "LOWER(TRIM(o.customer_email)) <> ''",
  ];
  const params: (string | number)[] = [accountId];
  if (filter.search) {
    const term = `%${filter.search.toLowerCase().replace(/[\\%_]/gu, '\\$&')}%`;
    clauses.push(
      "(LOWER(o.customer_name) LIKE ? ESCAPE '\\' OR LOWER(o.customer_email) LIKE ? ESCAPE '\\' OR o.customer_phone LIKE ? ESCAPE '\\')",
    );
    params.push(term, term, term);
  }
  if (filter.productId) {
    clauses.push('EXISTS (SELECT 1 FROM json_each(o.product_ids_json) p WHERE p.value = ?)');
    params.push(filter.productId);
  }
  if (filter.from) {
    clauses.push(`${date('o')} >= ?`);
    params.push(`${filter.from}T00:00:00.000Z`);
  }
  if (filter.to) {
    clauses.push(`${date('o')} < ?`);
    params.push(new Date(Date.parse(filter.to) + 86_400_000).toISOString());
  }
  return {
    filter,
    params,
    sql: `WITH candidates AS (
      SELECT o.id, o.connection_id, ${email('o')} AS email,
        ROW_NUMBER() OVER (PARTITION BY o.connection_id, ${email('o')}
          ORDER BY ${date('o')} DESC, o.id DESC) AS rank
      FROM orders o WHERE ${clauses.join(' AND ')}
    ) SELECT o.id, o.connection_id, c.email, o.customer_name, o.customer_phone,
        o.order_number, ${date('o')} AS order_date, o.remote_status, o.grand_total_minor,
        o.currency, json_object('shipping', json_extract(o.normalized_json, '$.shipping'),
          'lines', json_extract(o.normalized_json, '$.lines')) AS normalized_json,
        (SELECT COUNT(*) FROM orders f WHERE f.account_id = o.account_id
          AND f.connection_id = o.connection_id AND ${email('f')} = c.email
          AND f.origin = 'woo' AND f.remote_deleted_at IS NULL
          AND f.remote_status IN ('cancelled', 'failed')) AS failed_count
      FROM candidates c JOIN orders o ON o.id = c.id AND o.account_id = ?
      WHERE c.rank = 1 AND NOT EXISTS (
        SELECT 1 FROM orders s WHERE s.account_id = o.account_id
          AND s.connection_id = o.connection_id AND ${email('s')} = c.email
          AND s.origin = 'woo' AND s.remote_deleted_at IS NULL
          AND s.remote_status IN ('processing', 'completed') AND ${date('s')} > ${date('o')}
      )`,
  };
}

export function recoveryFreshness(db: SqliteDatabase, accountId: string): RecoveryFreshness {
  const rows = db
    .prepare(
      `SELECT sync_last_success_at, sync_status FROM connections
    WHERE account_id = ? AND platform = 'woocommerce' AND status <> 'disabled'`,
    )
    .all(accountId) as { sync_last_success_at: string | null; sync_status: string }[];
  const lastSuccessAt =
    rows
      .map((r) => r.sync_last_success_at)
      .filter((v): v is string => !!v)
      .sort()[0] ?? null;
  return {
    lastSuccessAt,
    stale:
      rows.length === 0 ||
      rows.some(
        (r) =>
          !r.sync_last_success_at ||
          r.sync_status === 'failed' ||
          Date.now() - Date.parse(r.sync_last_success_at) > 300_000,
      ),
  };
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
export function recoveryItem(row: Record<string, unknown>): RecoveryItem {
  const normalized = JSON.parse(String(row.normalized_json)) as Record<string, unknown>;
  const shipping = normalized.shipping as Record<string, unknown> | undefined;
  const lines = Array.isArray(normalized.lines) ? normalized.lines : [];
  return {
    orderId: String(row.id),
    customerKey: `email:${row.email}`,
    connectionId: String(row.connection_id),
    email: String(row.email),
    name: text(row.customer_name),
    phone: text(row.customer_phone),
    governorate: text(
      shipping?.governorateNameAr ?? shipping?.governorateNameEn ?? shipping?.stateCode,
    ),
    orderNumber: String(row.order_number),
    orderDate: String(row.order_date),
    status: String(row.remote_status),
    totalMinor: String(row.grand_total_minor),
    currency: String(row.currency),
    products: lines
      .map((l: Record<string, unknown>) => text(l.name))
      .filter(Boolean)
      .join('، '),
    failedCount: Number(row.failed_count),
  };
}

export function listRecovery(
  db: SqliteDatabase,
  accountId: string,
  input: RecoveryFilter & { cursor?: string | undefined; limit?: number | undefined },
) {
  const query = recoveryQuery(accountId, input);
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('CUSTOMER_LIMIT_INVALID');
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([accountId, query.filter]))
    .digest('hex');
  let continuation = '';
  const params = [...query.params, accountId];
  if (input.cursor) {
    if (input.cursor.length > 2000) throw new Error('CUSTOMER_CURSOR_INVALID');
    try {
      const cursor = JSON.parse(Buffer.from(input.cursor, 'base64url').toString()) as unknown[];
      if (
        cursor[0] !== fingerprint ||
        typeof cursor[1] !== 'string' ||
        typeof cursor[2] !== 'string'
      )
        throw new Error();
      continuation = ' AND (c.connection_id > ? OR (c.connection_id = ? AND c.email > ?))';
      params.push(cursor[1], cursor[1], cursor[2]);
    } catch {
      throw new Error('CUSTOMER_CURSOR_INVALID');
    }
  }
  const rows = db
    .prepare(`${query.sql}${continuation} ORDER BY c.connection_id, c.email LIMIT ?`)
    .all(...params, limit + 1) as Record<string, unknown>[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(recoveryItem);
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor:
      hasMore && last
        ? Buffer.from(JSON.stringify([fingerprint, last.connectionId, last.email])).toString(
            'base64url',
          )
        : null,
    freshness: recoveryFreshness(db, accountId),
  };
}

export function reportRecord(row: Record<string, unknown>): RecoveryReport {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    status: String(row.status),
    rowCount: Number(row.row_count),
    createdAt: String(row.created_at),
    snapshotAt: row.snapshot_at as string | null,
    lastSuccessAt: row.sync_success_at as string | null,
    stale: row.stale === 1,
    filename: row.filename as string | null,
    error: row.error as string | null,
  };
}
