import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { SqliteStore, schemaVersion } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-document-templates-'));
const store = new SqliteStore(join(directory, 'documents.sqlite'));
const accountId = randomUUID();
const otherAccountId = randomUUID();
const actorId = randomUUID();
const otherActorId = randomUUID();
const now = new Date().toISOString();
for (const [id, name] of [
  [accountId, 'Document account'],
  [otherAccountId, 'Other document account'],
])
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(id, name, now, now);
for (const [id, email, account] of [
  [actorId, 'documents@example.test', accountId],
  [otherActorId, 'other-documents@example.test', otherAccountId],
]) {
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, email, 'test-hash', now, now);
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
const order = store.createManualOrder(context, {
  currency: 'EGP',
  customer: { name: 'Document customer' },
  lines: [{ name: 'Document product', quantity: 1, unitPriceMinor: '12500' }],
});

test('templates are versioned, account scoped, and reject executable or network content', () => {
  assert.equal(schemaVersion, 21);
  const template = store.createDocumentTemplate(context, {
    name: 'Invoice',
    format: 'a4',
    locale: 'en-US',
    direction: 'ltr',
    body: 'Order {{order.number}}',
    companyName: 'Woo Ops',
  });
  assert.equal(template.version, 1);
  assert.equal(store.listDocumentTemplates(otherContext).length, 0);
  assert.throws(
    () =>
      store.createDocumentTemplate(context, {
        name: 'Unsafe',
        format: 'a4',
        companyName: 'Woo Ops',
        body: '<script>alert(1)</script>',
      }),
    /DOCUMENT_TEMPLATE_UNSAFE/,
  );
  const updated = store.updateDocumentTemplate(context, template.id, {
    body: 'Order {{order.number}} total {{order.totalMinor}}',
  });
  assert.equal(updated.version, 2);
  assert.equal(
    store.db
      .prepare(
        'SELECT COUNT(*) AS count FROM document_template_revisions WHERE account_id = ? AND template_id = ?',
      )
      .get(accountId, template.id).count,
    2,
  );
  assert.throws(
    () => store.getDocumentTemplate(otherContext, template.id),
    /DOCUMENT_TEMPLATE_NOT_FOUND/,
  );
});

test('document files are checksum-bound and cannot cross account boundaries', () => {
  const template = store.listDocumentTemplates(context)[0];
  const bytes = Buffer.from('%PDF-document-fixture');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const file = store.registerDocumentFile(context, {
    id: 'file-1',
    orderId: order.id,
    templateId: template.id,
    format: 'a4',
    relativePath: `${accountId}/file-1.pdf`,
    filename: 'invoice-a4.pdf',
    byteSize: bytes.byteLength,
    checksum,
  });
  assert.equal(file.mimeType, 'application/pdf');
  assert.equal(store.getDocumentFile(context, file.id).checksum, checksum);
  assert.throws(() => store.getDocumentFile(otherContext, file.id), /DOCUMENT_FILE_NOT_FOUND/);
  assert.throws(
    () =>
      store.registerDocumentFile(context, {
        ...file,
        id: 'file-2',
        relativePath: '../outside.pdf',
      }),
    /DOCUMENT_FILE_PATH_INVALID/,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
