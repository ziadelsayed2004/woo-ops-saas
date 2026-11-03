import { Worker } from 'node:worker_threads';
import type { ExportRequest } from '@woo-ops/exports';
import type { JobExecutionContext } from '@woo-ops/application';

export async function renderCustomerRecoveryXlsx(
  input: ExportRequest,
  execution: JobExecutionContext,
): Promise<{ bytes: Uint8Array; filename: string }> {
  // Run XLSX compression off the HTTP/event-loop thread, without touching existing export jobs.
  const worker = new Worker(new URL('../dist/customer-recovery-xlsx-worker.js', import.meta.url), {
    workerData: input,
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancellation: ReturnType<typeof setInterval> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('CUSTOMER_REPORT_RENDER_TIMEOUT')), 120_000);
      cancellation = setInterval(() => {
        void Promise.resolve(execution.isCancellationRequested())
          .then((cancelled) => {
            if (cancelled || execution.signal.aborted) reject(new Error('JOB_CANCELLED'));
          })
          .catch(() => reject(new Error('CUSTOMER_REPORT_CANCEL_CHECK_FAILED')));
      }, 1000);
      worker.once('error', () => reject(new Error('CUSTOMER_REPORT_RENDER_FAILED')));
      worker.once('exit', () => reject(new Error('CUSTOMER_REPORT_RENDER_EXITED')));
      worker.once('message', (value: unknown) => {
        if (
          !value ||
          typeof value !== 'object' ||
          !('bytes' in value) ||
          !(value.bytes instanceof Uint8Array) ||
          !('filename' in value) ||
          typeof value.filename !== 'string'
        ) {
          reject(new Error('CUSTOMER_REPORT_RENDER_FAILED'));
          return;
        }
        resolve({ bytes: value.bytes, filename: value.filename });
      });
    });
  } finally {
    clearTimeout(timer);
    clearInterval(cancellation);
    await worker.terminate();
  }
}
