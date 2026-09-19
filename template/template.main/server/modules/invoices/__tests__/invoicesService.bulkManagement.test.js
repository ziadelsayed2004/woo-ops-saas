jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn(),
  exec: jest.fn()
}));
jest.mock('../../shipments/shipmentsService', () => ({
  recalculateInvoiceShippingStatus: jest.fn()
}));

const db = require('../../../db');
const shipmentsService = require('../../shipments/shipmentsService');
const invoicesService = require('../invoicesService');

describe('invoice bulk undo and archive management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.exec.mockResolvedValue();
    db.run.mockResolvedValue({ changes: 1 });
    shipmentsService.recalculateInvoiceShippingStatus.mockResolvedValue();
  });

  test('cancels the latest active shipment for every invoice and recalculates status', async () => {
    db.get.mockImplementation((sql, params) => {
      if (sql.includes('SELECT id, invoice_number')) {
        return Promise.resolve({ id: params[0], invoice_number: `INV-${params[0]}`, payment_status: 'paid', archived_at: null });
      }
      if (sql.includes('FROM shipments')) {
        return Promise.resolve({ id: params[0] * 10, status: 'shipped' });
      }
      return Promise.resolve(null);
    });

    await invoicesService.bulkUndoLatestShipment({ invoiceIds: [1, 2], userId: 9 });

    expect(db.exec).toHaveBeenNthCalledWith(1, 'BEGIN IMMEDIATE TRANSACTION;');
    expect(db.run.mock.calls.filter(([sql]) => sql.includes("SET status = 'cancelled'"))).toHaveLength(2);
    expect(shipmentsService.recalculateInvoiceShippingStatus).toHaveBeenCalledWith(1, 9);
    expect(shipmentsService.recalculateInvoiceShippingStatus).toHaveBeenCalledWith(2, 9);
    expect(db.exec).toHaveBeenLastCalledWith('COMMIT;');
  });

  test('rolls back the whole undo selection when one invoice has no active shipment', async () => {
    db.get.mockImplementation((sql, params) => {
      if (sql.includes('SELECT id, invoice_number')) {
        return Promise.resolve({ id: params[0], invoice_number: `INV-${params[0]}`, payment_status: 'paid', archived_at: null });
      }
      if (sql.includes('FROM shipments')) return Promise.resolve(params[0] === 1 ? { id: 10, status: 'shipped' } : null);
      return Promise.resolve(null);
    });

    await expect(invoicesService.bulkUndoLatestShipment({ invoiceIds: [1, 2], userId: 9 }))
      .rejects.toThrow('has no shipment that can be undone');
    expect(db.run).not.toHaveBeenCalled();
    expect(db.exec).toHaveBeenLastCalledWith('ROLLBACK;');
  });

  test('archives and restores without touching related financial or shipment data', async () => {
    db.get
      .mockResolvedValueOnce({ id: 1, invoice_number: 'INV-1', archived_at: null })
      .mockResolvedValueOnce({ id: 1, invoice_number: 'INV-1', archived_at: '2026-07-15' });

    await invoicesService.bulkSetArchiveStatus({ invoiceIds: [1], archived: true, userId: 9 });
    await invoicesService.bulkSetArchiveStatus({ invoiceIds: [1], archived: false, userId: 9 });

    const updateCalls = db.run.mock.calls.map(([sql]) => sql).filter(sql => sql.includes('UPDATE invoices'));
    expect(updateCalls).toHaveLength(2);
    expect(db.run.mock.calls.some(([sql]) => /DELETE FROM|UPDATE shipments|UPDATE invoice_payments/.test(sql))).toBe(false);
  });
});
