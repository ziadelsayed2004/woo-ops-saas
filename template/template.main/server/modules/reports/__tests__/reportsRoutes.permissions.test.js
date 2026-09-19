const express = require('express');
const request = require('supertest');

jest.mock('../reportsService', () => ({
  getFinancialSummary: jest.fn(),
  getBalancesByOutlet: jest.fn(),
  getBalancesByGovernorate: jest.fn(),
  getBalancesByOutletType: jest.fn(),
  getStockReport: jest.fn(),
  getAuthorReport: jest.fn(),
  getReceiptReport: jest.fn(),
  getProductOptions: jest.fn(),
  getProductSalesByGovernorate: jest.fn()
}));
jest.mock('../../users/usersService', () => ({
  getUserRoles: jest.fn()
}));
jest.mock('../../authors/authorsService', () => ({
  getLinkedAuthorsForUser: jest.fn()
}));
jest.mock('../../outlets/outletsService', () => ({
  getLinkedOutletsForUser: jest.fn()
}));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: permission => (req, res, next) => {
    if (req.allowedPermissions.has(permission)) return next();
    return res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
  }
}));

const reportsService = require('../reportsService');
const usersService = require('../../users/usersService');
const authorsService = require('../../authors/authorsService');
const outletsService = require('../../outlets/outletsService');
const reportsRouter = require('../reportsRoutes');

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { id: 14 } };
    req.allowedPermissions = new Set(
      String(req.headers['x-test-permissions'] || '').split(',').filter(Boolean)
    );
    next();
  });
  app.use('/api/reports', reportsRouter);
  return app;
}

describe('report route permission separation', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getUserRoles.mockResolvedValue([{ name: 'assistant' }]);
    authorsService.getLinkedAuthorsForUser.mockResolvedValue([]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([]);
    Object.values(reportsService).forEach(mock => mock.mockResolvedValue([]));
  });

  test.each([
    '/api/reports/financials/summary',
    '/api/reports/financials/by-outlet',
    '/api/reports/financials/by-governorate',
    '/api/reports/financials/by-outlet-type'
  ])('financial endpoint %s requires finance.view as well as reports.view', async path => {
    const response = await request(app)
      .get(path)
      .set('x-test-permissions', 'reports.view');

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('finance.view');
  });

  test('financial reports are available when both read permissions are present', async () => {
    const response = await request(app)
      .get('/api/reports/financials/summary')
      .set('x-test-permissions', 'reports.view,finance.view');

    expect(response.status).toBe(200);
    expect(reportsService.getFinancialSummary).toHaveBeenCalled();
  });

  test('operational reports remain available with reports.view alone', async () => {
    const response = await request(app)
      .get('/api/reports/stock')
      .set('x-test-permissions', 'reports.view');

    expect(response.status).toBe(200);
    expect(reportsService.getStockReport).toHaveBeenCalled();
  });

  test('product sales analytics remain available without finance.view', async () => {
    const response = await request(app)
      .get('/api/reports/product-sales?productId=7')
      .set('x-test-permissions', 'reports.view');

    expect(response.status).toBe(200);
    expect(reportsService.getProductSalesByGovernorate).toHaveBeenCalledWith(expect.objectContaining({ productId: 7 }));
  });

  test('product analytics options require reports.view', async () => {
    const response = await request(app).get('/api/reports/product-options');
    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('reports.view');
  });
});
