import type { DurableJob, JobExecutionContext } from '@woo-ops/application';
import { createHash } from 'node:crypto';
import type { SqliteStore } from '@woo-ops/persistence';
import type { ExportColumn } from '@woo-ops/exports';
import { renderCustomerRecoveryXlsx } from './customer-recovery-render.js';
import {
  writePrivateExport,
  readPrivateExport,
  privateExportRelativePath,
} from './export-files.js';

export const createCustomerRecoveryExportEffect =
  (store: SqliteStore, storageRoot: string) =>
  async (job: DurableJob, execution: JobExecutionContext, id: string) => {
    const context = { accountId: job.accountId, correlationId: execution.correlationId };
    let ownsReport = false;
    try {
      const report = store.customerRecoveryReportForWorker(context, id);
      if (report.job_id !== job.id) throw new Error('CUSTOMER_REPORT_JOB_MISMATCH');
      ownsReport = true;
      if (report.status === 'completed') return;
      if (await execution.isCancellationRequested()) throw new Error('JOB_CANCELLED');
      // The checksum is persisted before writing. A retry after a process/DB failure
      // can finish from verified private bytes without rebuilding a different ZIP timestamp.
      if (
        typeof report.file_path === 'string' &&
        typeof report.checksum === 'string' &&
        typeof report.filename === 'string'
      ) {
        let existing = false;
        try {
          readPrivateExport(storageRoot, report.file_path, report.checksum);
          existing = true;
        } catch (error) {
          if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
            throw error;
        }
        if (existing) {
          store.completeCustomerRecoveryReport(context, id, {
            filename: report.filename,
            filePath: report.file_path,
            checksum: report.checksum,
          });
          await execution.reportProgress(100);
          return;
        }
      }
      const snapshot = store.snapshotCustomerRecoveryReport(context, id);
      const rows: Record<string, unknown>[] = [];
      for (let offset = 0; ; offset += 250) {
        if (await execution.isCancellationRequested()) throw new Error('JOB_CANCELLED');
        const page = store.customerRecoverySnapshotPage(context, id, offset);
        rows.push(
          ...page.map((row) => ({
            report: {
              ...row,
              amount: (() => {
                const v = BigInt(String(row.totalMinor));
                const abs = v < 0n ? -v : v;
                return `${v < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
              })(),
              status:
                row.status === 'failed'
                  ? report.locale === 'ar'
                    ? 'فاشل'
                    : 'Failed'
                  : report.locale === 'ar'
                    ? 'ملغي'
                    : 'Cancelled',
              snapshotAt: snapshot.snapshot_at,
              lastSuccessAt:
                snapshot.sync_success_at ?? (report.locale === 'ar' ? 'غير متاح' : 'Unavailable'),
              freshness:
                snapshot.stale === 1
                  ? report.locale === 'ar'
                    ? 'البيانات متأخرة أو غير مكتملة'
                    : 'Stale or incomplete data'
                  : report.locale === 'ar'
                    ? 'حسب البيانات المتزامنة محليًا'
                    : 'Based on locally synchronized data',
            },
          })),
        );
        await execution.reportProgress(
          Math.min(
            70,
            10 + Math.floor((rows.length / Math.max(Number(snapshot.row_count), 1)) * 60),
          ),
        );
        if (page.length < 250) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const ar = report.locale === 'ar';
      const fields: [string, string, string, ExportColumn['type']][] = [
        ['name', 'الاسم بالكامل', 'Full name', 'text'],
        ['phone', 'الهاتف', 'Phone', 'text'],
        ['email', 'البريد الإلكتروني', 'Email', 'text'],
        ['governorate', 'المحافظة', 'Governorate', 'text'],
        ['orderNumber', 'رقم آخر طلب مستهدف', 'Latest matching order', 'text'],
        ['orderDate', 'تاريخ الطلب UTC', 'Order date UTC', 'date'],
        ['status', 'حالة الطلب', 'Order status', 'text'],
        ['amount', 'قيمة الطلب', 'Order amount', 'money'],
        ['currency', 'العملة', 'Currency', 'text'],
        ['products', 'المنتجات', 'Products', 'text'],
        ['failedCount', 'عدد الطلبات الملغية والفاشلة', 'Failed and cancelled attempts', 'number'],
        ['snapshotAt', 'وقت استخراج البيانات UTC', 'Snapshot time UTC', 'date'],
        ['lastSuccessAt', 'آخر مزامنة ناجحة UTC', 'Last successful sync UTC', 'date'],
        ['freshness', 'حداثة البيانات', 'Data freshness', 'text'],
      ];
      // Preserve the established application workbook engine and safety/formatting rules.
      const result = await renderCustomerRecoveryXlsx(
        {
          profile: {
            name: ar ? 'عملاء للمتابعة' : 'Customer follow-up',
            version: 1,
            format: 'xlsx',
            rowMode: 'order',
            columns: fields.map(([key, arabic, english, type]) => ({
              key: `report.${key}`,
              label: ar ? arabic : english,
              ...(type ? { type } : {}),
            })),
            filenameTemplate: `customer-follow-up-${String(snapshot.snapshot_at).slice(0, 10)}.xlsx`,
          },
          orders: rows,
          maxRows: 10_000,
        },
        execution,
      );
      if (await execution.isCancellationRequested()) throw new Error('JOB_CANCELLED');
      store.stageCustomerRecoveryFile(context, id, {
        filename: result.filename,
        filePath: privateExportRelativePath(context.accountId, id, 'xlsx'),
        checksum: createHash('sha256').update(result.bytes).digest('hex'),
      });
      const file = writePrivateExport(storageRoot, context.accountId, id, 'xlsx', result.bytes);
      store.completeCustomerRecoveryReport(context, id, {
        filename: result.filename,
        filePath: file.relativePath,
        checksum: file.checksum,
      });
      await execution.reportProgress(100);
    } catch (error) {
      if (ownsReport) store.failCustomerRecoveryReport(context, id);
      throw error;
    }
  };
