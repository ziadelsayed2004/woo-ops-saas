const express = require('express');
const request = require('supertest');

jest.mock('../paymentsService', () => ({
  getPayments: jest.fn(),
  recordPayment: jest.fn(),
  getPaymentById: jest.fn(),
  reversePayment: jest.fn(),
  getReviewQueue: jest.fn(),
  reviewPaymentReceipt: jest.fn()
}));
jest.mock('../../users/usersService', () => ({
  getUserPermissions: jest.fn(),
  getUserRoles: jest.fn()
}));
jest.mock('../../outlets/outletsService', () => ({
  getLinkedOutletsForUser: jest.fn()
}));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: permission => (req, res, next) => {
    if ((req.testPermissions || []).includes(permission)) return next();
    return res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
  }
}));
jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

const paymentsService = require('../paymentsService');
const usersService = require('../../users/usersService');
const outletsService = require('../../outlets/outletsService');
const paymentsRouter = require('../paymentsRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 77 } };
    req.testPermissions = String(req.headers['x-permissions'] || '').split(',').filter(Boolean);
    next();
  });
  app.use('/api/payments', paymentsRouter);
  return app;
}

describe('invoice payment operator boundaries', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getUserPermissions.mockResolvedValue([
      'invoices.pay',
      'payments.view',
      'payments.create',
      'payments.reverse',
      'payments.receipt.view',
      'payments.receipt.upload'
    ]);
    usersService.getUserRoles.mockResolvedValue([{ name: 'assistant' }, { name: 'invoice_payment_operator' }]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([]);
    paymentsService.getPayments.mockResolvedValue([]);
    paymentsService.getReviewQueue.mockResolvedValue([]);
    paymentsService.recordPayment.mockResolvedValue({ id: 1 });
    paymentsService.reversePayment.mockResolvedValue({ success: true });
    paymentsService.getPaymentById.mockResolvedValue({ id: 1, supply_status: 'not_supplied' });
  });

  test('rejects forged supplied status for collection-only users', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('x-permissions', 'payments.create')
      .send({ invoiceId: 10, amount: 25, paymentMethod: 'cash', supplyStatus: 'supplied' });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('payments.mark_supplied');
    expect(paymentsService.recordPayment).not.toHaveBeenCalled();
  });

  test('allows a non-supplied collection payment', async () => {
    const response = await request(app)
      .post('/api/payments')
      .set('x-permissions', 'payments.create')
      .send({ invoiceId: 10, amount: 25, paymentMethod: 'cash' });

    expect(response.status).toBe(201);
    expect(paymentsService.recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      supplyStatus: 'not_supplied'
    }));
  });

  test('blocks cancellation of a supplied payment without supply reversal permission', async () => {
    paymentsService.getPaymentById.mockResolvedValue({ id: 1, supply_status: 'supplied' });

    const response = await request(app)
      .post('/api/payments/1/reverse')
      .set('x-permissions', 'payments.reverse')
      .send({});

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('payments.supply.reverse');
    expect(paymentsService.reversePayment).not.toHaveBeenCalled();
  });

  test('allows cancellation of an un-supplied payment', async () => {
    const response = await request(app)
      .post('/api/payments/1/reverse')
      .set('x-permissions', 'payments.reverse')
      .send({});

    expect(response.status).toBe(200);
    expect(paymentsService.reversePayment).toHaveBeenCalled();
  });

  test('does not expose receipt review to collection-only users', async () => {
    const response = await request(app)
      .get('/api/payments/receipts/review-queue')
      .set('x-permissions', 'payments.view');

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('payments.receipt.review');
  });
});
