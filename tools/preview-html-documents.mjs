import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-chromium';
import { generateDocument } from '../packages/documents/dist/index.js';

process.env.PLAYWRIGHT_BROWSERS_PATH = '0';
if (process.argv.includes('--logo-bounds')) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(
    await readFile('packages/documents/assets/wasat-al-balad-horizontal.svg', 'utf8'),
  );
  console.log(
    await page.locator('svg').evaluate((svg) => {
      const b = svg.getBBox();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    }),
  );
  await browser.close();
} else {
  await mkdir('output/pdf', { recursive: true });
  const order = {
    id: 'preview',
    orderNumber: '3586',
    currency: 'EGP',
    createdAt: '2026-09-21T12:00:00Z',
    billing: {
      first_name: 'أحمد',
      last_name: 'محمد عبد الرحمن',
      phone: '01012345678',
      email: 'customer@example.test',
    },
    shipping: {
      address_1: '١٢ شارع طلعت حرب، الدور الثالث، شقة ٧',
      city: 'وسط البلد',
      governorateNameAr: 'القاهرة',
    },
    paymentMethodTitle: 'الدفع عند الاستلام',
    shippingMethodTitle: 'توصيل إلى عنوان العميل',
    lines: [
      { name: 'كتاب الامتحان — الأحياء للصف الثالث الثانوي', quantity: 2, totalMinor: '52000' },
      { name: 'كراسة مراجعة نهائية — اللغة العربية', quantity: 1, totalMinor: '18500' },
      { name: 'قلم جاف أزرق', quantity: 3, totalMinor: '1950' },
    ],
    amounts: { merchandiseNetMinor: '72450', shippingCollectedMinor: '6000' },
    grandTotalMinor: '78450',
  };
  const template = {
    id: 'preview',
    version: 3,
    name: 'فاتورة وسط البلد',
    companyName: 'وسط البلد',
    direction: 'rtl',
    locale: 'ar-EG',
  };
  for (const [format, name] of [
    ['a4', 'invoice-a4'],
    ['thermal-80mm', 'receipt-80mm'],
    ['label-100x150mm', 'shipping-label-80mm'],
  ]) {
    const result = await generateDocument({ order, template, format });
    await writeFile(`output/pdf/${name}.pdf`, result.bytes);
    console.log(name, result.pageCount, result.widthPoints, result.heightPoints);
  }
}
