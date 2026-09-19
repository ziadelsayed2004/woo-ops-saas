const express = require('express');
const request = require('supertest');

jest.mock('../shipmentsService', () => ({
  getShipments: jest.fn(),
  getShipmentById: jest.fn(),
  getRemainingShippableItems: jest.fn(),
  createShipment: jest.fn(),
  updateShipmentStatus: jest.fn()
}));
jest.mock('../../invoices/invoicesService', () => ({
  getInvoiceById: jest.fn(),
  getInvoiceVisibilityRecords: jest.fn()
}));
jest.mock('../../users/usersService', () => ({ getUserRoles: jest.fn() }));
jest.mock('../../outlets/outletsService', () => ({ getLinkedOutletsForUser: jest.fn() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: jest.fn(() => (_req, _res, next) => next())
}));
jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

const shipmentsService = require('../shipmentsService');
const invoicesService = require('../../invoices/invoicesService');
const usersService = require('../../users/usersService');
const shipmentsRouter = require('../shipmentsRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 17 } };
    next();
  });
  app.use('/api/shipments', shipmentsRouter);
  return app;
}

describe('shipment routes access and status permissions', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    usersService.getUserRoles.mockResolvedValue([{ name: 'shipping_user' }]);
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 10,
      outlet_id: 3,
      shipping_status: 'pending',
      payment_status: 'unpaid'
    }]);
    shipmentsService.getRemainingShippableItems.mockResolvedValue([{ invoice_item_id: 4 }]);
    shipmentsService.getShipmentById.mockResolvedValue({
      id: 7,
      invoice_id: 10,
      items: [{ product_title: 'Book', quantity: 2, unit_price: 99, total_price: 198 }]
    });
    shipmentsService.createShipment.mockResolvedValue({ id: 7, status: 'shipped' });
    shipmentsService.updateShipmentStatus.mockResolvedValue({ id: 7, status: 'shipped' });
  });

  test('registers the remaining-items route before the generic shipment ID route', async () => {
    const response = await request(app).get('/api/shipments/invoice/10/remaining');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ invoice_item_id: 4 }]);
    expect(shipmentsService.getRemainingShippableItems).toHaveBeenCalledWith(10);
    expect(shipmentsService.getShipmentById).not.toHaveBeenCalled();
  });

  test('rejects remaining items and shipment creation for a hidden completed invoice', async () => {
    invoicesService.getInvoiceVisibilityRecords.mockResolvedValue([{
      id: 10,
      outlet_id: 3,
      shipping_status: 'shipped',
      payment_status: 'paid'
    }]);

    const remainingResponse = await request(app).get('/api/shipments/invoice/10/remaining');
    const createResponse = await request(app)
      .post('/api/shipments')
      .send({ invoiceId: 10, items: [{ invoiceItemId: 4, quantity: 1 }] });

    expect(remainingResponse.status).toBe(403);
    expect(createResponse.status).toBe(403);
    expect(shipmentsService.getRemainingShippableItems).not.toHaveBeenCalled();
    expect(shipmentsService.createShipment).not.toHaveBeenCalled();
  });

  test('creates a confirmed shipment for a visible incomplete invoice', async () => {
    const response = await request(app)
      .post('/api/shipments')
      .send({ invoiceId: 10, items: [{ invoiceItemId: 4, quantity: 1 }] });

    expect(response.status).toBe(201);
    expect(response.body.shipment.status).toBe('shipped');
    expect(shipmentsService.createShipment).toHaveBeenCalledWith({
      invoiceId: 10,
      shippingCarrier: '',
      trackingNumber: '',
      items: [{ invoiceItemId: 4, quantity: 1 }],
      userId: 17
    });
  });

  test.each(['shipped', 'cancelled'])('updates a shipment to the supported %s status', async status => {
    shipmentsService.updateShipmentStatus.mockResolvedValue({ id: 7, status });

    const response = await request(app)
      .post('/api/shipments/7/status')
      .send({ status });

    expect(response.status).toBe(200);
    expect(shipmentsService.updateShipmentStatus).toHaveBeenCalledWith(7, {
      status,
      notes: '',
      userId: 17
    });
  });

  test('removes item prices from shipping-user shipment details', async () => {
    const response = await request(app).get('/api/shipments/7');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([{ product_title: 'Book', quantity: 2 }]);
    expect(response.text).not.toContain('unit_price');
    expect(response.text).not.toContain('99');
  });

  test('keeps shipment prices for the readonly monitor', async () => {
    usersService.getUserRoles.mockResolvedValue([{ name: 'readonly_viewer' }]);
    const response = await request(app).get('/api/shipments/7');
    expect(response.status).toBe(200);
    expect(response.body.items[0].unit_price).toBe(99);
  });

  test('passes an obsolete delivered status to the service for validation', async () => {
    shipmentsService.updateShipmentStatus.mockRejectedValue(new Error('Invalid status. Allowed: pending, shipped, cancelled'));
    const response = await request(app)
      .post('/api/shipments/7/status')
      .send({ status: 'delivered' });
    expect(response.status).toBe(400);
  });
});
