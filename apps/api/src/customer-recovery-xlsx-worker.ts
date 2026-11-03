import { parentPort, workerData } from 'node:worker_threads';
import { generateXlsx, type ExportRequest } from '@woo-ops/exports';

// Only internally constructed snapshots/profile data enter this worker. No DB or connector access.
try {
  const request = workerData as ExportRequest;
  const bytes = await generateXlsx(request.orders, request.profile, 'customer-report');
  parentPort?.postMessage({ bytes, filename: request.profile.filenameTemplate });
} catch {
  parentPort?.postMessage({ error: 'CUSTOMER_REPORT_RENDER_FAILED' });
}
