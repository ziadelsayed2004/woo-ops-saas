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
      body: JSON.stringify({
        items: [order],
        nextCursor: null,
        hasMore: false,
        facets: [
          { field: 'remoteStatus', values: [{ value: 'processing', count: 1 }] },
          { field: 'governorate', values: [{ value: 'Cairo', count: 1 }] },
        ],
      }),
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
  await expect(page.locator('[data-testid="navigation-connections"]:visible')).not.toContainText(
    'تخصيص بيانات المتجر',
  );
  await expect(page.getByText('خرائط الحقول', { exact: true })).toHaveCount(0);
  const mappingNav = page.locator('[data-testid="navigation-connections"]:visible');
  const mappingIcon = page.locator('[data-testid="navigation-connections-icon"]:visible');
  const [navigationBox, iconBox] = await Promise.all([
    mappingNav.boundingBox(),
    mappingIcon.boundingBox(),
  ]);
  expect(navigationBox).not.toBeNull();
  expect(iconBox).not.toBeNull();
  expect(iconBox!.x).toBeGreaterThan(navigationBox!.x + navigationBox!.width / 2);
  await expect(page.getByTestId('orders-table')).toBeVisible();
  expect(queryBodies.some((body) => body.limit === 50)).toBe(true);
  expect(queryBodies.some((body) => body.includeFacets === true)).toBe(true);

  const scroller = page.getByTestId('orders-table-scroll');
  await expect(scroller).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  await expect(page.getByTestId('saved-order-filters')).toHaveCount(0);
  const savedFiltersButton = page.locator('button[aria-controls="saved-order-filters"]');
  await savedFiltersButton.click();
  await expect(page.getByTestId('saved-order-filters')).toBeVisible();
  await expect(page.getByTestId('orders-table').locator('th').nth(1)).toHaveCSS(
    'text-align',
    'right',
  );
  await expect(page.getByText('لم يُصدّر', { exact: true })).toBeVisible();

  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: 'تصدير Excel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تصدير CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'فاتورة A4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'إيصال حراري' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'بوليصة شحن' })).toBeVisible();
  await page.getByTestId('order-row-order-1').getByRole('checkbox').uncheck();

  await page.getByRole('button', { name: 'فلاتر متقدمة' }).click();
  const filterGrid = page.getByTestId('advanced-order-filters');
  await expect(filterGrid).toBeVisible();
  await expect(page.getByLabel('المحافظة / المنطقة')).toBeVisible();
  const governorateControl = page
    .getByLabel('المحافظة / المنطقة')
    .locator('xpath=ancestor::div[contains(@class,"MuiAutocomplete-root")]');
  const [governorateBox, governorateIndicatorBox] = await Promise.all([
    governorateControl.boundingBox(),
    governorateControl.locator('.MuiAutocomplete-popupIndicator').boundingBox(),
  ]);
  expect(governorateBox).not.toBeNull();
  expect(governorateIndicatorBox).not.toBeNull();
  expect(governorateIndicatorBox!.x).toBeLessThan(governorateBox!.x + governorateBox!.width / 2);
  await page.getByLabel('المحافظة / المنطقة').click();
  await page.getByRole('option', { name: 'القاهرة' }).click();
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect
    .poll(() => queryBodies.at(-1))
    .toMatchObject({
      filter: {
        field: 'governorate',
        operator: 'contains',
        value: 'Cairo',
      },
    });

  const row = page.getByTestId('order-row-order-1');
  await expect(row).toHaveCount(1);
  await row.press('Enter');
  await expect(page.getByText('بيانات المنصة')).toBeVisible();
  const arabicDrawerBox = await page
    .locator('.MuiDrawer-paper[role="dialog"]:visible')
    .filter({ hasText: 'بيانات المنصة' })
    .boundingBox();
  expect(arabicDrawerBox).not.toBeNull();
  expect(arabicDrawerBox!.x + arabicDrawerBox!.width / 2).toBeGreaterThan(
    page.viewportSize()!.width / 2,
  );
  await expect(page.getByText('قميص قطني')).toBeVisible();

  const itemsTab = page.getByRole('tab', { name: 'المنتجات' });
  await expect(itemsTab).toHaveCount(1);
  await itemsTab.click();
  await expect(page.getByRole('cell', { name: 'SHIRT-01' })).toBeVisible();

  const closeButton = page.getByRole('button', { name: 'إغلاق' });
  await expect(closeButton).toHaveCount(1);
  await closeButton.click();

  const languageButton = page.getByRole('button', { name: 'English' });
  await expect(languageButton).toHaveCount(1);
  await languageButton.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Orders workspace' })).toBeVisible();
  await page.getByTestId('order-row-order-1').press('Enter');
  await expect(page.getByText('Platform facts')).toBeVisible();
  const englishDrawerBox = await page
    .locator('.MuiDrawer-paper[role="dialog"]:visible')
    .filter({ hasText: 'Platform facts' })
    .boundingBox();
  expect(englishDrawerBox).not.toBeNull();
  expect(englishDrawerBox!.x + englishDrawerBox!.width / 2).toBeLessThan(
    page.viewportSize()!.width / 2,
  );
});

test('has no automated accessibility violations in the orders workspace @a11y @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps a saved filter selected, applies its exact query and deletes it', async ({ page }) => {
  const queryBodies = await mockOrderApi(page);
  let deleted = false;
  await page.route('**/api/v1/saved-views', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'saved-processing',
            name: 'Processing orders',
            query: {
              search: 'Ahmed',
              filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
            },
            sort: { field: 'remoteCreatedAt', direction: 'desc' },
            columns: ['orderNumber', 'remoteStatus'],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/saved-views/saved-processing', async (route) => {
    deleted = route.request().method() === 'DELETE';
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/');
  await page.locator('button[aria-controls="saved-order-filters"]').click();
  await page.getByTestId('saved-order-filters').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Processing orders' }).click();
  await expect(page.getByTestId('saved-order-filters').getByRole('combobox')).toContainText(
    'Processing orders',
  );
  await expect.poll(() => queryBodies.at(-1)?.search).toBe('Ahmed');
  await page.locator('#saved-order-filters button.MuiButton-colorError').click();
  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByText('Processing orders')).toHaveCount(0);
});

test('keeps a deterministic visual baseline for the Arabic workspace @visual @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await expect(page).toHaveScreenshot('orders-workspace.png', { animations: 'disabled' });
});
