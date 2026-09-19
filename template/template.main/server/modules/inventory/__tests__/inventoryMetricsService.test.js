jest.mock('../../../db', () => ({
  all: jest.fn()
}));

const db = require('../../../db');
const metricsService = require('../inventoryMetricsService');

describe('inventory metrics source of truth', () => {
  beforeEach(() => jest.clearAllMocks());

  test('derives sales and returns from current invoice records, not legacy return movements', async () => {
    db.all.mockResolvedValue([{
      id: 1,
      title: 'Book',
      code: 'B-1',
      netReceived: 16005,
      totalAdjusted: 0,
      invoicedSales: 24666,
      customerReturns: 0,
      totalShipped: 16638,
      netSales: 24666,
      stockBalance: -8661,
      rawAvailableToShip: -633,
      availableToShip: 0,
      remainingToFulfill: 8028,
      shippingSupplyGap: 633
    }]);

    const row = await metricsService.getProductMetrics(1);
    const [sql] = db.all.mock.calls[0];

    expect(sql).toContain('FROM invoice_items ii');
    expect(sql).toContain('FROM return_items ri');
    expect(sql).not.toContain("transaction_type = 'return'");
    expect(row).toEqual(expect.objectContaining({
      netSales: 24666,
      stockBalance: -8661,
      availableToShip: 0,
      shippingSupplyGap: 633,
      shippableStockBalance: -633,
      remainingToShip: 8028,
      supplyRequiredToFulfill: 8661,
      currentStock: -8661,
      totalSold: 24666,
      totalReturned: 0
    }));
  });

  test('supports filtered, paginated product summaries', async () => {
    db.all.mockResolvedValue([]);

    await metricsService.getAllProductMetrics({ search: 'book', status: 'active', limit: 25, offset: 50 });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('(p.title LIKE ? OR p.code LIKE ?)');
    expect(sql).toContain('p.status = ?');
    expect(sql).toContain('LIMIT ? OFFSET ?');
    expect(params).toEqual(['%book%', '%book%', 'active', 25, 50]);
  });
});
