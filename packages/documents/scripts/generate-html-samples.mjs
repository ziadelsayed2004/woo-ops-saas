import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDocument } from '../dist/index.js';

delete process.env.WOO_OPS_DOCUMENT_RENDERER;
const output = resolve('output/pdf');
mkdirSync(output, { recursive: true });
const fontPath = [
  'C:/Windows/Fonts/arial.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].find(existsSync);
const fontBytes = fontPath ? new Uint8Array(readFileSync(fontPath)) : undefined;
const order = {
  id: '3586',
  orderNumber: '3586',
  currency: 'EGP',
  createdAt: '2026-09-21T12:30:00.000Z',
  grandTotalMinor: '35400',
  billing: {
    first_name: 'هيبة الله',
    last_name: 'مصطفى علي',
    phone: '01012345678',
    email: 'customer@example.com',
  },
  shipping: {
    address_1: '٧٩٥٣ شارع محمد مصطفى، عربي الشنايلة',
    city: 'أسيوط',
    state: 'أسيوط',
  },
  paymentMethodTitle: 'المحافظ الإلكترونية',
  shippingMethodTitle: 'الشحن عبر فاتورتك',
  amounts: { merchandiseNetMinor: '29400', shippingCollectedMinor: '6000' },
  lines: [
    {
      name: 'عربي | باكدج أزهر علمي أ | أ. أحمد مصطفى | الصف الثالث الثانوي',
      quantity: 1,
      unitPriceMinor: '29400',
      totalMinor: '29400',
    },
  ],
};
const template = {
  version: 4,
  name: 'فاتورة وسط البلد',
  companyName: 'وسط البلد ستور',
  companyAddress: 'القاهرة، مصر',
  footerText: 'شكرًا لتعاملكم معنا',
  locale: 'ar-EG',
  direction: 'rtl',
  ...(fontBytes ? { fontBytes } : {}),
};

for (const [format, filename, documentKind] of [
  ['a4', 'html-invoice-a4.pdf', 'invoice'],
  ['thermal-80mm', 'html-receipt-80mm.pdf', 'order'],
  ['label-100x150mm', 'html-shipping-label-80mm.pdf', 'order'],
]) {
  const result = await generateDocument({
    order,
    format,
    template,
    orderId: order.id,
    documentKind,
  });
  writeFileSync(resolve(output, filename), result.bytes);
}
