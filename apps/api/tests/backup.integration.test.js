import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';
import { createBackup, listBackups, restoreBackup, validateBackup } from '../src/backup.ts';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const createFixture = () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'woo-backup-'));
  const databasePath = join(dataDirectory, 'woo-ops.sqlite');
  const store = new SqliteStore(databasePath);
  const accountId = randomUUID();
  const actorId = randomUUID();
  const now = new Date().toISOString();
  store.db
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, 'Backup account', now, now);
  store.db
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(actorId, 'backup@example.test', 'fixture-hash', now, now);
  store.db
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(accountId, actorId, 'admin', now);
  return {
    dataDirectory,
    databasePath,
    store,
    accountId,
    actorId,
    context: { accountId, actorId, correlationId: randomUUID(), role: 'admin' },
  };
};

test('backup and restore preserve local order sequences, documents, and exports', async () => {
  const fixture = createFixture();
  const { dataDirectory, databasePath, store, accountId, context } = fixture;
  try {
    const order = store.createManualOrder(context, {
      currency: 'EGP',
      customer: { name: 'Backup customer' },
      lines: [{ name: 'Backup product', sku: 'B-1', quantity: 1, unitPriceMinor: '12500' }],
    });
    const template = store.createDocumentTemplate(context, {
      name: 'Invoice',
      format: 'a4',
      locale: 'ar-EG',
      direction: 'rtl',
      companyName: 'Woo Ops',
      body: 'Order {{order.number}}',
    });
    const pdf = Buffer.from('%PDF-backup-fixture');
    const pdfRelativePath = `${accountId}/invoice-1.pdf`;
    const pdfPath = join(dataDirectory, 'private-documents', pdfRelativePath);
    mkdirSync(join(dataDirectory, 'private-documents', accountId), { recursive: true });
    writeFileSync(pdfPath, pdf);
    store.registerDocumentFile(context, {
      id: 'document-file-1',
      orderId: order.id,
      templateId: template.id,
      format: 'a4',
      relativePath: pdfRelativePath,
      filename: 'invoice-1.pdf',
      byteSize: pdf.byteLength,
      checksum: sha256(pdf),
    });
    const selection = store.createSelection(context, { mode: 'explicit', orderIds: [order.id] });
    const profile = store.createExportProfile(context, { name: 'Courier' });
    const version = store.createExportProfileVersion(context, profile.id, {
      format: 'csv',
      rowMode: 'order',
      columns: [{ key: 'orderNumber', label: 'Order', type: 'text' }],
      filenameTemplate: 'courier-{format}',
    });
    const batch = store.createExportBatch(context, {
      selectionId: selection.id,
      profileVersionId: version.id,
      idempotencyKey: 'backup-export-1',
    });
    store.completeExportBatch(context, batch.id, {
      orderCount: 1,
      rowCount: 1,
      filename: 'courier.csv',
      filePath: 'exports/courier.csv',
      checksum: 'a'.repeat(64),
    });

    const manifest = await createBackup({ dataDirectory, databasePath, database: store.db });
    assert.equal(manifest.schemaVersion, 17);
    assert.equal(
      manifest.files.some((file) => file.path === `private-documents/${pdfRelativePath}`),
      true,
    );
    assert.deepEqual(
      (await validateBackup({ dataDirectory, databasePath, backupId: manifest.id })).manifest,
      manifest,
    );
    assert.equal(
      (await restoreBackup({ dataDirectory, databasePath, backupId: manifest.id })).dryRun,
      true,
    );

    store.createManualOrder(context, {
      currency: 'EGP',
      customer: { name: 'Changed after backup' },
      lines: [{ name: 'Changed product', quantity: 1, unitPriceMinor: '2500' }],
    });
    const stalePath = join(dataDirectory, 'private-documents', accountId, 'stale.pdf');
    writeFileSync(stalePath, 'stale');
    store.db.close();

    const result = await restoreBackup({
      dataDirectory,
      databasePath,
      backupId: manifest.id,
      dryRun: false,
    });
    assert.equal(result.restored, true);
    assert.equal(existsSync(stalePath), false);
    assert.deepEqual(readFileSync(pdfPath), pdf);

    const restoredStore = new SqliteStore(databasePath);
    const restoredOrder = restoredStore.getOrder(context, order.id);
    assert.equal(restoredOrder?.orderNumber, order.orderNumber);
    assert.equal(restoredStore.listDocumentTemplates(context).length, 1);
    assert.equal(restoredStore.listDocumentFiles(context, order.id).length, 1);
    assert.equal(restoredStore.listExportBatches(context).length, 1);
    const nextOrder = restoredStore.createManualOrder(context, {
      currency: 'EGP',
      customer: { name: 'Sequence customer' },
      lines: [{ name: 'Next product', quantity: 1, unitPriceMinor: '100' }],
    });
    assert.equal(nextOrder.orderNumber, 'MAN-000002');
    restoredStore.db.close();
  } finally {
    if (store.db.open) store.db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});

test('backup retention and checksum validation reject tampering and unsafe ids', async () => {
  const fixture = createFixture();
  const { dataDirectory, databasePath, store } = fixture;
  try {
    await createBackup({
      dataDirectory,
      databasePath,
      database: store.db,
      retention: 7,
    });
    const second = await createBackup({
      dataDirectory,
      databasePath,
      database: store.db,
      retention: 7,
    });
    const manifestPath = join(dataDirectory, 'backups', second.id, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.database.checksum = 'b'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    await assert.rejects(
      validateBackup({ dataDirectory, databasePath, backupId: second.id }),
      /BACKUP_CHECKSUM_MISMATCH/,
    );
    const third = await createBackup({
      dataDirectory,
      databasePath,
      database: store.db,
      retention: 2,
    });
    assert.equal(listBackups(dataDirectory).length, 2);
    await assert.rejects(
      validateBackup({ dataDirectory, databasePath, backupId: '../outside' }),
      /BACKUP_ID_INVALID/,
    );
    assert.deepEqual(
      listBackups(dataDirectory)
        .map((backup) => backup.id)
        .sort(),
      [second.id, third.id].sort(),
    );
  } finally {
    if (store.db.open) store.db.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
