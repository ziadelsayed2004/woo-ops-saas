const express = require('express');
const request = require('supertest');

jest.mock('../invoicesService', () => ({
  getInvoices: jest.fn(),
  getInvoiceById: jest.fn(),
  getInvoiceVisibilityRecords: jest.fn(),
  createInvoice: jest.fn(),
  updateInvoice: jest.fn(),
  bulkUpdateShippingStatus: jest.fn(),
  cancelInvoice: jest.fn()
}));
jest.mock('../invoiceTrashService', () => ({
  normalizeInvoiceIds: jest.fn(ids => ids),
  getTrashedInvoices: jest.fn(),
  getTrashedInvoice: jest.fn(),
  trashInvoices: jest.fn(),
  restoreTrashedInvoices: jest.fn(),
  permanentlyDeleteTrashedInvoices: jest.fn()
}));
jest.mock('../../payments/paymentsService', () => ({ getPayments: jest.fn() }));
jest.mock('../pdfService', () => ({ generateInvoicesPdf: jest.fn() }));
jest.mock('../../users/usersService', () => ({
  getUserRoles: jest.fn(),
  getUserPermissions: jest.fn()
}));
jest.mock('../../authors/authorsService', () => ({ getLinkedAuthorsForUser: jest.fn() }));
jest.mock('../../outlets/outletsService', () => ({ getLinkedOutletsForUser: jest.fn() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: () => (_req, _res, next) => next(),
  requireSuperAdmin: (_req, _res, next) => next()
}));
jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

const invoicesService = require('../invoicesService');
const invoiceTrashService = require('../invoiceTrashService');
const paymentsService = require('../../payments/paymentsService');
const pdfService = require('../pdfService');
const usersService = require('../../users/usersService');
const authorsService = require('../../authors/authorsService');
const outletsService = require('../../outlets/outletsService');
const invoicesRouter = require('../invoicesRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 77 } };
    next();
  });
  app.use('/api/invoices', invoicesRouter);
  return app;
}

function useRoles(...roleNames) {
  usersService.getUserRoles.mockResolvedValue(roleNames.map(name => ({ name })));
}

