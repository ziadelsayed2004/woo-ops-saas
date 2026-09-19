jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../../notifications/notificationsService', () => ({
  createOrUpdateNotification: jest.fn(),
  resolveNotificationByDedupeKey: jest.fn()
}));
jest.mock('../../inventory/inventoryMetricsService', () => ({
  getProductMetrics: jest.fn(),
  getProductMetricsMap: jest.fn()
}));

const db = require('../../../db');
const inventoryMetricsService = require('../../inventory/inventoryMetricsService');
const shipmentsService = require('../shipmentsService');

describe('shipmentsService status lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.exec.mockResolvedValue();
    db.run.mockResolvedValue({ lastID: 7, changes: 1 });
    db.all.mockResolvedValue([]);
    inventoryMetricsService.getProductMetrics.mockResolvedValue({ availableToShip: 5, shippingSupplyGap: 0 });
    inventoryMetricsService.getProductMetricsMap.mockResolvedValue(new Map());
  });

  test.each([
    [{ shipped_qty: 0 }, 'pending'],
    [{ shipped_qty: 1 }, 'partially_shipped'],
    [{ shipped_qty: 2 }, 'shipped']
  ])('recalculates the invoice from shipment item state as %s', async (quantities, expectedStatus) => {
    db.get.mockImplementation(sql => {
      if (sql.includes('SELECT shipping_status')) {
        return Promise.resolve({ shipping_status: 'stale', invoice_number: 'INV-1' });
      }
      if (sql.includes('CASE WHEN s.status')) return Promise.resolve(quantities);
      return Promise.resolve(null);
    });
    db.all.mockResolvedValue([{ id: 4, quantity: 2, product_title: 'Book' }]);

    await shipmentsService.recalculateInvoiceShippingStatus(10, 17);

    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE invoices SET shipping_status'),
      [expectedStatus, 10]
    );
  });

  test.each([
    ['shipped', 'pending'],
    ['cancelled', 'shipped']
  ])('rejects invalid transition %s -> %s', async (from, to) => {
    db.get.mockResolvedValue({ id: 7, invoice_id: 10, status: from });

    await expect(shipmentsService.updateShipmentStatus(7, { status: to, userId: 17 }))
      .rejects.toThrow(`Invalid shipment status transition from ${from} to ${to}`);

    expect(db.exec).not.toHaveBeenCalled();
  });

  test('rejects the obsolete delivered status', async () => {
    await expect(shipmentsService.updateShipmentStatus(7, { status: 'delivered', userId: 17 }))
      .rejects.toThrow('Invalid status. Allowed: pending, shipped, cancelled');
  });

  test('records shipped_at on pending -> shipped and recalculates the invoice', async () => {
    db.get.mockImplementation(sql => {
      if (sql.includes('FROM shipments s') && sql.includes('archived_at')) {
        return Promise.resolve({
          id: 7,
          invoice_id: 10,
          status: 'pending',
          shipped_at: null
        });
      }
      if (sql.includes('SELECT shipping_status')) {
        return Promise.resolve({ shipping_status: 'pending', invoice_number: 'INV-1' });
      }
      if (sql.includes('CASE WHEN s.status')) {
        return Promise.resolve({ shipped_qty: 2 });
      }
      if (sql.includes('SELECT s.*')) {
        return Promise.resolve({ id: 7, invoice_id: 10, status: 'shipped' });
      }
      return Promise.resolve(null);
    });
    db.all.mockImplementation(sql => {
      if (sql.includes('FROM invoice_items ii') && sql.includes('WHERE ii.invoice_id')) {
        return Promise.resolve([{ id: 4, quantity: 2, product_title: 'Book' }]);
      }
      return Promise.resolve([]);
    });

    await shipmentsService.updateShipmentStatus(7, { status: 'shipped', userId: 17 });

    const shipmentUpdate = db.run.mock.calls.find(([sql]) => sql.includes('UPDATE shipments'));
    expect(shipmentUpdate[1][0]).toBe('shipped');
    expect(shipmentUpdate[1][1]).toEqual(expect.any(String));
    expect(shipmentUpdate[1][2]).toBe(7);
    expect(db.exec).toHaveBeenNthCalledWith(1, 'BEGIN TRANSACTION;');
    expect(db.exec).toHaveBeenLastCalledWith('COMMIT;');
  });

  test('creates a confirmed shipment in shipped state', async () => {
    db.get.mockImplementation(sql => {
      if (sql.includes('SELECT * FROM invoices')) {
        return Promise.resolve({ id: 10, payment_status: 'unpaid', shipping_status: 'pending' });
      }
      if (sql.includes('SELECT ii.*')) {
        return Promise.resolve({ id: 4, invoice_id: 10, product_id: 6, quantity: 2, product_title: 'Book' });
      }
      if (sql.includes('COALESCE(SUM(si.quantity)')) return Promise.resolve({ qty: 0 });
      if (sql.includes('SELECT stock_policy')) return Promise.resolve({ stock_policy: 'none' });
      if (sql.includes('SELECT shipping_status')) {
        return Promise.resolve({ shipping_status: 'pending', invoice_number: 'INV-1' });
      }
      if (sql.includes('SELECT s.*')) {
        return Promise.resolve({ id: 7, invoice_id: 10, status: 'shipped' });
      }
      return Promise.resolve(null);
    });
    db.all.mockResolvedValue([]);

    const shipment = await shipmentsService.createShipment({
      invoiceId: 10,
      items: [{ invoiceItemId: 4, quantity: 1 }],
      userId: 17
    });

    const shipmentInsert = db.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO shipments'));
    const historyInsert = db.run.mock.calls.find(([sql]) => sql.includes('INSERT INTO shipment_status_history'));
    expect(shipmentInsert[0]).toContain("'shipped'");
    expect(historyInsert[0]).toContain("'pending', 'shipped'");
    expect(shipment.status).toBe('shipped');
  });

  test('counts approved sales returns as physical stock available for a new shipment', async () => {
    db.get.mockImplementation(sql => {
      if (sql.includes('SELECT * FROM invoices')) {
        return Promise.resolve({ id: 10, payment_status: 'unpaid', shipping_status: 'pending' });
      }
      if (sql.includes('SELECT ii.*')) {
        return Promise.resolve({ id: 4, invoice_id: 10, product_id: 6, quantity: 3, product_title: 'Book' });
      }
      if (sql.includes('COALESCE(SUM(si.quantity)') && sql.includes('si.invoice_item_id')) {
        return Promise.resolve({ qty: 0 });
      }
      if (sql.includes('SELECT stock_policy')) return Promise.resolve({ stock_policy: 'track' });
      if (sql.includes('FROM inventory_transactions')) {
        // Five physical units in: receipts plus approved returns.
        expect(sql).toContain("'return'");
        return Promise.resolve({ qty: 5 });
      }
      if (sql.includes('COALESCE(SUM(si.quantity)') && sql.includes('ii.product_id')) {
        // Two units were shipped previously, leaving three available.
        return Promise.resolve({ qty: 2 });
      }
      if (sql.includes('SELECT shipping_status')) {
        return Promise.resolve({ shipping_status: 'pending', invoice_number: 'INV-1' });
      }
      if (sql.includes('SELECT s.*')) {
        return Promise.resolve({ id: 7, invoice_id: 10, status: 'shipped' });
      }
      return Promise.resolve(null);
    });
    db.all.mockResolvedValue([]);

    await expect(shipmentsService.createShipment({
      invoiceId: 10,
      items: [{ invoiceItemId: 4, quantity: 3 }],
      userId: 17
    })).resolves.toEqual(expect.objectContaining({ id: 7 }));

    expect(db.run.mock.calls.some(([sql]) => sql.includes('INSERT INTO shipments'))).toBe(true);
  });

  test('explains a historical shipping deficit and keeps ignore-policy products shippable', async () => {
    db.get.mockImplementation(sql => {
      if (sql.includes('SELECT id FROM invoices')) return Promise.resolve({ id: 10 });
      if (sql.includes('COALESCE(SUM(si.quantity)')) return Promise.resolve({ qty: 0 });
      if (sql.includes('COALESCE(SUM(ri.quantity)')) return Promise.resolve({ qty: 0 });
      return Promise.resolve(null);
    });
    db.all.mockResolvedValue([
      { invoice_item_id: 4, product_id: 6, ordered_quantity: 10, stock_policy: 'track' },
      { invoice_item_id: 5, product_id: 7, ordered_quantity: 5, stock_policy: 'ignore' }
    ]);
    inventoryMetricsService.getProductMetricsMap.mockResolvedValue(new Map([
      [6, {
        availableToShip: 0,
        shippableStockBalance: -633,
        shippingSupplyGap: 633,
        supplyRequiredToFulfill: 8661
      }]
    ]));

    const rows = await shipmentsService.getRemainingShippableItems(10);

    expect(rows[0]).toEqual(expect.objectContaining({
      remaining_quantity: 10,
      product_available_to_ship: 0,
      product_shippable_stock_balance: -633,
      shipping_supply_gap: 633,
      product_supply_required_to_fulfill: 8661,
      max_shippable_quantity: 0
    }));
    expect(rows[1]).toEqual(expect.objectContaining({
      product_available_to_ship: null,
      product_shippable_stock_balance: null,
      max_shippable_quantity: 5
    }));
  });

  test.each([
    [{ payment_status: 'cancelled', shipping_status: 'pending' }, 'cancelled invoice'],
    [{ payment_status: 'paid', shipping_status: 'shipped' }, 'shipping is already complete']
  ])('refuses shipment creation when invoice is not shippable: %s', async (invoice, message) => {
    db.get.mockResolvedValue({ id: 10, ...invoice });

    await expect(shipmentsService.createShipment({
      invoiceId: 10,
      items: [{ invoiceItemId: 4, quantity: 1 }]
    })).rejects.toThrow(message);

    expect(db.exec).not.toHaveBeenCalled();
  });
});
