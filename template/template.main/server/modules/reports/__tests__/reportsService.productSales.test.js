jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn()
}));

const db = require('../../../db');
const reportsService = require('../reportsService');

describe('product sales report service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns product quantities grouped by governorate with all status buckets', async () => {
    db.all.mockResolvedValue([{ governorate: 'القاهرة', netQuantity: 8, paidQuantity: 3, partiallyPaidQuantity: 4, unpaidQuantity: 1 }]);

    const rows = await reportsService.getProductSalesByGovernorate({
      productId: 17,
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      governorate: 'القاهرة'
    });

    expect(rows[0].netQuantity).toBe(8);
    expect(db.all).toHaveBeenCalledWith(expect.stringContaining("ii.product_id = ?"), [17, '2026-01-01', '2026-01-31', 'القاهرة']);
  });

  test('requires a selected product', async () => {
    await expect(reportsService.getProductSalesByGovernorate({})).rejects.toThrow('Product ID is required');
  });

  test('scopes product options to linked authors', async () => {
    db.all.mockResolvedValue([]);
    await reportsService.getProductOptions({ authorIds: [4, 9] });
    expect(db.all).toHaveBeenCalledWith(expect.stringContaining('product_authors'), [4, 9]);
  });
});
