import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';
import { recoveryQuery } from '../dist/customer-recovery.js';

const store = new SqliteStore(':memory:');
const now = new Date().toISOString();
const setup = () => {
  const accountId = randomUUID(),
    actorId = randomUUID(),
    connectionId = randomUUID();
  store.db
    .prepare('INSERT INTO accounts (id,name,created_at,updated_at) VALUES (?,?,?,?)')
    .run(accountId, 'Synthetic', now, now);
  store.db
    .prepare('INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(actorId, `${actorId}@example.test`, 'hash', now, now);
  store.db
    .prepare(
      "INSERT INTO account_memberships (account_id,user_id,role,created_at) VALUES (?,?,'admin',?)",
    )
    .run(accountId, actorId, now);
  store.db
    .prepare(
      "INSERT INTO connections (id,account_id,platform,store_url,status,created_at,updated_at,sync_last_success_at,sync_status) VALUES (?,?,'woocommerce','https://example.test','active',?,?,?,'succeeded')",
    )
    .run(connectionId, accountId, now, now, now);
  return {
    context: { accountId, actorId, correlationId: randomUUID(), role: 'admin' },
    connectionId,
  };
};
const a = setup(),
  b = setup();
let counter = 0;
const add = (owner, email, status, day, product = '101', extra = {}) => {
  counter += 1;
  return store.upsertRemoteOrder(owner.context, owner.connectionId, {
    externalOrderId: String(counter),
    orderNumber: `R-${counter}`,
    remoteStatus: status,
    currency: 'EGP',
    grandTotalMinor: '12550',
    createdAt: `2026-10-${day}T10:00:00.000Z`,
    modifiedAt: now,
    customer: { first_name: 'عميل', last_name: 'تجريبي', email, phone: '01000000001' },
    billing: { email },
    shipping: { stateCode: 'EGC', governorateNameAr: 'القاهرة' },
    lines: [{ productId: product, name: 'Synthetic item', quantity: 1, unitPriceMinor: '12550' }],
    refunds: [],
    sourceJson: JSON.stringify({ id: counter }),
    sourceHash: `hash-${counter}`,
    ...extra,
  });
};

test('matches by normalized email, latest eligible attempt, strict later dates and full successful history', () => {
  add(a, 'recovered@example.test', 'failed', '01');
  add(a, ' RECOVERED@example.test ', 'processing', '02', '202');
  add(a, 'again@example.test', 'completed', '01');
  add(a, 'again@example.test', 'cancelled', '03');
  add(a, 'retry@example.test', 'failed', '01');
  add(a, ' RETRY@example.test ', 'cancelled', '04');
  add(a, '', 'failed', '02');
  add(a, '   ', 'cancelled', '02');
  add(a, 'same-time@example.test', 'failed', '02');
  add(a, 'same-time@example.test', 'completed', '02');
  add(a, 'foreign@example.test', 'failed', '02');
  add(b, 'foreign@example.test', 'completed', '03');
  add(a, 'pending@example.test', 'failed', '02');
  add(a, 'pending@example.test', 'on-hold', '03');
  const result = store.listCustomerRecovery(a.context);
  assert.deepEqual(result.items.map((i) => i.email).sort(), [
    'again@example.test',
    'foreign@example.test',
    'pending@example.test',
    'retry@example.test',
    'same-time@example.test',
  ]);
  assert.equal(result.items.find((i) => i.email === 'retry@example.test').failedCount, 2);
  assert.equal(
    result.items.find((i) => i.email === 'retry@example.test').orderDate,
    '2026-10-04T10:00:00.000Z',
  );
  assert.equal(result.freshness.stale, false);
  assert.equal(
    store
      .listCustomerRecovery(a.context, { from: '2026-10-01', to: '2026-10-01', productId: '101' })
      .items.some((i) => i.email === 'recovered@example.test'),
    false,
  );
  assert.equal(store.listCustomerRecovery(b.context).items.length, 0);
});

test('ignores manual and deleted successes, does not include deleted candidates, and preserves date/product composition', () => {
  const candidate = add(a, 'deleted@example.test', 'failed', '04');
  const success = add(a, 'deleted@example.test', 'completed', '05');
  store.db
    .prepare('UPDATE orders SET remote_deleted_at = ? WHERE account_id = ? AND id = ?')
    .run(now, a.context.accountId, success);
  assert.equal(store.listCustomerRecovery(a.context, { search: 'deleted@' }).items.length, 1);
  store.db
    .prepare('UPDATE orders SET remote_deleted_at = ? WHERE account_id = ? AND id = ?')
    .run(now, a.context.accountId, candidate);
  assert.equal(store.listCustomerRecovery(a.context, { search: 'deleted@' }).items.length, 0);
  add(a, 'manual@example.test', 'failed', '03');
  const local = add(a, 'manual@example.test', 'completed', '04');
  store.db.prepare("UPDATE orders SET origin = 'manual' WHERE id = ?").run(local);
  assert.equal(store.listCustomerRecovery(a.context, { search: 'manual@' }).items.length, 1);
  add(a, 'products@example.test', 'failed', '02', '101');
  add(a, 'products@example.test', 'cancelled', '05', '202');
  assert.equal(
    store.listCustomerRecovery(a.context, {
      search: 'products@',
      productId: '101',
      to: '2026-10-02',
    }).items[0].orderDate,
    '2026-10-02T10:00:00.000Z',
  );
  assert.equal(store.listCustomerRecovery(a.context, { search: '%_' }).items.length, 0);
});

test('cursor pages are bounded and scoped to account/filter; invalid dates and permissions reject', () => {
  const first = store.listCustomerRecovery(a.context, { limit: 1 });
  assert.ok(first.nextCursor);
  const next = store.listCustomerRecovery(a.context, { limit: 1, cursor: first.nextCursor });
  assert.notEqual(next.items[0].email, first.items[0].email);
  assert.throws(
    () => store.listCustomerRecovery(b.context, { cursor: first.nextCursor }),
    /CURSOR_INVALID/,
  );
  assert.throws(
    () => store.listCustomerRecovery(a.context, { search: 'changed', cursor: first.nextCursor }),
    /CURSOR_INVALID/,
  );
  for (const filter of [
    { from: '2026-02-30' },
    { from: '2026-99-01' },
    { from: '2026-10-03', to: '2026-10-01' },
    { limit: 101 },
  ])
    assert.throws(() => store.listCustomerRecovery(a.context, filter), /INVALID/);
  assert.throws(
    () => store.listCustomerRecovery({ ...a.context, accountId: b.context.accountId }),
    /PERMISSION|MEMBERSHIP/,
  );
});

test('durable report snapshots are isolated, immutable, replay-safe and never mark orders exported', () => {
  const input = { filter: { search: 'retry@' }, locale: 'ar', idempotencyKey: 'report-one' };
  const report = store.createCustomerRecoveryReport(a.context, input);
  assert.equal(store.createCustomerRecoveryReport(a.context, input).id, report.id);
  assert.throws(
    () => store.createCustomerRecoveryReport(a.context, { ...input, locale: 'en' }),
    /CONFLICT/,
  );
  assert.equal(store.getJob(a.context, report.jobId).type, 'export.generate');
  assert.deepEqual(
    JSON.parse(
      store.db
        .prepare('SELECT payload_json FROM jobs WHERE account_id = ? AND id = ?')
        .get(a.context.accountId, report.jobId).payload_json,
    ),
    { customerReportId: report.id },
  );
  const before = store.db
    .prepare('SELECT id,export_state,local_status FROM orders WHERE account_id = ? ORDER BY id')
    .all(a.context.accountId);
  store.snapshotCustomerRecoveryReport(a.context, report.id);
  const rows = store.customerRecoverySnapshotPage(a.context, report.id);
  assert.equal(rows.length, 1);
  add(a, 'retry@example.test', 'processing', '06');
  store.snapshotCustomerRecoveryReport(a.context, report.id);
  assert.deepEqual(store.customerRecoverySnapshotPage(a.context, report.id), rows);
  assert.equal(store.listCustomerRecovery(a.context, input.filter).items.length, 0);
  assert.throws(() => store.customerRecoveryReportForWorker(b.context, report.id), /NOT_FOUND/);
  assert.throws(() => store.customerRecoveryDownload(b.context, report.id), /NOT_FOUND/);
  assert.equal(store.listCustomerRecoveryReports(b.context).length, 0);
  const after = store.db
    .prepare('SELECT id,export_state,local_status FROM orders WHERE account_id = ? ORDER BY id')
    .all(a.context.accountId);
  for (const old of before)
    assert.deepEqual(
      after.find((r) => r.id === old.id),
      old,
    );
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM order_export_events').get().n, 0);
});

test('indexed anti-join stays bounded with 100k synthetic orders and stale sync is exposed', () => {
  const owner = setup();
  const insert = store.db
    .prepare(`INSERT INTO orders (id,account_id,connection_id,origin,external_order_id,order_number,remote_status,currency,grand_total_minor,created_at,updated_at,remote_created_at,customer_email,normalized_json,product_ids_json)
    VALUES (?,?,?,'woo',?,?,?,?,?,?,?,?,?,'{}','[]')`);
  store.db.transaction(() => {
    for (let i = 0; i < 100000; i++)
      insert.run(
        randomUUID(),
        owner.context.accountId,
        owner.connectionId,
        String(i),
        String(i),
        i % 2 ? 'completed' : 'failed',
        'EGP',
        '100',
        now,
        now,
        now,
        `load-${Math.floor(i / 2)}@example.test`,
      );
  })();
  const start = performance.now();
  const page = store.listCustomerRecovery(owner.context, { limit: 100 });
  const elapsed = performance.now() - start;
  assert.equal(page.items.length, 100); // Success created at the same instant is not strictly later.
  assert.ok(elapsed < 1500, `100k order page exceeded 1500ms: ${elapsed}`);
  console.log(`recovery 100k orders: ${elapsed.toFixed(1)}ms`);
  const query = recoveryQuery(owner.context.accountId, {});
  const plan = store.db
    .prepare(`EXPLAIN QUERY PLAN ${query.sql} LIMIT 100`)
    .all(...query.params, owner.context.accountId);
  assert.ok(
    plan.some((r) => /SEARCH s USING INDEX orders_recovery_email_date/.test(String(r.detail))),
  );
  const report = store.createCustomerRecoveryReport(owner.context, {
    filter: {},
    locale: 'en',
    idempotencyKey: 'too-large',
  });
  assert.throws(
    () => store.snapshotCustomerRecoveryReport(owner.context, report.id),
    /LIMIT_EXCEEDED/,
  );
  assert.equal(store.customerRecoverySnapshotPage(owner.context, report.id).length, 0);
  store.db
    .prepare("UPDATE connections SET sync_status = 'failed' WHERE id = ?")
    .run(owner.connectionId);
  assert.equal(store.listCustomerRecovery(owner.context).freshness.stale, true);
});

test('report migration from schema 23 does not backfill or rewrite existing order data', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recovery-migration-'));
  const path = join(directory, 'legacy.sqlite');
  let database = new SqliteStore(path);
  try {
    database.db
      .prepare('INSERT INTO accounts (id,name,created_at,updated_at) VALUES (?,?,?,?)')
      .run('legacy-account', 'Legacy', now, now);
    database.db
      .prepare(
        `INSERT INTO orders (id,account_id,origin,order_number,currency,grand_total_minor,created_at,updated_at,search_text,remote_created_at,normalized_json)
      VALUES ('legacy-order','legacy-account','manual','MAN-1','EGP','100',?,?,'',NULL,'{}')`,
      )
      .run(now, now);
    const before = database.db.prepare('SELECT * FROM orders').all();
    database.db.exec(
      'DROP TABLE customer_recovery_snapshots; DROP TABLE customer_recovery_reports; DROP INDEX orders_recovery_email_date; DELETE FROM schema_migrations WHERE version = 24;',
    );
    database.db.close();
    database = new SqliteStore(path);
    assert.equal(
      database.db.prepare('SELECT MAX(version) AS n FROM schema_migrations').get().n,
      24,
    );
    assert.deepEqual(database.db.prepare('SELECT * FROM orders').all(), before);
  } finally {
    database.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('owner reset clears report snapshots only for that account and preserves the connection', () => {
  store.db
    .prepare("UPDATE account_memberships SET role = 'owner' WHERE account_id = ? AND user_id = ?")
    .run(a.context.accountId, a.context.actorId);
  store.resetAccountOperationalData({ ...a.context, role: 'owner' });
  assert.equal(store.listCustomerRecoveryReports(a.context).length, 0);
  assert.equal(
    store.db
      .prepare('SELECT COUNT(*) AS n FROM customer_recovery_snapshots WHERE account_id = ?')
      .get(a.context.accountId).n,
    0,
  );
  assert.ok(store.getConnection(a.context, a.connectionId));
  assert.equal(
    store.db
      .prepare('SELECT COUNT(*) AS n FROM orders WHERE account_id = ?')
      .get(b.context.accountId).n,
    1,
  );
});

test.after(() => store.db.close());
