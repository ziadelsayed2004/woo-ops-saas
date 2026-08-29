import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dbPath = join(tmpdir(), `woo-ops-jobs-${randomUUID()}.sqlite`);
const { SqliteStore } = await import('../dist/index.js');
const store = new SqliteStore(dbPath);
const accountA = { accountId: randomUUID(), correlationId: randomUUID() };
const accountB = { accountId: randomUUID(), correlationId: randomUUID() };
const now = new Date().toISOString();
for (const [accountId, name] of [
  [accountA.accountId, 'A'],
  [accountB.accountId, 'B'],
]) {
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, name, now, now);
}

test('job idempotency and account scope', () => {
  const first = store.enqueueJob(accountA, {
    id: randomUUID(),
    type: 'sync',
    idempotencyKey: 'same',
    payload: { connectionId: 'one' },
  });
  const duplicate = store.enqueueJob(accountA, {
    id: randomUUID(),
    type: 'sync',
    idempotencyKey: 'same',
    payload: { connectionId: 'two' },
  });
  assert.equal(duplicate.id, first.id);
  assert.equal(store.claimNext(accountB), null);
  assert.equal(store.claimNext(accountA)?.id, first.id);
});

test('failed jobs become dead letters after max attempts', () => {
  const job = store.enqueueJob(accountA, {
    id: randomUUID(),
    type: 'poison',
    idempotencyKey: randomUUID(),
    payload: {},
    maxAttempts: 1,
  });
  assert.equal(store.claimNext(accountA)?.id, job.id);
  store.failJob(accountA, job.id, 'fixture failure');
  const row = store.db
    .prepare('SELECT status, last_error FROM jobs WHERE id = ? AND account_id = ?')
    .get(job.id, accountA.accountId);
  assert.deepEqual(row, { status: 'dead-lettered', last_error: 'fixture failure' });
});

test('webhook inbox deduplicates delivery keys and preserves raw bytes', () => {
  const body = Buffer.from('{"order_id":42}');
  const input = {
    id: randomUUID(),
    accountId: accountA.accountId,
    connectionId: randomUUID(),
    deliveryKey: randomUUID(),
    topic: 'order.created',
    body,
    checksum: createHash('sha256').update(body).digest('hex'),
  };
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      input.connectionId,
      accountA.accountId,
      'woocommerce',
      'https://shop.example.com',
      'active',
      now,
      now,
    );
  assert.equal(store.acceptWebhook(input).accepted, true);
  assert.equal(store.acceptWebhook({ ...input, id: randomUUID() }).accepted, false);
  const stored = store.db
    .prepare('SELECT raw_body, body_checksum FROM webhook_inbox WHERE delivery_key = ?')
    .get(input.deliveryKey);
  assert.equal(Buffer.from(stored.raw_body).toString(), body.toString());
  assert.equal(stored.body_checksum, input.checksum);
});

test('jobs recover expired leases and reject invalid payloads', () => {
  const job = store.enqueueJob(accountA, {
    id: randomUUID(),
    type: 'restartable',
    idempotencyKey: randomUUID(),
    payload: { ok: true },
  });
  assert.equal(store.claimNext(accountA, 0)?.id, job.id);
  assert.equal(store.recoverExpiredJobs(accountA), 1);
  assert.equal(store.claimNext(accountA)?.id, job.id);
  assert.throws(
    () =>
      store.enqueueJob(accountA, {
        id: randomUUID(),
        type: 'invalid',
        idempotencyKey: randomUUID(),
        payload: BigInt(1),
      }),
    /JOB_PAYLOAD_INVALID/,
  );
});

test.after(() => {
  store.db.close();
  rmSync(dbPath, { force: true });
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
});
