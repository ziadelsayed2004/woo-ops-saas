jest.mock('../../users/usersService', () => ({
  getUserRoles: jest.fn()
}));
jest.mock('../../authors/authorsService', () => ({
  getLinkedAuthorsForUser: jest.fn()
}));
jest.mock('../../outlets/outletsService', () => ({
  getLinkedOutletsForUser: jest.fn(),
  findById: jest.fn()
}));
jest.mock('../../finance/financeService', () => ({
  getLedgerHistory: jest.fn()
}));
jest.mock('html-pdf-node', () => ({ generatePdf: jest.fn() }));

const ExcelJS = require('exceljs');
const usersService = require('../../users/usersService');
const outletsService = require('../../outlets/outletsService');
const financeService = require('../../finance/financeService');
const exportsService = require('../exportsService');

describe('finance ledger export filters', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getUserRoles.mockResolvedValue([{ name: 'super_admin' }]);
    outletsService.findById.mockResolvedValue({ id: 12, name: 'منفذ القاهرة' });
    financeService.getLedgerHistory.mockResolvedValue([]);
  });

  test('exports all rows matching every supported ledger filter', async () => {
    const query = {
      outletId: '12',
      entryGroup: 'payments',
      entryType: 'payment_recorded',
      supplyStatus: 'not_supplied',
      startDate: '2026-08-01',
      endDate: '2026-08-10'
    };

    await exportsService.exportReport('finance-ledger', query, { id: 88 }, 'xlsx');

    expect(financeService.getLedgerHistory).toHaveBeenCalledWith({
      limit: 'all',
      outletId: '12',
      entryType: 'payment_recorded',
      entryGroup: 'payments',
      supplyStatus: 'not_supplied',
      startDate: '2026-08-01',
      endDate: '2026-08-10',
      outletIds: null
    });
  });

  test('writes readable Arabic filter labels into the Excel sheet', async () => {
    const buffer = await exportsService.exportReport('finance-ledger', {
      outletId: '12',
      entryGroup: 'settlements',
      entryType: 'manual_adjustment',
      supplyStatus: 'supplied',
      startDate: '2026-08-01',
      endDate: '2026-08-10'
    }, { id: 88 }, 'xlsx');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const filterSummary = workbook.worksheets[0].getCell('A3').value;

    expect(filterSummary).toContain('منفذ البيع: منفذ القاهرة');
    expect(filterSummary).toContain('تصنيف العملية: تسويات ومصروفات يدوية');
    expect(filterSummary).toContain('نوع الحركة: تسوية يدوية للذمم / الكاش');
    expect(filterSummary).toContain('حالة التوريد: مورد / نهائي');
    expect(filterSummary).toContain('من تاريخ: 2026-08-01');
    expect(filterSummary).toContain('إلى تاريخ: 2026-08-10');
  });

  test('keeps restricted users inside their linked outlet scope', async () => {
    usersService.getUserRoles.mockResolvedValue([{ name: 'outlet' }]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([7, 12]);

    await exportsService.exportReport('finance-ledger', {}, { id: 88 }, 'xlsx');

    expect(financeService.getLedgerHistory).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 'all', outletIds: [7, 12] })
    );
  });
});
