jest.mock('../../inventory/inventoryMetricsService', () => ({
  getAllProductMetrics: jest.fn()
}));

const inventoryMetricsService = require('../../inventory/inventoryMetricsService');
const reportsService = require('../reportsService');

describe('stock report net sales calculation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('maps the shared current-record metrics into the report contract', async () => {
    inventoryMetricsService.getAllProductMetrics.mockResolvedValue([{
      id: 1,
      title: 'Book',
      code: 'B-1',
      netReceived: 10,
      invoicedSales: 12,
      customerReturns: 2,
      netSales: 10,
      totalShipped: 4,
      stockBalance: 0,
      availableToShip: 6
    }]);

    const rows = await reportsService.getStockReport();

    expect(inventoryMetricsService.getAllProductMetrics).toHaveBeenCalledWith({
      search: '', category: '', status: '', authorIds: null
    });
    expect(rows[0]).toEqual(expect.objectContaining({
      productId: 1,
      productTitle: 'Book',
      productCode: 'B-1',
      totalSold: 12,
      totalReturned: 2,
      netSales: 10,
      totalShipped: 4,
      currentStock: 0,
      availableToShip: 6
    }));
  });
});
