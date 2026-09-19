jest.mock('../../../db', () => ({
  get: jest.fn(),
  all: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../../notifications/notificationsService', () => ({
  checkStockNotifications: jest.fn()
}));

const db = require('../../../db');
const inventoryService = require('../inventoryService');

function setupReceipt({ stock = 10, itemQuantity = 10 } = {}) {
  const receipt = { id: 1, status: 'active', receipt_number: 'REC-1' };
  const item = { id: 7, receipt_id: 1, product_id: 3, quantity: itemQuantity, product_title: 'كتاب تجريبي' };
  let detailItemCall = 0;
  db.get.mockImplementation(async (sql) => {
    if (sql.includes('SUM(quantity)') && sql.includes('inventory_transactions')) return { stock };
    if (sql.includes('as received_quantity')) return { received_quantity: itemQuantity, returned_quantity: 4 };
    if (sql.includes('FROM inventory_receipts')) return receipt;
    return null;
  });
  db.all.mockImplementation(async (sql) => {
    if (sql.includes('FROM inventory_receipt_items ri') && sql.includes('p.title')) {
      if (detailItemCall++ === 0) return [item];
      return [];
    }
    if (sql.includes('FROM inventory_receipt_returns')) return [];
    return [];
  });
  db.run.mockResolvedValue({ lastID: 12, changes: 1 });
  db.exec.mockResolvedValue(undefined);
  return { receipt, item };
}

describe('inventory receipt reversal service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('cancels an active receipt and writes compensating ledger entries', async () => {
    setupReceipt();
    const result = await inventoryService.cancelReceipt(1, { reason: 'تم التسجيل بالخطأ', userId: 5 });

    expect(db.exec).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION;');
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining("status = 'cancelled'"), [5, 'تم التسجيل بالخطأ', 1]);
    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO inventory_transactions'), [3, 'receipt_cancellation', -10, 'receipt', 1, 5]);
    expect(db.exec).toHaveBeenLastCalledWith('COMMIT;');
    expect(result).toEqual(expect.objectContaining({ id: 1, status: 'active' }));
  });

  test('allows cancellation even when it makes current stock negative', async () => {
    setupReceipt({ stock: -4 });
    await expect(inventoryService.cancelReceipt(1, { reason: 'تصحيح توريد خاطئ', userId: 5 }))
      .resolves.toEqual(expect.objectContaining({ id: 1 }));

    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO inventory_transactions'), [3, 'receipt_cancellation', -10, 'receipt', 1, 5]);
    expect(db.get).not.toHaveBeenCalledWith(expect.stringContaining('SUM(quantity)'), [3]);
  });

  test('allows a partial supplier return regardless of current stock', async () => {
    setupReceipt({ stock: -8 });
    await expect(inventoryService.createSupplierReturn(1, {
      returnDate: '2026-08-05',
      reason: 'تصحيح جزئي',
      items: [{ receiptItemId: 7, quantity: 4 }],
      userId: 5
    })).resolves.toEqual(expect.objectContaining({ id: 1 }));

    expect(db.run).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO inventory_transactions'), [3, 'supplier_return', -4, 'receipt_return', 12, 5]);
    expect(db.get).not.toHaveBeenCalledWith(expect.stringContaining('SUM(quantity)'), [3]);
  });
});
