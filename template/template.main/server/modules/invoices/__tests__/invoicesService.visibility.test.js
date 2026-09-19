jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));

const db = require('../../../db');
const invoicesService = require('../invoicesService');

describe('invoicesService invoice visibility filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.all.mockResolvedValue([]);
  });

  test('intersects an explicit completed filter with the restricted scope before pagination', async () => {
    await invoicesService.getInvoices({
      shippingStatus: 'shipped',
      allowedShippingStatuses: ['pending', 'partially_shipped'],
      excludeCancelled: true,
      limit: 10,
      offset: 20
    });

    expect(db.all).toHaveBeenCalledTimes(1);
    const [sql, params] = db.all.mock.calls[0];

    expect(sql).toContain('i.shipping_status IN (?,?)');
    expect(sql).toContain("i.payment_status != 'cancelled'");
    expect(sql).toContain('i.shipping_status = ?');
    expect(sql.indexOf('i.shipping_status IN (?,?)')).toBeLessThan(sql.indexOf('LIMIT ? OFFSET ?'));
    expect(sql.indexOf("i.payment_status != 'cancelled'")).toBeLessThan(sql.indexOf('LIMIT ? OFFSET ?'));
    expect(params).toEqual(['pending', 'partially_shipped', 'shipped', 10, 20]);
  });

  test('turns an explicitly empty allowed-status scope into an always-empty query', async () => {
    await invoicesService.getInvoices({
      allowedShippingStatuses: [],
      limit: 5,
      offset: 0
    });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('AND 0=1');
    expect(params).toEqual([5, 0]);
  });

  test('applies the shipped invoice filter directly', async () => {
    await invoicesService.getInvoices({ shippingStatus: 'shipped', limit: 5, offset: 0 });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('i.shipping_status = ?');
    expect(params).toEqual(['shipped', 5, 0]);
  });

  test('subtracts approved returns when selecting and filtering the remaining balance', async () => {
    await invoicesService.getInvoices({ hasRemaining: 'yes', minRemaining: 10, maxRemaining: 100 });

    const [sql] = db.all.mock.calls[0];
    expect(sql).toContain("WHERE status != 'cancelled'");
    expect(sql).toContain('as net_amount');
    expect(sql).toContain('i.total_price - COALESCE(r.returned_amount, 0) - COALESCE(p.paid_amount, 0)');
  });

  test('does not load payment rows or payment status history when excluded', async () => {
    db.get.mockResolvedValue({
      id: 42,
      outlet_id: 3,
      shipping_status: 'pending',
      payment_status: 'unpaid',
      paid_amount: 0,
      remaining_amount: 100
    });
    db.all.mockResolvedValue([]);

    const invoice = await invoicesService.getInvoiceById(42, { includePayments: false });

    const allSql = db.all.mock.calls.map(([sql]) => sql);
    expect(allSql.some(sql => sql.includes('FROM invoice_payments ip'))).toBe(false);
    expect(allSql.some(sql => sql.includes("ish.status_type != 'payment'"))).toBe(true);
    expect(invoice.payments).toBeUndefined();
    expect(invoice.remaining_amount).toBe(100);
  });

  test('loads linked author IDs with invoice visibility records', async () => {
    db.all.mockResolvedValue([{
      id: 42,
      outlet_id: 3,
      payment_status: 'unpaid',
      shipping_status: 'pending',
      author_ids: '2,5'
    }]);

    const records = await invoicesService.getInvoiceVisibilityRecords([42]);

    expect(records[0].author_ids).toEqual([2, 5]);
    expect(db.all.mock.calls[0][0]).toContain('GROUP_CONCAT(DISTINCT pa.author_id)');
  });
});
