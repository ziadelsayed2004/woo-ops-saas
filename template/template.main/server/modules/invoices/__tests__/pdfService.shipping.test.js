jest.mock('../../../db', () => ({}));
jest.mock('html-pdf-node', () => ({ generatePdf: jest.fn() }));

const { buildShippingHtmlContent } = require('../pdfService');

test('shipping PDF contains logistics data but no prices or payment data', () => {
  const html = buildShippingHtmlContent([{
    invoice_number: 'INV-1', outlet_name: 'Outlet', created_at: '2026-01-01',
    shipping_status: 'pending', payment_status: 'paid', total_price: 999,
    items: [{ product_title: 'Book', authors: 'Author', quantity: 2, free_quantity: 0, unit_price: 123, total_price: 246 }]
  }]);
  expect(html).toContain('INV-1');
  expect(html).toContain('Book');
  expect(html).not.toContain('999');
  expect(html).not.toContain('123');
  expect(html).not.toContain('246');
  expect(html).not.toContain('payment_status');
});
