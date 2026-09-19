const express = require('express');
const request = require('supertest');

jest.mock('../exportsService', () => ({
  exportProducts: jest.fn(),
  exportPrices: jest.fn(),
  exportAuthors: jest.fn(),
  exportOutlets: jest.fn(),
  exportInvoices: jest.fn(),
  exportInvoiceItems: jest.fn(),
  exportPayments: jest.fn(),
  exportInventory: jest.fn(),
  exportReturns: jest.fn(),
  exportShipments: jest.fn(),
  exportCourierSheet: jest.fn(),
  exportOutletStatement: jest.fn(),
  exportReport: jest.fn()
}));
jest.mock('../../users/usersService', () => ({
  getUserRoles: jest.fn(),
  getUserPermissions: jest.fn()
}));
jest.mock('../../authors/authorsService', () => ({ getLinkedAuthorsForUser: jest.fn() }));
jest.mock('../../outlets/outletsService', () => ({ getLinkedOutletsForUser: jest.fn() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: () => (_req, _res, next) => next()
}));
jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

const exportsService = require('../exportsService');
const usersService = require('../../users/usersService');
const authorsService = require('../../authors/authorsService');
const outletsService = require('../../outlets/outletsService');
const exportsRouter = require('../exportsRoutes');

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { id: 88 } };
    next();
  });
  app.use('/api/exports', exportsRouter);
  return app;
}

describe('invoice export route access scope', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getUserRoles.mockResolvedValue([{ name: 'shipping_user' }]);
    usersService.getUserPermissions.mockResolvedValue([]);
    authorsService.getLinkedAuthorsForUser.mockResolvedValue([]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([]);
    exportsService.exportInvoices.mockResolvedValue('invoice csv');
    exportsService.exportInvoiceItems.mockResolvedValue('item csv');
    exportsService.exportReport.mockResolvedValue('report csv');
  });

  test.each([
    ['/api/exports/invoices', 'exportInvoices'],
    ['/api/exports/invoice-items', 'exportInvoiceItems']
  ])('passes the restricted scope through %s', async (path, serviceMethod) => {
    const response = await request(app)
      .get(path)
      .query({ format: 'csv', shippingStatus: 'shipped' });

    expect(response.status).toBe(200);
    expect(exportsService[serviceMethod]).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'csv', shippingStatus: 'shipped' }),
      'csv',
      {
        allowedShippingStatuses: ['pending', 'partially_shipped'],
        excludeCancelled: true,
        authorIds: null,
        outletIds: null
      }
    );
  });

  test('lets the global readonly role override an operational invoice-state restriction', async () => {
    usersService.getUserRoles.mockResolvedValue([
      { name: 'inventory_manager' },
      { name: 'readonly_viewer' }
    ]);

    const response = await request(app).get('/api/exports/invoices?format=csv');

    expect(response.status).toBe(200);
    expect(exportsService.exportInvoices).toHaveBeenCalledWith(
      expect.any(Object),
      'csv',
      {
        allowedShippingStatuses: null,
        excludeCancelled: false,
        authorIds: null,
        outletIds: null
      }
    );
  });

  test('passes linked author and outlet scope to invoice exports', async () => {
    usersService.getUserRoles.mockResolvedValue([{ name: 'author' }, { name: 'outlet' }]);
    authorsService.getLinkedAuthorsForUser.mockResolvedValue([4]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([9]);

    const response = await request(app).get('/api/exports/invoices?format=csv');

    expect(response.status).toBe(200);
    expect(exportsService.exportInvoices).toHaveBeenCalledWith(
      expect.any(Object),
      'csv',
      expect.objectContaining({ authorIds: [4], outletIds: [9] })
    );
  });

  test('blocks balance report export without financial export permissions', async () => {
    const response = await request(app).get('/api/exports/reports?type=balances&format=csv');

    expect(response.status).toBe(403);
    expect(exportsService.exportReport).not.toHaveBeenCalled();
  });

  test('allows operational report export without financial permissions', async () => {
    const response = await request(app).get('/api/exports/reports?type=stock&format=csv');

    expect(response.status).toBe(200);
    expect(exportsService.exportReport).toHaveBeenCalledWith(
      'stock',
      expect.objectContaining({ type: 'stock', format: 'csv' }),
      expect.objectContaining({ id: 88 }),
      'csv',
      { includeFinancials: false }
    );
  });
});
