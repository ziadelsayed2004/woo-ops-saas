/** Compact operational order-line workbook: useful fields only, with one readable shipping address. */
export const wooOrderColumns = [
  ['orderNumber', 'Order Number'],
  ['orderStatus', 'Order Status'],
  ['orderDate', 'Order Date'],
  ['billingFirstName', 'First Name'],
  ['billingLastName', 'Last Name'],
  ['billingPhone', 'Phone'],
  ['shippingStateName', 'Governorate'],
  ['shippingCity', 'City / Area'],
  ['shippingAddress', 'Shipping Address'],
  ['shippingTitle', 'Shipping Method'],
  ['paymentTitle', 'Payment Method'],
  ['shippingAmount', 'Shipping Amount'],
  ['orderTotal', 'Order Total'],
  ['itemName', 'Product'],
  ['quantity', 'Quantity'],
] as const;

export const wooOrderExportColumns = wooOrderColumns.map(([key, label]) => ({
  key: `woo.${key}`,
  label,
  type: 'text' as const,
}));

/** Carrier-friendly sheet ordered for dispatch and address checking. */
export const wooShippingExportColumns = [
  ['orderNumber', 'Order Number'],
  ['orderDate', 'Order Date'],
  ['shippingFirstName', 'First Name'],
  ['shippingLastName', 'Last Name'],
  ['billingPhone', 'Phone'],
  ['shippingStateName', 'Governorate'],
  ['shippingCity', 'City / Area'],
  ['shippingAddress', 'Shipping Address'],
  ['shippingTitle', 'Shipping Method'],
  ['paymentTitle', 'Payment Method'],
  ['orderTotal', 'Collect Amount'],
  ['itemName', 'Product'],
  ['quantity', 'Quantity'],
].map(([key, label]) => ({ key: `woo.${key}`, label, type: 'text' as const }));
