import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-account-isolation-'));
const store = new SqliteStore(join(directory, 'isolation.sqlite'));
const now = new Date().toISOString();
const accountA = randomUUID();
const accountB = randomUUID();
const actorA = randomUUID();
const actorB = randomUUID();
const connectionA = randomUUID();
const connectionB = randomUUID();
for (const [id, name] of [
  [accountA, 'Account A'],
  [accountB, 'Account B'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, accountId] of [
  [actorA, 'a@example.test', accountA],
  [actorB, 'b@example.test', accountB],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'fixture-hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(accountId, id, 'admin', now);
}
for (const [id, accountId, storeUrl] of [
  [connectionA, accountA, 'https://a.example.test'],
  [connectionB, accountB, 'https://b.example.test'],
])
  store.db
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, accountId, 'woocommerce', storeUrl, 'active', now, now);
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
const orderA = store.createManualOrder(contextA, {
  currency: 'EGP',
  customer: { name: 'account-a-secret' },
  lines: [{ name: 'A item', quantity: 1, unitPriceMinor: '100' }],
});
const orderB = store.createManualOrder(contextB, {
  currency: 'EGP',
  customer: { name: 'account-b-secret' },
  lines: [{ name: 'B item', quantity: 1, unitPriceMinor: '200' }],
});

test('repositories scope reads, selections and jobs by the authenticated account', () => {
  assert.equal(store.getOrder(contextB, orderA.id), null);
  assert.equal(store.queryOrders(contextB, { search: 'account-a-secret' }).items.length, 0);
  assert.equal(store.queryOrders(contextA, { search: 'account-b-secret' }).items.length, 0);
  const selection = store.createSelection(contextA, { mode: 'explicit', orderIds: [orderA.id] });
  assert.throws(() => store.getSelection(contextB, selection.id), /SELECTION_NOT_FOUND/);
  assert.throws(
    () => store.createSelection(contextB, { mode: 'explicit', orderIds: [orderA.id] }),
    /SELECTION_ORDER_NOT_FOUND/,
  );
  const job = store.enqueueJob(contextA, {
    id: randomUUID(),
    type: 'maintenance',
    idempotencyKey: 'account-a-job',
    payload: { orderId: orderA.id },
  });
  assert.equal(
    store.db.prepare('SELECT id FROM jobs WHERE account_id = ? AND id = ?').get(accountB, job.id),
    undefined,
  );
  assert.equal(store.claimNext(contextB), null);

  const profile = store.createExportProfile(contextA, { name: 'Account A export' });
  const version = store.createExportProfileVersion(contextA, profile.id, {
    format: 'csv',
    rowMode: 'order',
    columns: [{ key: 'orderNumber', label: 'Order', type: 'text' }],
    filenameTemplate: 'account-a-{format}',
  });
  const exportBatch = store.createExportBatch(contextA, {
    selectionId: selection.id,
    profileVersionId: version.id,
    idempotencyKey: 'account-a-export',
  });
  assert.throws(() => store.getExportBatch(contextB, exportBatch.id), /EXPORT_BATCH_NOT_FOUND/);
  assert.throws(
    () => store.getExportProfileVersion(contextB, version.id),
    /EXPORT_PROFILE_VERSION_NOT_FOUND/,
  );
  assert.throws(
    () => store.getExportSnapshotPageForWorker(contextB, exportBatch.id),
    /EXPORT_BATCH_NOT_FOUND/,
  );
});

test('webhook inbox rejects mismatched account/connection and replay is idempotent', () => {
  const body = Buffer.from('{"id":42}');
  const input = {
    id: randomUUID(),
    accountId: accountB,
    connectionId: connectionA,
    deliveryKey: 'delivery-1',
    topic: 'order.created',
    body,
    checksum: createHash('sha256').update(body).digest('hex'),
  };
  assert.throws(() => store.acceptWebhook(input), /WEBHOOK_CONNECTION_NOT_FOUND/);
  const accepted = store.acceptWebhook({ ...input, connectionId: connectionB });
  assert.equal(accepted.accepted, true);
  assert.equal(
    store.acceptWebhook({ ...input, connectionId: connectionB, id: randomUUID() }).accepted,
    false,
  );
  assert.throws(
    () =>
      store.acceptWebhook({
        ...input,
        connectionId: connectionB,
        deliveryKey: 'delivery-2',
        checksum: '0'.repeat(64),
      }),
    /WEBHOOK_CHECKSUM_INVALID/,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
