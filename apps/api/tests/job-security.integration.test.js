import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';

test('job operations cannot cross accounts and dead-letter errors are redacted', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-job-security-'));
  const store = new SqliteStore(join(directory, 'security.sqlite'));
  const now = new Date().toISOString();
  const accountA = randomUUID();
  const accountB = randomUUID();
  const actorA = randomUUID();
  const actorB = randomUUID();
  try {
    for (const [accountId, actorId, email] of [
      [accountA, actorA, 'job-security-a@example.test'],
      [accountB, actorB, 'job-security-b@example.test'],
    ]) {
      store.db
        .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(accountId, accountId, now, now);
      store.db
        .prepare(
          'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(actorId, email, 'fixture', now, now);
      store.db
        .prepare(
          'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(accountId, actorId, 'admin', now);
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
    const job = store.enqueueJob(workerA, {
      id: randomUUID(),
      type: 'maintenance',
      idempotencyKey: randomUUID(),
      payload: { private: 'account-a' },
      maxAttempts: 1,
    });
    store.claimNext(workerA);
    store.failJob(workerA, job.id, 'token=abc123 account-a@example.test');
    assert.equal(store.listDeadLetters(contextB).items.length, 0);
    assert.throws(() => store.getJob(contextB, job.id), /JOB_NOT_FOUND/);
    assert.throws(() => store.replayDeadLetter(contextB, job.id), /JOB_NOT_FOUND/);
    const visible = store.getJob(contextA, job.id);
    assert.equal(visible.lastError.includes('abc123'), false);
    assert.equal(visible.lastError.includes('account-a@example.test'), false);
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
