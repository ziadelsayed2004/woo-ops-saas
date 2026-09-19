jest.mock('../invoiceTrashService', () => ({
  purgeExpiredTrash: jest.fn()
}));

const service = require('../invoiceTrashService');
const scheduler = require('../invoiceTrashScheduler');

describe('invoice trash scheduler', () => {
  afterEach(() => {
    scheduler.stopInvoiceTrashCleanup();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  test('skips overlapping cleanup runs', async () => {
    let resolveCleanup;
    service.purgeExpiredTrash.mockImplementation(() => new Promise(resolve => {
      resolveCleanup = resolve;
    }));

    const firstRun = scheduler.runInvoiceTrashCleanup();
    await Promise.resolve();
    await expect(scheduler.runInvoiceTrashCleanup()).resolves.toEqual({ skipped: true });
    resolveCleanup({ deleted: 0, failed: 0 });
    await expect(firstRun).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(service.purgeExpiredTrash).toHaveBeenCalledTimes(1);
  });

  test('runs immediately and then once per hour', async () => {
    jest.useFakeTimers();
    service.purgeExpiredTrash.mockResolvedValue({ deleted: 0, failed: 0 });

    scheduler.scheduleInvoiceTrashCleanup();
    await Promise.resolve();
    expect(service.purgeExpiredTrash).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(scheduler.CLEANUP_INTERVAL_MS);
    expect(service.purgeExpiredTrash).toHaveBeenCalledTimes(2);
  });
});
