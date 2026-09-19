jest.mock('../../../db', () => ({ all: jest.fn() }));

const db = require('../../../db');
const { presentInvoice, presentInvoices } = require('../invoicePresenter');

describe('role-aware invoice presentation', () => {
  beforeEach(() => db.all.mockReset());

  test('removes every financial field from shipping invoices and items', async () => {
    const result = await presentInvoice({
      id: 1,
      subtotal: 100,
      discount: 5,
      shipping_cost: 10,
      total_price: 105,
      payment_status: 'paid',
      paid_amount: 105,
      payments: [{ amount: 105 }],
      history: [{ status_type: 'payment' }, { status_type: 'shipping' }],
      items: [{ product_id: 2, quantity: 1, unit_price: 100, total_price: 100 }]
    }, { roleNames: ['shipping_user'], userId: 7 });

    expect(result).not.toHaveProperty('total_price');
    expect(result).not.toHaveProperty('payment_status');
    expect(result.items[0]).not.toHaveProperty('unit_price');
    expect(result.items[0]).not.toHaveProperty('total_price');
    expect(result.history).toEqual([{ status_type: 'shipping' }]);
  });

  test('keeps only linked author items and exposes their own subtotal', async () => {
    db.all.mockResolvedValue([{ product_id: 2 }]);
    const result = await presentInvoice({
      id: 1,
      total_price: 300,
      discount: 20,
      payments: [{ amount: 10 }],
      items: [
        { product_id: 2, total_price: 100 },
        { product_id: 3, total_price: 200 }
      ]
    }, { roleNames: ['author'], userId: 7 });

    expect(result.items).toEqual([{ product_id: 2, total_price: 100 }]);
    expect(result.author_subtotal).toBe(100);
    expect(result).not.toHaveProperty('total_price');
    expect(result).not.toHaveProperty('payments');
  });

  test('replaces full list totals with linked author totals', async () => {
    db.all
      .mockResolvedValueOnce([{ product_id: 2 }])
      .mockResolvedValueOnce([{ invoice_id: 1, author_subtotal: 75 }]);
    const [result] = await presentInvoices([{ id: 1, total_price: 900 }], {
      roleNames: ['author'], userId: 7
    });
    expect(result.author_subtotal).toBe(75);
    expect(result).not.toHaveProperty('total_price');
  });
});
