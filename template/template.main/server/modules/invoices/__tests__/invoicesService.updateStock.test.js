jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../../inventory/inventoryService', () => ({
  createTransaction: jest.fn()
}));
jest.mock('../../notifications/notificationsService', () => ({
  checkOutletCreditLimitNotifications: jest.fn(),
  checkStockNotifications: jest.fn()
}));
jest.mock('../../payments/paymentsService', () => ({
  recalculatePaymentMetrics: jest.fn()
}));

const db = require('../../../db');
const inventoryService = require('../../inventory/inventoryService');
const invoicesService = require('../invoicesService');

describe('invoice edit stock reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.exec.mockResolvedValue();
    db.run.mockResolvedValue({ changes: 1, lastID: 99 });
    db.all.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM invoice_items')) {
        return Promise.resolve([{ id: 12, invoice_id: 7, product_id: 5, quantity: 10, free_quantity: 0 }]);
      }
      return Promise.resolve([]);
    });
    db.get.mockImplementation((sql) => {
      if (sql.includes('SELECT * FROM invoices')) {
        return Promise.resolve({ id: 7, invoice_number: 'INV-7', outlet_id: 2, archived_at: null });
      }
      if (sql.includes('SELECT * FROM outlets')) {
        return Promise.resolve({ id: 2, name: 'Outlet', status: 'active', outlet_type_id: 3 });
      }
      if (sql.includes('SELECT * FROM products')) {
        return Promise.resolve({ id: 5, title: 'Book', status: 'active', stock_policy: 'track' });
      }
      if (sql.includes('SELECT price FROM product_prices')) return Promise.resolve({ price: 20 });
      if (sql.includes('FROM invoices i')) return Promise.resolve({ id: 7, invoice_number: 'INV-7' });
      return Promise.resolve(null);
    });
  });

  test('matches a numeric stored product to a string request id and restores only the reduced quantity', async () => {
    await invoicesService.updateInvoice(7, {
      outletId: 2,
      items: [{ productId: '5', quantity: 7 }],
      userId: 4
    });

    expect(inventoryService.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      productId: 5,
      transactionType: 'return',
      quantity: 3,
      referenceType: 'invoice',
      referenceId: 7
    }));
    expect(db.run.mock.calls.some(([sql]) => sql.includes('INSERT INTO invoice_items'))).toBe(false);
    expect(db.run.mock.calls.some(([sql]) => sql.includes('DELETE FROM invoice_items'))).toBe(false);
  });
});
