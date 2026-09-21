/** Compact operational order-line workbook: useful fields only, with one readable shipping address. */
export const wooOrderColumns = [
  ['orderNumber', 'رقم الطلب'],
  ['orderStatus', 'حالة الطلب'],
  ['orderDate', 'تاريخ الطلب'],
  ['billingFirstName', 'الاسم الأول'],
  ['billingLastName', 'اسم العائلة'],
  ['billingPhone', 'رقم الهاتف'],
  ['shippingStateName', 'المحافظة'],
  ['shippingCity', 'المدينة / المنطقة'],
  ['shippingAddress', 'عنوان الشحن'],
  ['shippingTitle', 'طريقة الشحن'],
  ['paymentTitle', 'طريقة الدفع'],
  ['shippingAmount', 'تكلفة الشحن'],
  ['orderTotal', 'إجمالي الطلب'],
  ['itemName', 'المنتج'],
  ['quantity', 'الكمية'],
] as const;

export const wooOrderExportColumns = wooOrderColumns.map(([key, label]) => ({
  key: `woo.${key}`,
  label,
  type: 'text' as const,
}));

/** Carrier-friendly sheet ordered for dispatch and address checking. */
export const wooShippingExportColumns = [
  ['orderNumber', 'رقم الطلب'],
  ['orderDate', 'تاريخ الطلب'],
  ['shippingFirstName', 'الاسم الأول'],
  ['shippingLastName', 'اسم العائلة'],
  ['billingPhone', 'رقم الهاتف'],
  ['shippingStateName', 'المحافظة'],
  ['shippingCity', 'المدينة / المنطقة'],
  ['shippingAddress', 'عنوان الشحن'],
  ['shippingTitle', 'طريقة الشحن'],
  ['paymentTitle', 'طريقة الدفع'],
  ['orderTotal', 'المبلغ المطلوب تحصيله'],
  ['itemName', 'المنتج'],
  ['quantity', 'الكمية'],
].map(([key, label]) => ({ key: `woo.${key}`, label, type: 'text' as const }));
