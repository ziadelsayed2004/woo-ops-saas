import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { SqliteStore } = await import('../dist/index.js');

test('expired worker leases resume and the idempotency key protects the effect boundary', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-job-restart-'));
  const path = join(directory, 'restart.sqlite');
  const accountId = randomUUID();
  const now = new Date().toISOString();
  const firstStore = new SqliteStore(path);
  firstStore.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, 'Restart account', now, now);
  const job = firstStore.enqueueJob(
    { accountId, correlationId: randomUUID() },
    {
      id: randomUUID(),
      type: 'maintenance',
      idempotencyKey: 'restart-effect-1',
      payload: { effect: 'fixture' },
    },
  );
  assert.deepEqual(firstStore.claimNext({ accountId, correlationId: randomUUID() }, 0)?.id, job.id);
  firstStore.db.close();

  const secondStore = new SqliteStore(path);
  assert.equal(secondStore.recoverExpiredJobsAny(randomUUID()), 1);
  const resumed = secondStore.claimNextAny({ leaseSeconds: 60, correlationId: randomUUID() });
  assert.ok(resumed);
  assert.equal(resumed?.id, job.id);
  const effects = new Set();
  if (!effects.has(resumed.idempotencyKey)) effects.add(resumed.idempotencyKey);
  if (!effects.has(resumed.idempotencyKey)) effects.add(resumed.idempotencyKey);
  assert.equal(effects.size, 1);
  secondStore.complete({ accountId, correlationId: randomUUID() }, resumed.id);
  assert.deepEqual(
    secondStore.db.prepare('SELECT status, attempts FROM jobs WHERE id = ?').get(job.id),
    { status: 'succeeded', attempts: 2 },
  );
  secondStore.db.close();
  rmSync(directory, { recursive: true, force: true });
});
