import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateDocument } from '../dist/index.js';

process.env.WOO_OPS_DOCUMENT_RENDERER = 'portable';
const output = resolve('output/pdf');
mkdirSync(output, { recursive: true });
const fontBytes = new Uint8Array(readFileSync('C:/Windows/Fonts/arial.ttf'));
const order = {
  id: '3586', orderNumber: '3586', currency: 'EGP', createdAt: '2026-09-21T12:30:00.000Z', grandTotalMinor: '35400',
  billing: { name: 'عميل وسط البلد', phone: '01012345678', email: 'customer@example.com' },
  shipping: { address_1: 'شارع التحرير، الدقي', city: 'الجيزة', state: 'الجيزة' },
  paymentMethodTitle: 'محفظة إلكترونية', shippingMethodTitle: 'الشحن عبر فاتورتك',
  amounts: { merchandiseNetMinor: '29400', shippingCollectedMinor: '6000' },
  lines: [
    { name: 'كتاب المراجعة النهائية - الصف الثالث الثانوي', quantity: 1, totalMinor: '18000' },
    { name: 'كتاب الامتحانات والتدريبات', quantity: 1, totalMinor: '11400' },
  ],
};
const template = {
  version: 1, name: 'فاتورة وسط البلد', companyName: 'وسط البلد ستور', companyAddress: 'القاهرة، مصر',
  footerText: 'شكرًا لتعاملكم معنا', locale: 'ar-EG', direction: 'rtl', fontBytes,
};
for (const [format, filename, documentKind] of [
  ['a4', 'portable-invoice-a4.pdf', 'invoice'],
  ['thermal-80mm', 'portable-receipt-80mm.pdf', 'order'],
  ['label-100x150mm', 'portable-shipping-label-80mm.pdf', 'order'],
]) {
  const result = await generateDocument({ order, format, template, orderId: order.id, documentKind });
  writeFileSync(resolve(output, filename), result.bytes);
}
