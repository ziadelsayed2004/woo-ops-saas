const express = require('express');
const request = require('supertest');

jest.mock('../inventoryService', () => ({
  getReceipts: jest.fn(),
  getReceiptDetails: jest.fn(),
  cancelReceipt: jest.fn(),
  createSupplierReturn: jest.fn()
}));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: permission => (req, res, next) => {
    if ((req.testPermissions || []).includes(permission)) return next();
    return res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
  }
}));
jest.mock('../../../middleware/audit', () => ({ auditLog: () => (_req, _res, next) => next() }));

const inventoryService = require('../inventoryService');
const inventoryRouter = require('../inventoryRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 77 } };
    req.testPermissions = String(req.headers['x-permissions'] || '').split(',').filter(Boolean);
    next();
  });
  app.use('/api/inventory', inventoryRouter);
  return app;
}

describe('inventory receipt reversal boundaries', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    inventoryService.cancelReceipt.mockResolvedValue({ id: 1, status: 'cancelled' });
    inventoryService.createSupplierReturn.mockResolvedValue({ id: 1, status: 'partially_returned' });
  });

  test('requires the dedicated reversal permission to cancel a receipt', async () => {
    const response = await request(app)
      .post('/api/inventory/receipts/1/cancel')
      .set('x-permissions', 'inventory.view')
      .send({ reason: 'خطأ في الاستلام' });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('inventory.receipts.reverse');
    expect(inventoryService.cancelReceipt).not.toHaveBeenCalled();
  });

  test('allows an authorized supplier return', async () => {
    const response = await request(app)
      .post('/api/inventory/receipts/1/returns')
      .set('x-permissions', 'inventory.receipts.reverse')
      .send({ reason: 'تالف', items: [{ receiptItemId: 5, quantity: 2 }] });

    expect(response.status).toBe(201);
    expect(inventoryService.createSupplierReturn).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({
      reason: 'تالف',
      items: [{ receiptItemId: 5, quantity: 2 }],
      userId: 77
    }));
  });
});
