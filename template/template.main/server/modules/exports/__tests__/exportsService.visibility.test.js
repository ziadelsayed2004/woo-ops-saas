jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn()
}));
jest.mock('html-pdf-node', () => ({ generatePdf: jest.fn() }));

const db = require('../../../db');
const exportsService = require('../exportsService');

describe('invoice export SQL visibility filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.all.mockResolvedValue([]);
  });

  test.each([
    ['exportInvoices', {}],
    ['exportInvoiceItems', {}]
  ])('applies scope and requested filters together in %s', async (method, query) => {
    await exportsService[method](
      { ...query, shippingStatus: method === 'exportInvoices' ? 'shipped' : undefined },
      'csv',
      {
        allowedShippingStatuses: ['pending', 'partially_shipped'],
        excludeCancelled: true
      }
    );

    expect(db.all).toHaveBeenCalledTimes(1);
    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('i.shipping_status IN (?, ?)');
    expect(sql).toContain('i.payment_status != ?');
    expect(params.slice(0, 3)).toEqual(['pending', 'partially_shipped', 'cancelled']);

    if (method === 'exportInvoices') {
      expect(sql).toContain('i.shipping_status = ?');
      expect(params).toEqual(['pending', 'partially_shipped', 'cancelled', 'shipped']);
    }
  });

  test('intersects invoice exports with linked author and outlet scope', async () => {
    await exportsService.exportInvoices({}, 'csv', {
      authorIds: [7, 8],
      outletIds: [3]
    });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('i.outlet_id IN (?)');
    expect(sql).toContain('JOIN product_authors scope_pa');
    expect(sql).toContain('scope_pa.author_id IN (?, ?)');
    expect(params).toEqual([3, 7, 8]);
  });

  test('limits invoice-item exports to the linked author products', async () => {
    await exportsService.exportInvoiceItems({}, 'csv', { authorIds: [5] });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('scope_pa.product_id = ii.product_id');
    expect(sql).toContain('scope_pa.author_id IN (?)');
    expect(params).toEqual([5]);
  });
});
