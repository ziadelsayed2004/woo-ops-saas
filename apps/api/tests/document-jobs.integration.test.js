import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';
import { createApiJobRunner } from '../src/job-runner.js';
import { createDocumentEffect } from '../src/document-effect.js';
import { readPrivateDocumentArtifact } from '../src/document-artifacts.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-document-jobs-'));
const storageRoot = join(directory, 'private-documents');
const store = new SqliteStore(join(directory, 'documents.sqlite'));
const accountId = randomUUID();
const actorId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Document jobs', now, now);
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(actorId, 'document-jobs@example.test', 'fixture', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, actorId, 'admin', now);
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
const orderA = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'Batch A' },
  shipping: { address_1: 'Long street 1' },
  lines: [{ name: 'A product', quantity: 1, unitPriceMinor: '1500' }],
});
const orderB = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'Batch B' },
  shipping: { address_1: 'Long street 2' },
  lines: [
    { name: 'B product 1', quantity: 1, unitPriceMinor: '2500' },
    { name: 'B product 2', quantity: 2, unitPriceMinor: '500' },
  ],
});
const selection = store.createSelection(context, {
  mode: 'explicit',
  orderIds: [orderA.id, orderB.id],
});
const template = store.createDocumentTemplate(context, {
  name: 'Integration documents',
  format: 'thermal-80mm',
  locale: 'en-US',
  direction: 'ltr',
  body: 'Order {{order.number}} for {{customer.name}}',
  companyName: 'Woo Ops',
});

test('document job renders immutable order snapshots and private batch artifacts', async () => {
  const batch = store.createDocumentBatch(context, {
    selectionId: selection.id,
    action: 'print-documents',
    templateId: template.id,
    idempotencyKey: 'document-job-integration-1',
  });
  const runner = createApiJobRunner(store, {
    concurrency: 1,
    leaseSeconds: 5,
    pollIntervalMs: 10,
    effects: { document: createDocumentEffect(store, storageRoot) },
  });
  const processed = await runner.drain({ maxJobs: 1 });
  assert.equal(processed, 1);
  const completed = store.getDocumentBatch(context, batch.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.processedCount, 2);
  assert.equal(completed.succeededCount, 2);
  assert.equal(completed.failedCount, 0);
  assert.ok(completed.mergedArtifactId);
  assert.ok(completed.zipArtifactId);
  assert.ok(completed.manifestArtifactId);
  assert.equal(store.getJob(context, batch.jobId).status, 'succeeded');

  const artifacts = store.listDocumentArtifacts(context, { batchId: batch.id });
  assert.equal(artifacts.length, 5);
  assert.equal(
    artifacts
      .filter((artifact) => artifact.kind === 'order-pdf')
      .every((artifact) =>
        /^receipt-80mm-order-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}\.pdf$/u.test(artifact.filename),
      ),
    true,
  );
  assert.match(
    artifacts.find((artifact) => artifact.kind === 'merged-pdf')?.filename ?? '',
    /^receipts-80mm-\d{4}-\d{2}-\d{2}-merged\.pdf$/u,
  );
  assert.match(
    artifacts.find((artifact) => artifact.kind === 'zip')?.filename ?? '',
    /^receipts-80mm-\d{4}-\d{2}-\d{2}\.zip$/u,
  );
  assert.equal(new Set(artifacts.map((artifact) => artifact.checksum)).size, artifacts.length);
  for (const artifact of artifacts) {
    const bytes = readPrivateDocumentArtifact(
      storageRoot,
      artifact.relativePath,
      artifact.checksum,
    );
    assert.equal(bytes.byteLength, artifact.byteSize);
  }
  const manifest = artifacts.find((artifact) => artifact.kind === 'manifest');
  assert.ok(manifest);
  const manifestText = readFileSync(join(storageRoot, manifest.relativePath), 'utf8');
  assert.match(manifestText, new RegExp(orderA.id));
  assert.match(manifestText, new RegExp(orderB.id));
  const zip = artifacts.find((artifact) => artifact.kind === 'zip');
  assert.ok(zip);
  assert.deepEqual(
    readPrivateDocumentArtifact(storageRoot, zip.relativePath, zip.checksum).subarray(0, 4),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  );
  assert.equal(store.getDocumentBatch(context, batch.id).templateVersion, 1);
});

test('document job resumes idempotently after a worker lease recovery', async () => {
  const batch = store.createDocumentBatch(context, {
    selectionId: selection.id,
    action: 'generate-label',
    templateId: template.id,
    idempotencyKey: 'document-job-integration-2',
  });
  const runner = createApiJobRunner(store, {
    concurrency: 1,
    leaseSeconds: 5,
    effects: { document: createDocumentEffect(store, storageRoot) },
  });
  store.startDocumentBatchForWorker(context, batch.id);
  const abandoned = store.claimNextDocumentItem(context, batch.id);
  assert.ok(abandoned);
  assert.equal(abandoned.status, 'running');
  const recovered = store.resumeDocumentBatchForWorker(context, batch.id);
  assert.equal(recovered.attemptCount, 2);
  assert.equal(store.listDocumentBatchItems(context, batch.id).items[0].status, 'queued');
  assert.equal(await runner.drain({ maxJobs: 1 }), 1);
  assert.equal(store.getDocumentBatch(context, batch.id).status, 'completed');
  const firstArtifacts = store.listDocumentArtifacts(context, { batchId: batch.id });
  assert.equal(firstArtifacts.filter((artifact) => artifact.kind === 'order-pdf').length, 2);
  assert.equal(store.getDocumentBatch(context, batch.id).attemptCount, 2);
  assert.equal(await runner.drain({ maxJobs: 1 }), 0);
});

test.after(() => {
  if (store.db.open) store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
