import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore, schemaVersion } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-document-batches-'));
const store = new SqliteStore(join(directory, 'documents.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const actorId = randomUUID();
const otherActorId = randomUUID();
const now = new Date().toISOString();
for (const [id, name] of [
  [accountId, 'Batch account'],
  [otherAccountId, 'Other batch account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account] of [
  [actorId, 'batch@example.test', accountId],
  [otherActorId, 'other-batch@example.test', otherAccountId],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'fixture', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(account, id, 'admin', now);
}
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const otherContext = {
  accountId: otherAccountId,
  actorId: otherActorId,
  role: 'admin',
  correlationId: randomUUID(),
};
const firstOrder = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'First document customer' },
  lines: [{ name: 'First product', quantity: 1, unitPriceMinor: '1000' }],
});
const secondOrder = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'Second document customer' },
  lines: [{ name: 'Second product', quantity: 2, unitPriceMinor: '2000' }],
});
const selection = store.createSelection(context, {
  mode: 'explicit',
  orderIds: [firstOrder.id, secondOrder.id],
});
const template = store.createDocumentTemplate(context, {
  name: 'Batch invoice',
  format: 'a4',
  locale: 'en-US',
  direction: 'ltr',
  body: 'Order {{order.number}}',
  companyName: 'Woo Ops',
});
const worker = { accountId, correlationId: randomUUID() };
const checksum = (value) => createHash('sha256').update(value).digest('hex');

test('document batches snapshot orders/templates, isolate items, and support partial retry', () => {
  assert.equal(schemaVersion, 20);
  const batch = store.createDocumentBatch(context, {
    selectionId: selection.id,
    action: 'generate-invoice',
    templateId: template.id,
    idempotencyKey: 'batch-idempotency-1',
  });
  assert.equal(batch.totalCount, 2);
  assert.equal(batch.templateVersion, 1);
  assert.equal(batch.status, 'queued');
  assert.ok(batch.jobId);
  assert.equal(
    store.createDocumentBatch(context, {
      selectionId: selection.id,
      action: 'generate-invoice',
      templateId: template.id,
      idempotencyKey: 'batch-idempotency-1',
    }).id,
    batch.id,
  );
  assert.throws(() => store.getDocumentBatch(otherContext, batch.id), /DOCUMENT_BATCH_NOT_FOUND/);

  store.startDocumentBatchForWorker(worker, batch.id);
  const first = store.claimNextDocumentItem(worker, batch.id);
  assert.ok(first);
  assert.equal(first.status, 'running');
  assert.ok([firstOrder.id, secondOrder.id].includes(first.orderId));
  assert.ok(
    ['First document customer', 'Second document customer'].includes(first.snapshot.customer.name),
  );
  const orderArtifactId = `order-${batch.id.slice(0, 32)}-0`;
  const artifact = store.registerDocumentArtifactForWorker(worker, {
    id: orderArtifactId,
    batchId: batch.id,
    orderId: first.orderId,
    templateId: batch.templateId,
    templateVersion: batch.templateVersion,
    format: batch.format,
    kind: 'order-pdf',
    relativePath: `${accountId}/${batch.id}/${orderArtifactId}.pdf`,
    filename: 'order-0001.pdf',
    mimeType: 'application/pdf',
    byteSize: 10,
    checksum: checksum('first-pdf'),
    snapshotHash: first.snapshotHash,
  });
  store.completeDocumentBatchItemForWorker(worker, batch.id, first.position, artifact.id);
  const second = store.claimNextDocumentItem(worker, batch.id);
  assert.ok(second);
  store.failDocumentBatchItemForWorker(
    worker,
    batch.id,
    second.position,
    'DOCUMENT_ARABIC_FONT_REQUIRED',
  );
  const manifestId = `manifest-${batch.id.slice(0, 32)}-1`;
  store.registerDocumentArtifactForWorker(worker, {
    id: manifestId,
    batchId: batch.id,
    templateId: batch.templateId,
    templateVersion: batch.templateVersion,
    format: batch.format,
    kind: 'manifest',
    relativePath: `${accountId}/${batch.id}/${manifestId}.json`,
    filename: 'manifest.json',
    mimeType: 'application/json',
    byteSize: 10,
    checksum: checksum('manifest'),
    snapshotHash: batch.snapshotHash,
  });
  const partial = store.completeDocumentBatchForWorker(worker, batch.id, {
    manifestArtifactId: manifestId,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.succeededCount, 1);
  assert.equal(partial.failedCount, 1);
  assert.equal(store.listDocumentArtifacts(context, { batchId: batch.id }).length, 2);

  const retried = store.retryDocumentBatchFailures(context, batch.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attemptCount, 2);
  assert.ok(retried.jobId);
  assert.equal(store.listDocumentBatchItems(context, batch.id).items[1].status, 'queued');
});

test('failed aggregate batches can be resumed by the same durable job attempt', () => {
  const batch = store.createDocumentBatch(context, {
    selectionId: selection.id,
    action: 'print-documents',
    templateId: template.id,
    idempotencyKey: 'batch-transient-retry-1',
  });
  const started = store.startDocumentBatchForWorker(worker, batch.id);
  assert.equal(started.attemptCount, 1);
  assert.equal(
    store.failDocumentBatchForWorker(worker, batch.id, 'temporary storage error').status,
    'failed',
  );
  const resumed = store.resumeDocumentBatchForWorker(worker, batch.id);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.attemptCount, 2);
  assert.equal(resumed.error, null);
  store.failDocumentBatchForWorker(worker, batch.id, 'temporary storage error');
  const retried = store.retryDocumentBatchFailures(context, batch.id);
  assert.equal(retried.status, 'queued');
  assert.equal(retried.attemptCount, 3);
});

