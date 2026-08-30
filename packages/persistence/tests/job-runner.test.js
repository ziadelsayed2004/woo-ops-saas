import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const directory = mkdtempSync(join(tmpdir(), 'woo-job-runner-'));
const { SqliteStore } = await import('../dist/index.js');
const store = new SqliteStore(join(directory, 'jobs.sqlite'));
const now = new Date().toISOString();
const accountA = randomUUID();
const accountB = randomUUID();
const actorA = randomUUID();
const actorB = randomUUID();

for (const [accountId, name, userId, email] of [
  [accountA, 'A', actorA, 'job-a@example.test'],
  [accountB, 'B', actorB, 'job-b@example.test'],
]) {
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, name, now, now);
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(userId, email, 'fixture', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(accountId, userId, 'admin', now);
}

const contextA = {
  accountId: accountA,
  actorId: actorA,
  role: 'admin',
  correlationId: randomUUID(),
};
const contextB = {
  accountId: accountB,
  actorId: actorB,
  role: 'admin',
  correlationId: randomUUID(),
};
const workerA = { accountId: accountA, correlationId: randomUUID() };

test('durable jobs validate types, detect idempotency conflicts and hide payloads', () => {
  const first = store.enqueueJob(contextA, {
    id: randomUUID(),
    type: 'maintenance',
    idempotencyKey: 'maintenance-1',
    payload: { secret: 'never-returned' },
    maxAttempts: 2,
  });
  const duplicate = store.enqueueJob(contextA, {
    id: randomUUID(),
    type: 'maintenance',
    idempotencyKey: 'maintenance-1',
    payload: { secret: 'never-returned' },
    maxAttempts: 2,
  });
  assert.equal(duplicate.id, first.id);
  assert.throws(
    () =>
      store.enqueueJob(contextA, {
        id: randomUUID(),
        type: 'maintenance',
        idempotencyKey: 'maintenance-1',
        payload: { secret: 'changed' },
      }),
    /JOB_IDEMPOTENCY_CONFLICT/,
  );
  assert.throws(
    () =>
      store.enqueueJob(contextA, {
        id: randomUUID(),
        type: 'unknown.job',
        idempotencyKey: randomUUID(),
        payload: {},
      }),
    /JOB_TYPE_NOT_ALLOWED/,
  );
  const summary = store.getJob(contextA, first.id);
  assert.equal('payload' in summary, false);
  assert.equal(summary.maxAttempts, 2);
  assert.equal(store.getJobUsage(contextA).payloadBytes > 0, true);
  assert.equal(store.claimNext(workerA)?.id, first.id);
  store.complete(workerA, first.id);
});

test('claim-any and expired lease recovery remain account scoped', () => {
  const job = store.enqueueJob(contextA, {
    id: randomUUID(),
    type: 'maintenance',
    idempotencyKey: randomUUID(),
    payload: { account: 'a' },
  });
  assert.equal(store.claimNextAny({ leaseSeconds: 0, correlationId: randomUUID() })?.id, job.id);
  assert.equal(store.recoverExpiredJobs(workerA), 1);
  const claimed = store.claimNext(workerA);
  assert.equal(claimed?.id, job.id);
  store.complete(workerA, job.id);
  assert.equal(store.claimNext(contextB), null);
});

test('failure uses bounded redacted errors, dead letters and audited replay', () => {
  const job = store.enqueueJob(contextA, {
    id: randomUUID(),
    type: 'maintenance',
    idempotencyKey: randomUUID(),
    payload: {},
    maxAttempts: 1,
  });
  assert.equal(store.claimNext(workerA)?.id, job.id);
  store.failJob(contextA, job.id, 'password=top-secret user=test@example.com\nstack trace');
  const row = store.db
    .prepare('SELECT status, last_error, lease_until FROM jobs WHERE account_id = ? AND id = ?')
    .get(accountA, job.id);
  assert.equal(row.status, 'dead-lettered');
  assert.equal(row.lease_until, null);
  assert.match(row.last_error, /password=\[REDACTED\]/i);
  assert.equal(row.last_error.includes('test@example.com'), false);
  const replayed = store.replayDeadLetter(contextA, job.id);
  assert.equal(replayed.status, 'queued');
  assert.equal(replayed.attempts, 0);
  assert.equal(
    store.db.prepare('SELECT payload_json FROM jobs WHERE id = ?').get(job.id).payload_json,
    '{}',
  );
  const audit = store.db
    .prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE account_id = ? AND action LIKE 'job.%'",
    )
    .get(accountA);
  assert.equal(Number(audit.count) >= 5, true);
});

test('operations list, dead-letter and usage endpoints have bounded account views', () => {
  const a = store.listJobs(contextA, { limit: 100 });
  assert.equal(
    a.items.every((item) => item.accountId === accountA),
    true,
  );
  assert.equal(
    store.listDeadLetters(contextA).items.every((item) => item.status === 'dead-lettered'),
    true,
  );
  assert.equal(
    store.listJobs(contextB).items.every((item) => item.accountId === accountB),
    true,
  );
  assert.throws(() => store.getJob(contextB, a.items[0].id), /JOB_NOT_FOUND/);
  assert.equal(store.accountHealthSnapshot(contextA).queue.queued >= 1, true);
});

test('bulk creation creates a durable queue job and worker applies local actions idempotently', () => {
  const order = store.createManualOrder(contextA, {
    currency: 'EGP',
    lines: [{ name: 'Bulk item', quantity: 1, unitPriceMinor: '100' }],
  });
  const selection = store.createSelection(contextA, { mode: 'explicit', orderIds: [order.id] });
  const bulk = store.createBulkJob(contextA, {
    selectionId: selection.id,
    action: 'update-local-status',
    parameters: { status: 'packed' },
    idempotencyKey: randomUUID(),
  });
  const queued = store.db
    .prepare("SELECT type, payload_json FROM jobs WHERE account_id = ? AND type = 'bulk.process'")
    .get(accountA);
  assert.equal(queued.type, 'bulk.process');
  assert.deepEqual(JSON.parse(queued.payload_json), { bulkJobId: bulk.id });
  const topJob = store.claimNext(workerA);
  assert.ok(topJob);
  const item = store.claimNextBulkItem(workerA, bulk.id);
  assert.ok(item);
  store.applyBulkItem(workerA, bulk.id, item.orderId);
  store.completeBulkItem(workerA, bulk.id, item.orderId, { success: true });
  store.applyBulkItem(workerA, bulk.id, item.orderId);
  assert.equal(store.getOrder(contextA, order.id).localStatus, 'packed');
  store.complete(workerA, topJob.id);
  assert.equal(store.getBulkJobForWorker(workerA, bulk.id).status, 'succeeded');
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