describe('invoice routes access scope', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    invoicesService.getInvoices.mockResolvedValue([]);
    invoicesService.createInvoice.mockResolvedValue({ id: 99, history: [], payments: [] });
    invoicesService.updateInvoice.mockResolvedValue({ id: 42, history: [], payments: [] });
    invoicesService.bulkUpdateShippingStatus.mockResolvedValue();
    invoiceTrashService.getTrashedInvoices.mockResolvedValue({ items: [], total: 0 });
    invoiceTrashService.trashInvoices.mockResolvedValue();
    invoiceTrashService.restoreTrashedInvoices.mockResolvedValue();
    invoiceTrashService.permanentlyDeleteTrashedInvoices.mockResolvedValue();
    paymentsService.getPayments.mockResolvedValue([]);
    pdfService.generateInvoicesPdf.mockResolvedValue(Buffer.from('pdf'));
    usersService.getUserPermissions.mockResolvedValue(['invoices.pay', 'payments.view']);
    authorsService.getLinkedAuthorsForUser.mockResolvedValue([]);
    outletsService.getLinkedOutletsForUser.mockResolvedValue([]);
  });

  test.each(['inventory_manager', 'shipping_user'])(
    'passes the incomplete-only scope to GET / for %s without discarding requested filters',
    async role => {
      useRoles(role);

      const response = await request(app)
        .get('/api/invoices')
        .query({ shippingStatus: 'shipped', limit: 10, offset: 5 });

      expect(response.status).toBe(200);
      expect(invoicesService.getInvoices).toHaveBeenCalledWith(expect.objectContaining({
        shippingStatus: 'shipped',
        allowedShippingStatuses: ['pending', 'partially_shipped'],
        excludeCancelled: true,
        limit: 10,
        offset: 5
      }));
    }
  );

  test('removes the restriction when an elevated role is combined with a restricted role', async () => {
    useRoles('shipping_user', 'assistant');

    const response = await request(app).get('/api/invoices');

    expect(response.status).toBe(200);
    expect(invoicesService.getInvoices).toHaveBeenCalledWith(expect.objectContaining({
      allowedShippingStatuses: null,
      excludeCancelled: false
    }));
  });

  test.each([
    ['shipped', 'unpaid'],
    ['pending', 'cancelled']
  ])('returns 403 for direct details with shipping=%s payment=%s', async (shippingStatus, paymentStatus) => {
    useRoles('inventory_manager');
    invoicesService.getInvoiceById.mockResolvedValue({
      id: 42,
      shipping_status: shippingStatus,
      payment_status: paymentStatus,
      items: []
    });

    const response = await request(app).get('/api/invoices/42');

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
  });

  test('returns 403 before loading payments for a hidden invoice', async () => {
    useRoles('shipping_user');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 42,
      shipping_status: 'shipped',
      payment_status: 'paid'
    }]);

    const response = await request(app).get('/api/invoices/42/payments');

    expect(response.status).toBe(403);
    expect(paymentsService.getPayments).not.toHaveBeenCalled();
  });

  test('returns 400 without loading payments for a malformed invoice ID', async () => {
    const response = await request(app).get('/api/invoices/foo/payments');

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Bad Request');
    expect(usersService.getUserRoles).not.toHaveBeenCalled();
    expect(invoicesService.getInvoiceVisibilityRecords).not.toHaveBeenCalled();
    expect(paymentsService.getPayments).not.toHaveBeenCalled();
  });

  test('returns 404 without loading payments when the invoice does not exist', async () => {
    useRoles('shipping_user');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([]);

    const response = await request(app).get('/api/invoices/404/payments');

    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Not Found');
    expect(invoicesService.getInvoiceVisibilityRecords).toHaveBeenCalledWith([404]);
    expect(paymentsService.getPayments).not.toHaveBeenCalled();
  });

  test('allows payments after the payments.view middleware for a visible invoice', async () => {
    useRoles('readonly_viewer');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 42,
      shipping_status: 'partially_shipped',
      payment_status: 'partially_paid'
    }]);

    const response = await request(app).get('/api/invoices/42/payments');

    expect(response.status).toBe(200);
    expect(paymentsService.getPayments).toHaveBeenCalledWith({ invoiceId: 42 });
  });

  test('omits payment rows and payment history from invoice details without payments.view', async () => {
    useRoles('assistant');
    usersService.getUserPermissions.mockResolvedValue([]);
    invoicesService.getInvoiceById.mockResolvedValue({
      id: 42,
      outlet_id: 3,
      shipping_status: 'pending',
      payment_status: 'unpaid',
      paid_amount: 0,
      remaining_amount: 150,
      payments: [{ id: 8, amount: 50 }],
      history: [
        { status_type: 'payment', new_status: 'partially_paid' },
        { status_type: 'shipping', new_status: 'pending' }
      ],
      items: []
    });

    const response = await request(app).get('/api/invoices/42');

    expect(response.status).toBe(200);
    expect(invoicesService.getInvoiceById).toHaveBeenCalledWith(42, { includePayments: false });
    expect(response.body.payments).toBeUndefined();
    expect(response.body.history).toEqual([{ status_type: 'shipping', new_status: 'pending' }]);
    expect(response.body.remaining_amount).toBe(150);
  });

  test('rejects initial payment fields on invoice creation without invoices.pay', async () => {
    usersService.getUserPermissions.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/invoices')
      .send({
        outletId: 3,
        items: [{ productId: 4, quantity: 1 }],
        paymentAmount: 0
      });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('invoices.pay');
    expect(invoicesService.createInvoice).not.toHaveBeenCalled();
  });

  test('allows an operational invoice create payload with no payment fields', async () => {
    usersService.getUserPermissions.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/invoices')
      .send({ outletId: 3, items: [{ productId: 4, quantity: 1 }] });

    expect(response.status).toBe(201);
    expect(invoicesService.createInvoice).toHaveBeenCalledWith(expect.objectContaining({
      outletId: 3,
      paymentAmount: 0,
      paymentSupplyStatus: 'not_supplied'
    }));
    expect(response.body.invoice.payments).toBeUndefined();
  });

  test('rejects changing paymentType on update without invoices.pay', async () => {
    usersService.getUserPermissions.mockResolvedValue([]);
    invoicesService.getInvoiceById.mockResolvedValue({ id: 42, payment_type: 'deferred' });

    const response = await request(app)
      .put('/api/invoices/42')
      .send({
        outletId: 3,
        items: [{ productId: 4, quantity: 1 }],
        paymentType: 'cash'
      });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('invoices.pay');
    expect(invoicesService.updateInvoice).not.toHaveBeenCalled();
  });

  test('preserves paymentType when an operational update omits it', async () => {
    usersService.getUserPermissions.mockResolvedValue([]);
    invoicesService.getInvoiceById.mockResolvedValue({ id: 42, payment_type: 'deferred' });

    const response = await request(app)
      .put('/api/invoices/42')
      .send({ outletId: 3, items: [{ productId: 4, quantity: 1 }] });

    expect(response.status).toBe(200);
    expect(invoicesService.updateInvoice).toHaveBeenCalledWith(42, expect.objectContaining({
      paymentType: 'deferred'
    }));
  });

  test('rejects the entire PDF request if any selected invoice is hidden', async () => {
    useRoles('inventory_manager');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([
      { id: 1, shipping_status: 'pending', payment_status: 'unpaid' },
      { id: 2, shipping_status: 'shipped', payment_status: 'paid' }
    ]);

    const response = await request(app)
      .post('/api/invoices/export/pdf')
      .send({ invoiceIds: [1, 2] });

    expect(response.status).toBe(403);
    expect(pdfService.generateInvoicesPdf).not.toHaveBeenCalled();
  });

  test('rejects malformed PDF invoice IDs before checking access or generating output', async () => {
    const response = await request(app)
      .post('/api/invoices/export/pdf')
      .send({ invoiceIds: [1, 'not-an-id'] });

    expect(response.status).toBe(400);
    expect(usersService.getUserRoles).not.toHaveBeenCalled();
    expect(invoicesService.getInvoiceVisibilityRecords).not.toHaveBeenCalled();
    expect(pdfService.generateInvoicesPdf).not.toHaveBeenCalled();
  });

  test('rejects the entire PDF request when a restricted user selects a missing invoice', async () => {
    useRoles('shipping_user');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([
      { id: 1, shipping_status: 'pending', payment_status: 'unpaid' }
    ]);

    const response = await request(app)
      .post('/api/invoices/export/pdf')
      .send({ invoiceIds: [1, 999999] });

    expect(response.status).toBe(403);
    expect(pdfService.generateInvoicesPdf).not.toHaveBeenCalled();
  });

  test('generates the PDF when every selected invoice is visible', async () => {
    useRoles('inventory_manager');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([
      { id: 1, shipping_status: 'pending', payment_status: 'unpaid' },
      { id: 2, shipping_status: 'partially_shipped', payment_status: 'partially_paid' }
    ]);

    const response = await request(app)
      .post('/api/invoices/export/pdf')
      .send({ invoiceIds: [1, 2] });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/pdf/);
    expect(pdfService.generateInvoicesPdf).toHaveBeenCalledWith([1, 2], {
      mode: 'standard',
      userId: 77
    });
  });

  test('rejects PDF export when a linked author selects another author invoice', async () => {
    useRoles('author');
    authorsService.getLinkedAuthorsForUser.mockResolvedValue([12]);
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 1,
      outlet_id: 3,
      author_ids: [99],
      shipping_status: 'pending',
      payment_status: 'unpaid'
    }]);

    const response = await request(app)
      .post('/api/invoices/export/pdf')
      .send({ invoiceIds: [1] });

    expect(response.status).toBe(403);
    expect(pdfService.generateInvoicesPdf).not.toHaveBeenCalled();
  });

  test('rejects payment rows when a linked outlet requests another outlet invoice', async () => {
    useRoles('outlet');
    outletsService.getLinkedOutletsForUser.mockResolvedValue([7]);
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 42,
      outlet_id: 8,
      author_ids: [],
      shipping_status: 'pending',
      payment_status: 'unpaid'
    }]);

    const response = await request(app).get('/api/invoices/42/payments');

    expect(response.status).toBe(403);
    expect(paymentsService.getPayments).not.toHaveBeenCalled();
  });

  test('lets the shipping role bulk ship a fully visible invoice selection', async () => {
    useRoles('shipping_user');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([
      { id: 1, outlet_id: 3, author_ids: [], shipping_status: 'pending', payment_status: 'unpaid' },
      { id: 2, outlet_id: 4, author_ids: [], shipping_status: 'partially_shipped', payment_status: 'paid' }
    ]);

    const response = await request(app)
      .put('/api/invoices/bulk/shipping-status')
      .send({ invoiceIds: [1, 2], shippingStatus: 'shipped' });

    expect(response.status).toBe(200);
    expect(invoicesService.bulkUpdateShippingStatus).toHaveBeenCalledWith({
      invoiceIds: [1, 2], shippingStatus: 'shipped', userId: 77
    });
  });

  test('rejects the entire bulk shipment if one selected invoice is hidden', async () => {
    useRoles('shipping_user');
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([
      { id: 1, outlet_id: 3, author_ids: [], shipping_status: 'pending', payment_status: 'unpaid' },
      { id: 2, outlet_id: 4, author_ids: [], shipping_status: 'shipped', payment_status: 'paid' }
    ]);

    const response = await request(app)
      .put('/api/invoices/bulk/shipping-status')
      .send({ invoiceIds: [1, 2], shippingStatus: 'shipped' });

    expect(response.status).toBe(403);
    expect(invoicesService.bulkUpdateShippingStatus).not.toHaveBeenCalled();
  });

  test.each([
    [{ invoiceIds: [1, 1], shippingStatus: 'shipped' }, 'duplicates'],
    [{ invoiceIds: [1], shippingStatus: 'delivered' }, 'obsolete status']
  ])('rejects invalid bulk shipping input: %s', async (body) => {
    const response = await request(app).put('/api/invoices/bulk/shipping-status').send(body);
    expect(response.status).toBe(400);
    expect(invoicesService.bulkUpdateShippingStatus).not.toHaveBeenCalled();
  });

  test('moves a validated invoice selection to trash', async () => {
    const response = await request(app)
      .put('/api/invoices/bulk/trash')
      .send({ invoiceIds: [1, 2] });

    expect(response.status).toBe(200);
    expect(invoiceTrashService.trashInvoices).toHaveBeenCalledWith(expect.objectContaining({
      invoiceIds: [1, 2],
      userId: 77
    }));
  });

  test('requires the exact Arabic confirmation before permanent deletion', async () => {
    const rejected = await request(app)
      .post('/api/invoices/trash/permanent-delete')
      .send({ invoiceIds: [1], confirmation: 'delete' });
    expect(rejected.status).toBe(400);
    expect(invoiceTrashService.permanentlyDeleteTrashedInvoices).not.toHaveBeenCalled();

    const accepted = await request(app)
      .post('/api/invoices/trash/permanent-delete')
      .send({ invoiceIds: [1], confirmation: 'حذف نهائي' });
    expect(accepted.status).toBe(200);
    expect(invoiceTrashService.permanentlyDeleteTrashedInvoices).toHaveBeenCalledWith(expect.objectContaining({
      invoiceIds: [1],
      userId: 77
    }));
  });
});
