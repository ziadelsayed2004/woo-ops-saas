import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { SqliteStore } from '@woo-ops/persistence';
import { createExportEffect } from '../src/export-effect.js';
import { createApiJobRunner } from '../src/job-runner.js';
import { readPrivateExport } from '../src/export-files.js';

const directory = mkdtempSync(join(tmpdir(), 'customer-report-'));
const store = new SqliteStore(':memory:');
const accountId = randomUUID(),
  actorId = randomUUID(),
  connectionId = randomUUID();
const now = new Date().toISOString();
const context = { accountId, actorId, role: 'admin', correlationId: randomUUID() };
store.db
  .prepare('INSERT INTO accounts (id,name,created_at,updated_at) VALUES (?,?,?,?)')
  .run(accountId, 'Synthetic', now, now);
store.db
  .prepare('INSERT INTO users (id,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run(actorId, `${actorId}@example.test`, 'fixture', now, now);
store.db
  .prepare(
    "INSERT INTO account_memberships (account_id,user_id,role,created_at) VALUES (?,?,'admin',?)",
  )
  .run(accountId, actorId, now);
store.db
  .prepare(
    "INSERT INTO connections (id,account_id,platform,store_url,status,created_at,updated_at) VALUES (?,?,'woocommerce','https://example.test','active',?,?)",
  )
  .run(connectionId, accountId, now, now);
const orderId = store.upsertRemoteOrder(context, connectionId, {
  externalOrderId: '1',
  orderNumber: '001',
  remoteStatus: 'failed',
  currency: 'EGP',
  grandTotalMinor: '12550',
  createdAt: '2026-10-01T10:00:00.000Z',
  modifiedAt: now,
  customer: { first_name: '=2+2', email: 'qa@example.test', phone: '01055127111' },
  billing: {},
  shipping: { governorateNameAr: 'القاهرة' },
  lines: [{ name: 'منتج', quantity: 1, unitPriceMinor: '12550' }],
  refunds: [],
  sourceJson: '{}',
  sourceHash: 'one',
});
const effect = createExportEffect(store, directory);
const execution = {
  accountId,
  correlationId: randomUUID(),
  signal: new AbortController().signal,
  isCancellationRequested: () => false,
  reportProgress: () => undefined,
};
const create = (filter) =>
  store.createCustomerRecoveryReport(context, {
    filter,
    locale: 'ar',
    idempotencyKey: randomUUID(),
  });
const job = (report) => ({
  id: report.jobId,
  accountId,
  type: 'export.generate',
  payload: { customerReportId: report.id },
});
const read = async (report) => {
  const file = store.customerRecoveryDownload(context, report.id);
  const bytes = readPrivateExport(directory, file.filePath, file.checksum);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  return { wb, file, bytes };
};

test('customer report uses the durable export runner, private files and unchanged order state', async () => {
  const report = create({});
  const runner = createApiJobRunner(store, { effects: { export: effect }, concurrency: 1 });
  await runner.drain({ maxJobs: 1 });
  assert.equal(store.getJob(context, report.jobId).status, 'succeeded');
  const { wb, bytes } = await read(report);
  const sheet = wb.worksheets[0];
  assert.equal(sheet.name, 'عملاء للمتابعة');
  assert.equal(sheet.rowCount, 2);
  assert.equal(sheet.getCell('A2').value, "'=2+2");
  assert.equal(sheet.getCell('B2').value, '01055127111');
  assert.equal(sheet.getCell('B2').numFmt, '@');
  assert.equal(sheet.getCell('D2').value, 'القاهرة');
  assert.equal(sheet.getCell('H2').value, '125.50');
  assert.equal(sheet.getCell('F2').value.toISOString(), '2026-10-01T10:00:00.000Z');
  assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFF1F3F5');
  assert.equal(sheet.getCell('K2').value, 1);
  assert.equal(sheet.getRow(1).alignment.wrapText, true);
  const initial = store.getOrder(context, orderId);
  assert.equal(initial.exportState, 'never-exported');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM order_export_events').get().n, 0);
  await effect(job(report), execution);
  assert.deepEqual((await read(report)).bytes, bytes);
  assert.equal(store.getOrder(context, orderId).exportState, initial.exportState);
});

test('retry after writing the file reuses the immutable snapshot without write conflicts', async () => {
  const report = create({});
  const original = store.completeCustomerRecoveryReport.bind(store);
  let first = true;
  store.completeCustomerRecoveryReport = (...args) => {
    if (first) {
      first = false;
      throw new Error('fixture persistence outage');
    }
    return original(...args);
  };
  await assert.rejects(effect(job(report), execution), /fixture persistence outage/);
  const snapshot = store.customerRecoverySnapshotPage(context, report.id);
  assert.equal(snapshot.length, 1);
  store.db.prepare("UPDATE orders SET remote_status = 'completed' WHERE id = ?").run(orderId);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await effect(job(report), execution);
  assert.deepEqual(store.customerRecoverySnapshotPage(context, report.id), snapshot);
  assert.equal((await read(report)).wb.worksheets[0].rowCount, 2);
  store.completeCustomerRecoveryReport = original;
});

test('wrong-job ownership does not modify a report and cancellation is visible', async () => {
  const report = create({ search: 'not-matched' });
  await assert.rejects(effect({ ...job(report), id: randomUUID() }, execution), /JOB_MISMATCH/);
  assert.equal(store.customerRecoveryReportForWorker(context, report.id).status, 'queued');
  await assert.rejects(
    effect(job(report), { ...execution, isCancellationRequested: () => true }),
    /JOB_CANCELLED/,
  );
  assert.equal(store.customerRecoveryReportForWorker(context, report.id).status, 'failed');
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
