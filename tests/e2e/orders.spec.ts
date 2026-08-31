import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const order = {
  id: 'order-1',
  orderNumber: '1001',
  externalOrderId: 'woo-42',
  origin: 'woo',
  connectionId: 'store-egypt',
  remoteStatus: 'processing',
  localStatus: 'new',
  exportState: 'never-exported',
  currency: 'EGP',
  grandTotalMinor: '125050',
  createdAt: '2026-08-30T08:00:00.000Z',
  modifiedAt: '2026-08-30T09:00:00.000Z',
  channel: 'online',
  posLocation: 'Cairo POS',
  externalCustomerId: 'customer-12',
  billing: {
    first_name: 'أحمد',
    last_name: 'علي',
    email: 'ahmed@example.test',
    phone: '01000000000',
    address_1: 'شارع النيل ١',
    city: 'القاهرة',
    postcode: '11511',
    country: 'EG',
  },
  shipping: {
    first_name: 'أحمد',
    last_name: 'علي',
    address_1: 'شارع النيل ١',
    city: 'القاهرة',
    postcode: '11511',
    country: 'EG',
  },
  payment: { title: 'الدفع عند الاستلام', status: 'pending' },
  paymentStatus: 'pending',
  shippingMethod: { title: 'الشحن القياسي', actualCostMinor: '2500' },
  amounts: {
    merchandiseNetMinor: '110000',
    discountMinor: '0',
    shippingCollectedMinor: '10000',
    taxMinor: '5050',
    feesMinor: '0',
    refundMinor: '0',
    collectedMinor: '125050',
  },
  lines: [
    {
      externalLineId: 'line-1',
      name: 'قميص قطني',
      sku: 'SHIRT-01',
      quantity: 2,
      subtotalMinor: '110000',
      totalMinor: '110000',
    },
  ],
  refunds: [],
  tags: ['priority'],
  notesSummary: 'اتصل قبل التسليم',
  syncPolicy: 'read-only',
  inventoryPolicy: 'observe',
  syncEvents: [{ id: 'sync-1', type: 'order.imported', createdAt: '2026-08-30T09:00:00.000Z' }],
  exportHistory: [],
  documentHistory: [],
  auditHistory: [],
};

async function mockOrderApi(page: Page) {
  const queryBodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    const raw = route.request().postData();
    if (raw) queryBodies.push(JSON.parse(raw) as Record<string, unknown>);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [order], nextCursor: null, hasMore: false }),
    });
  });
  await page.route('**/api/v1/orders/order-1', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order }),
    });
  });
  return queryBodies;
}

test('renders bounded Arabic orders workspace and keyboard detail navigation @orders', async ({
  page,
}) => {
  const queryBodies = await mockOrderApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'إدارة الطلبات' })).toBeVisible();
  await expect(page.getByTestId('orders-table')).toBeVisible();
  expect(queryBodies.some((body) => body.limit === 50)).toBe(true);

  const row = page.getByTestId('order-row-order-1');
  await expect(row).toHaveCount(1);
  await row.press('Enter');
  await expect(page.getByText('بيانات المنصة')).toBeVisible();
  await expect(page.getByText('قميص قطني')).toBeVisible();

  const itemsTab = page.getByRole('tab', { name: 'المنتجات' });
  await expect(itemsTab).toHaveCount(1);
  await itemsTab.click();
  await expect(page.getByRole('cell', { name: 'SHIRT-01' })).toBeVisible();

  const closeButton = page.getByRole('button', { name: 'إغلاق' });
  await expect(closeButton).toHaveCount(1);
  await closeButton.click();

  const directionButton = page.getByRole('button', { name: 'التبديل إلى LTR' });
  await expect(directionButton).toHaveCount(1);
  await directionButton.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

  const languageButton = page.getByRole('button', { name: 'English' });
  await expect(languageButton).toHaveCount(1);
  await languageButton.click();
  await expect(page.getByRole('heading', { name: 'Orders workspace' })).toBeVisible();
});

test('has no automated accessibility violations in the orders workspace @a11y @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps a deterministic visual baseline for the Arabic workspace @visual @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await expect(page).toHaveScreenshot('orders-workspace.png', { animations: 'disabled' });
});
