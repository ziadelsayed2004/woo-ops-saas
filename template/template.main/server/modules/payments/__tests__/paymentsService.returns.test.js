jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));

jest.mock('../../notifications/notificationsService', () => ({}));
jest.mock('../../audit/auditService', () => ({}));

const db = require('../../../db');
const paymentsService = require('../paymentsService');

describe('paymentsService return-adjusted balances', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.run.mockResolvedValue({ changes: 1 });
  });

  test('marks an invoice paid when payments cover its value after returns', async () => {
    db.get.mockResolvedValue({
      total_price: 100,
      returned_amount: 40,
      payment_status: 'partially_paid',
      payment_type: 'deferred'
    });
    db.all.mockResolvedValue([{ amount: 60 }]);

    await paymentsService.recalculatePaymentMetrics(7);

    expect(db.run).toHaveBeenCalledWith(
      'UPDATE invoices SET payment_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['paid', 7]
    );
  });

  test('prevents collecting more than the balance left after returns', async () => {
    db.get.mockImplementation(sql => {
      if (sql.includes('FROM payment_methods')) return Promise.resolve({ key: 'cash' });
      if (sql.includes('FROM invoices i')) {
        return Promise.resolve({
          total_price: 100,
          returned_amount: 40,
          payment_status: 'unpaid',
          outlet_id: 2,
          invoice_number: 'INV-1',
          archived_at: null
        });
      }
      return Promise.resolve(null);
    });
    db.all.mockResolvedValue([{ amount: 10 }]);

    await expect(paymentsService.recordPayment({
      invoiceId: 7,
      amount: 51,
      paymentMethod: 'cash',
      userId: 1
    })).rejects.toThrow('Remaining: 50');

    expect(db.exec).not.toHaveBeenCalled();
  });
});