test('invoice identity policy requires an explicit external approval reference', () => {
  assert.throws(
    () =>
      store.updateDocumentIdentityPolicy(context, {
        invoiceNumberingEnabled: true,
        legalInvoiceEnabled: true,
        invoicePrefix: 'eg-inv',
      }),
    /DOCUMENT_LEGAL_POLICY_APPROVAL_REQUIRED/,
  );
  const policy = store.updateDocumentIdentityPolicy(context, {
    invoiceNumberingEnabled: true,
    legalInvoiceEnabled: true,
    approvalReference: 'external-tax-approval-2026',
    invoicePrefix: 'eg-inv',
    nextInvoiceSequence: 7,
  });
  assert.equal(policy.invoicePrefix, 'EG-INV');
  assert.equal(policy.nextInvoiceSequence, 7);
  assert.equal(policy.legalInvoiceEnabled, true);
});

test('artifact paths and account reads stay bounded', () => {
  const batch = store.listDocumentBatches(context).items[0];
  assert.throws(
    () =>
      store.registerDocumentArtifact(context, {
        id: 'unsafe-artifact',
        batchId: batch.id,
        templateId: batch.templateId,
        templateVersion: batch.templateVersion,
        format: batch.format,
        kind: 'zip',
        relativePath: `${accountId}/${batch.id}/../outside.zip`,
        filename: 'bundle.zip',
        mimeType: 'application/zip',
        byteSize: 10,
        checksum: checksum('zip'),
        snapshotHash: batch.snapshotHash,
      }),
    /DOCUMENT_ARTIFACT_PATH_INVALID/,
  );
  assert.throws(
    () =>
      store.registerDocumentArtifact(context, {
        id: 'safe-artifact',
        batchId: batch.id,
        templateId: batch.templateId,
        templateVersion: batch.templateVersion,
        format: 'a4',
        kind: 'zip',
        relativePath: `${accountId}/${batch.id}/different-artifact.zip`,
        filename: 'bundle.zip',
        mimeType: 'application/zip',
        byteSize: 10,
        checksum: checksum('another-zip'),
        snapshotHash: checksum('snapshot'),
      }),
    /DOCUMENT_ARTIFACT_PATH_INVALID/,
  );
  assert.equal(store.listDocumentBatches(otherContext).items.length, 0);
  assert.throws(
    () => store.getDocumentArtifact(otherContext, 'unsafe-artifact'),
    /DOCUMENT_ARTIFACT_NOT_FOUND/,
  );
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
