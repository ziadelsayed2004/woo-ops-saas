import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  decryptSecretEnvelope,
  encryptCredentialEnvelope,
  encryptSecretEnvelope,
} from '../../connectors/dist/index.js';
import { SqliteStore, schemaVersion } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-connection-lifecycle-'));
const store = new SqliteStore(join(directory, 'connections.sqlite'));
const now = '2026-08-31T10:00:00.000Z';
const encryptionKey = Buffer.alloc(32, 11).toString('base64');
const accountId = randomUUID();
const actorId = randomUUID();
const otherAccountId = randomUUID();
const otherActorId = randomUUID();
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const otherContext = {
  accountId: otherAccountId,
  actorId: otherActorId,
  role: 'admin',
  correlationId: randomUUID(),
};

for (const [id, name] of [
  [accountId, 'Connection account'],
  [otherAccountId, 'Other account'],
]) {
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
}
for (const [account, actor, email] of [
  [accountId, actorId, 'connection-owner@example.test'],
  [otherAccountId, otherActorId, 'other-connection-owner@example.test'],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(actor, email, 'fixture', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(account, actor, 'admin', now);
}

const orderInput = (externalOrderId, reconcileToken) => ({
  externalOrderId,
  orderNumber: `W-${externalOrderId}`,
  remoteStatus: 'processing',
  currency: 'EGP',
  grandTotalMinor: '12500',
  createdAt: now,
  modifiedAt: now,
  customer: { email: `${externalOrderId}@example.test` },
  billing: {},
  shipping: {},
  lines: [],
  refunds: [],
  sourceJson: JSON.stringify({ id: Number(externalOrderId) }),
  sourceHash: `hash-${externalOrderId}`,
  ...(reconcileToken === undefined ? {} : { reconcileToken }),
});

test('authorization is one-time, account scoped, encrypted, and credential-safe in summaries', () => {
  assert.equal(schemaVersion, 20);
  const stateNonce = randomUUID();
  const stateHash = createHash('sha256').update(stateNonce).digest('hex');
  store.createAuthorizationState(context, {
    stateHash,
    userId: actorId,
    storeUrl: 'https://connection-shop.example.test',
    expiresAt: '2026-08-31T11:00:00.000Z',
  });
  const encryptedCredentials = JSON.stringify(
    encryptCredentialEnvelope(
      { key: 'ck_connection_read', secret: 'cs_connection_secret' },
      encryptionKey,
    ),
  );
  const connection = store.completeAuthorization({ stateHash, encryptedCredentials, now });
  assert.equal(connection.accountId, accountId);
  assert.equal(connection.status, 'active');
  assert.equal(Object.hasOwn(connection, 'encryptedCredentials'), false);
  assert.equal(JSON.stringify(connection).includes('cs_connection_secret'), false);
  assert.deepEqual(
    store.listConnections(context).map((item) => item.id),
    [connection.id],
  );
  assert.throws(() => store.getConnection(otherContext, connection.id), /CONNECTION_NOT_FOUND/);
  assert.throws(
    () => store.completeAuthorization({ stateHash, encryptedCredentials, now }),
    /CONNECTOR_CALLBACK_REPLAYED/,
  );

  const workerRecord = store.getConnectionForWorker(context, connection.id);
  assert.equal(workerRecord.encryptedCredentials, encryptedCredentials);
  assert.deepEqual(JSON.parse(workerRecord.encryptedCredentials), JSON.parse(encryptedCredentials));
  assert.throws(
    () => store.getConnectionForWorker(otherContext, connection.id),
    /CONNECTION_NOT_FOUND/,
  );
});

test('health, rotation, webhook-secret and disable transitions are local and audited', () => {
  const connection = store.listConnections(context)[0];
  assert.ok(connection);
  const healthy = store.recordConnectionHealth(context, connection.id, {
    status: 'healthy',
    platformVersion: '9.9.0',
    wordpressVersion: '6.8.1',
    capabilities: { products: true, orders: true, webhooks: true },
    sourceTimezone: 'Africa/Cairo',
  });
  assert.equal(healthy.status, 'active');
  assert.equal(healthy.healthStatus, 'healthy');
  assert.deepEqual(healthy.capabilities, { products: true, orders: true, webhooks: true });

  const rotatedEnvelope = JSON.stringify(
    encryptCredentialEnvelope(
      { key: 'ck_rotated_read', secret: 'cs_rotated_secret' },
      encryptionKey,
    ),
  );
  const rotated = store.rotateConnection(context, connection.id, rotatedEnvelope);
  assert.equal(rotated.healthStatus, 'unknown');
  assert.equal(
    store.getConnectionForWorker(context, connection.id).encryptedCredentials,
    rotatedEnvelope,
  );

  const webhookEnvelope = JSON.stringify(
    encryptSecretEnvelope('connection-webhook-secret', encryptionKey),
  );
  store.setWebhookSecret(context, connection.id, webhookEnvelope);
  const webhookConnection = store.getConnectionForWebhook(connection.id);
  assert.equal(webhookConnection?.accountId, accountId);
  assert.equal(
    decryptSecretEnvelope(
      JSON.parse(webhookConnection?.encryptedWebhookSecret ?? '{}'),
      encryptionKey,
    ),
    'connection-webhook-secret',
  );

  const disabled = store.disableConnection(context, connection.id);
  assert.equal(disabled.status, 'disabled');
  assert.throws(
    () => store.upsertRemoteOrder(context, connection.id, orderInput('900', 'reconcile:disabled')),
    /CONNECTION_DISABLED/,
  );
  assert.throws(
    () => store.markConnectionSyncQueued(context, connection.id),
    /CONNECTION_DISABLED/,
  );
});

test('sync runs checkpoint counters, classify failures, resume idempotently, and reconcile deletions', () => {
  const connection = store.listConnections(context)[0];
  assert.ok(connection);
  store.db
    .prepare("UPDATE connections SET status = 'active' WHERE account_id = ? AND id = ?")
    .run(accountId, connection.id);
  store.upsertRemoteOrder(context, connection.id, orderInput('901', 'reconcile:seen'));
  store.upsertRemoteOrder(context, connection.id, orderInput('902'));
  const deleted = store.markRemoteOrdersNotSeen(
    context,
    connection.id,
    'reconcile:seen',
    new Date().toISOString(),
  );
  assert.equal(deleted, 1);
  assert.equal(
    store.db.prepare('SELECT remote_deleted_at FROM orders WHERE external_order_id = ?').get('902')
      .remote_deleted_at !== null,
    true,
  );
  store.upsertRemoteOrder(context, connection.id, orderInput('902', 'reconcile:seen'));
  assert.equal(
    store.db.prepare('SELECT remote_deleted_at FROM orders WHERE external_order_id = ?').get('902')
      .remote_deleted_at,
    null,
  );
  const webhookBody = Buffer.from('{"id":901}');
  assert.throws(
    () =>
      store.acceptWebhook({
        id: randomUUID(),
        accountId,
        connectionId: connection.id,
        deliveryKey: randomUUID(),
        topic: 'customer.updated',
        body: webhookBody,
        checksum: createHash('sha256').update(webhookBody).digest('hex'),
      }),
    /WEBHOOK_TOPIC_UNSUPPORTED/,
  );

  const runId = randomUUID();
  let run = store.beginSyncRun(context, {
    id: runId,
    connectionId: connection.id,
    type: 'initial',
  });
  assert.equal(run.status, 'running');
  assert.equal(run.cursor, '{}');
  run = store.updateSyncRun(context, runId, {
    cursor: JSON.stringify({ phase: 'orders', page: 2 }),
    pages: 1,
    items: 2,
    catalogItems: 3,
  });
  assert.deepEqual(
    { pages: run.pages, items: run.items, deleted: run.deleted },
    { pages: 1, items: 5, deleted: 0 },
  );
  const failed = store.failSyncRun(context, runId, {
    errorCode: 'WOO_HTTP_429',
    errorCategory: 'rate',
    retryAfterAt: '2026-08-31T10:01:00.000Z',
  });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.errorCategory, 'rate');
  assert.equal(store.getConnection(context, connection.id).syncStatus, 'failed');

  const resumed = store.beginSyncRun(context, {
    id: runId,
    connectionId: connection.id,
    type: 'initial',
  });
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.cursor, JSON.stringify({ phase: 'orders', page: 2 }));
  const completed = store.completeSyncRun(context, runId, {
    cursor: JSON.stringify({ phase: 'complete' }),
    deleted: 1,
  });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.deleted, 1);
  assert.equal(
    store.beginSyncRun(context, { id: runId, connectionId: connection.id, type: 'initial' }).status,
    'succeeded',
  );
  assert.equal(store.getConnection(context, connection.id).syncStatus, 'succeeded');
  assert.throws(
    () =>
      store.beginSyncRun(otherContext, { id: runId, connectionId: connection.id, type: 'initial' }),
    /CONNECTION_NOT_FOUND/,
  );
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
