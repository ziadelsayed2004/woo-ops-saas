const invoiceTrashService = require('./invoiceTrashService');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let cleanupTimer = null;
let cleanupRunning = false;

async function runInvoiceTrashCleanup() {
  if (cleanupRunning) return { skipped: true };
  cleanupRunning = true;
  try {
    const result = await invoiceTrashService.purgeExpiredTrash();
    if (result.deleted > 0 || result.failed > 0) {
      console.log(`Invoice trash cleanup completed: ${result.deleted} purged, ${result.failed} failed.`);
    }
    return result;
  } catch (error) {
    console.error('Invoice trash cleanup failed:', error);
    return { deleted: 0, failed: 1, error: error.message };
  } finally {
    cleanupRunning = false;
  }
}

function scheduleInvoiceTrashCleanup() {
  if (cleanupTimer) return cleanupTimer;
  void runInvoiceTrashCleanup();
  cleanupTimer = globalThis.setInterval(() => {
    void runInvoiceTrashCleanup();
  }, CLEANUP_INTERVAL_MS);
  console.log('Invoice trash cleanup scheduler started (30-day retention, hourly checks).');
  return cleanupTimer;
}

function stopInvoiceTrashCleanup() {
  if (!cleanupTimer) return;
  globalThis.clearInterval(cleanupTimer);
  cleanupTimer = null;
}

module.exports = {
  CLEANUP_INTERVAL_MS,
  runInvoiceTrashCleanup,
  scheduleInvoiceTrashCleanup,
  stopInvoiceTrashCleanup
};
