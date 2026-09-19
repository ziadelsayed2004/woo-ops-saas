const {
  INCOMPLETE_SHIPPING_STATUSES,
  getInvoiceVisibilityScope,
  isInvoiceVisible
} = require('../invoiceAccessPolicy');

describe('invoice access policy', () => {
  test.each(['inventory_manager', 'shipping_user'])(
    'restricts non-administrative role %s',
    role => {
      expect(getInvoiceVisibilityScope([role])).toEqual({
        restricted: true,
        allowedShippingStatuses: INCOMPLETE_SHIPPING_STATUSES,
        excludeCancelled: true
      });
    }
  );

  test.each(['readonly_viewer', 'author', 'outlet'])(
    'allows full invoice-state visibility for scoped/read-only role %s',
    role => {
      expect(getInvoiceVisibilityScope([role])).toEqual({
        restricted: false,
        allowedShippingStatuses: null,
        excludeCancelled: false
      });
    }
  );

  test.each(['super_admin', 'assistant'])(
    'lets bypass role %s see the normal invoice scope',
    role => {
      expect(getInvoiceVisibilityScope([role])).toEqual({
        restricted: false,
        allowedShippingStatuses: null,
        excludeCancelled: false
      });
    }
  );

  test('keeps two restricted roles restricted', () => {
    expect(getInvoiceVisibilityScope(['inventory_manager', 'shipping_user']).restricted).toBe(true);
  });

  test('restricts custom roles unless an administrative role is also assigned', () => {
    expect(getInvoiceVisibilityScope(['custom_operator']).restricted).toBe(true);
    expect(getInvoiceVisibilityScope(['custom_operator', 'assistant']).restricted).toBe(false);
  });

  test.each(['super_admin', 'assistant'])(
    'gives bypass role %s precedence in a mixed-role user',
    bypassRole => {
      expect(getInvoiceVisibilityScope(['shipping_user', bypassRole]).restricted).toBe(false);
    }
  );

  test('does not invent a restriction for malformed or empty role input', () => {
    expect(getInvoiceVisibilityScope(null).restricted).toBe(false);
    expect(getInvoiceVisibilityScope([]).restricted).toBe(false);
  });

  test.each([
    ['pending', 'unpaid', true],
    ['partially_shipped', 'paid', true],
    ['shipped', 'unpaid', false],
    ['pending', 'cancelled', false],
    ['partially_shipped', 'cancelled', false]
  ])(
    'evaluates shipping=%s payment=%s as visible=%s for restricted users',
    (shippingStatus, paymentStatus, expected) => {
      const scope = getInvoiceVisibilityScope(['inventory_manager']);
      const invoice = {
        shipping_status: shippingStatus,
        payment_status: paymentStatus
      };

      expect(isInvoiceVisible(invoice, scope)).toBe(expected);
    }
  );

  test('does not apply invoice-state filtering to an unrestricted scope', () => {
    const scope = getInvoiceVisibilityScope(['assistant']);
    const completedCancelledInvoice = {
      shipping_status: 'shipped',
      payment_status: 'cancelled'
    };

    expect(isInvoiceVisible(completedCancelledInvoice, scope)).toBe(true);
  });
});
