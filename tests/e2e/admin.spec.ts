import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = {
  id: 'user-1',
  accountId: 'account-1',
  email: 'admin@example.test',
  role: 'admin',
} as const;
const account = {
  id: 'account-1',
  name: 'Demo account',
  locale: 'ar-EG',
  direction: 'rtl',
  timezone: 'Africa/Cairo',
  baseCurrency: 'EGP',
} as const;
const connection = {
  id: 'connection-1',
  platform: 'woocommerce',
  storeUrl: 'https://shop.example.test',
  displayName: 'Demo shop',
  status: 'active',
  healthStatus: 'healthy',
  syncStatus: 'succeeded',
  syncLastSuccessAt: '2026-08-31T08:00:00.000Z',
  syncOrdersCount: 12,
  syncCatalogCount: 8,
};
const analyticsTotals = {
  grossSalesMinor: '0',
  discountMinor: '0',
  netMerchandiseMinor: '0',
  shippingCollectedMinor: '0',
  taxMinor: '0',
  refundsMinor: '0',
  collectedRevenueMinor: '0',
  cogsMinor: '0',
  actualShippingCostMinor: '0',
  paymentFeesMinor: '0',
  returnCostMinor: '0',
  contributionProfitMinor: '0',
};

async function mockAdminApi(page: Page, session: 'authenticated' | 'expired' = 'authenticated') {
  let sessionCalls = 0;
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    if (session === 'expired' && sessionCalls++ < 2) {
      await route.fulfill({ status: 401, json: { error: { code: 'AUTH_UNAUTHENTICATED' } } });
      return;
    }
    await route.fulfill({ json: { user } });
  });
  await page.route('**/api/v1/auth/login', async (route: Route) => {
    await route.fulfill({ json: { user } });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false, totalCount: 0 } });
  });
  await page.route('**/api/v1/account', async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { account } });
      return;
    }
    await route.fulfill({ json: { account, user } });
  });
  await page.route('**/api/v1/operations/health', async (route: Route) => {
    await route.fulfill({
      json: {
        health: {
          database: 'connected',
          schemaVersion: 22,
          queue: { queued: 1, running: 0, deadLettered: 0 },
        },
        runner: {
          running: true,
          active: 0,
          registeredTypes: ['analytics.rebuild', 'field-mapping.backfill'],
        },
      },
    });
  });
  await page.route('**/api/v1/operations/usage', async (route: Route) => {
    await route.fulfill({
      json: {
        usage: {
          total: 2,
          queued: 1,
          running: 0,
          succeeded: 1,
          failed: 0,
          deadLettered: 0,
          payloadBytes: 20,
        },
      },
    });
  });
  await page.route('**/api/v1/operations/jobs?limit=50', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'job-1',
            type: 'analytics.rebuild',
            status: 'queued',
            progress: 25,
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            cancelRequested: false,
            createdAt: '2026-08-31T08:00:00.000Z',
            updatedAt: '2026-08-31T08:00:00.000Z',
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/operations/dead-letters?limit=50', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/operations/maintenance', async (route: Route) => {
    await route.fulfill({
      status: 202,
      json: {
        job: {
          id: 'maintenance-1',
          type: 'maintenance',
          status: 'queued',
          progress: 0,
          attempts: 0,
          maxAttempts: 3,
          lastError: null,
          cancelRequested: false,
          createdAt: '2026-08-31T08:00:00.000Z',
          updatedAt: '2026-08-31T08:00:00.000Z',
        },
      },
    });
  });
  await page.route('**/api/v1/connections', async (route: Route) => {
    await route.fulfill({ json: { items: [connection] } });
  });
  await page.route('**/api/v1/connections/connection-1/fields', async (route: Route) => {
    await route.fulfill({
      json: {
        catalog: [
          {
            id: 'field-1',
            connectionId: connection.id,
            scope: 'order',
            sourceKey: 'pos_location',
            sensitivity: 'safe',
            inferredType: 'text',
            occurrences: 4,
            sample: 'Cairo',
            discoveredAt: '2026-08-31T08:00:00.000Z',
          },
        ],
        mappings: [],
      },
    });
  });
  await page.route('**/api/v1/members', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            userId: user.id,
            email: user.email,
            role: 'admin',
            status: 'active',
            createdAt: '2026-08-31T08:00:00.000Z',
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/members/invitations', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/analytics/summary', async (route: Route) => {
    await route.fulfill({
      json: {
        summary: {
          source: 'combined',
          from: null,
          to: null,
          excludedStatuses: ['cancelled', 'failed', 'trash'],
          metricsVersion: 1,
          definitions: [],
          currencies: [
            {
              currency: 'EGP',
              orderCount: 3,
              lineCount: 4,
              totals: { ...analyticsTotals, collectedRevenueMinor: '12500', refundsMinor: '500' },
            },
            {
              currency: 'USD',
              orderCount: 1,
              lineCount: 1,
              totals: { ...analyticsTotals, collectedRevenueMinor: '2500' },
            },
          ],
          freshness: { lastRebuiltAt: '2026-08-31T08:00:00.000Z', status: 'succeeded' },
          costCoverage: { coveredLines: 2, totalLines: 5, percentage: 40 },
        },
      },
    });
  });
  await page.route('**/api/v1/analytics/timeseries', async (route: Route) => {
    await route.fulfill({
      json: {
        timeseries: {
          items: [
            {
              date: new Date().toISOString().slice(0, 10),
              currency: 'EGP',
              source: 'woo',
              orderCount: 3,
              lineCount: 4,
              totals: { ...analyticsTotals, collectedRevenueMinor: '12500' },
            },
            {
              date: new Date().toISOString().slice(0, 10),
              currency: 'USD',
              source: 'manual',
              orderCount: 1,
              lineCount: 1,
              totals: { ...analyticsTotals, collectedRevenueMinor: '2500' },
            },
          ],
        },
      },
    });
  });
  await page.route('**/api/v1/analytics/breakdown', async (route: Route) => {
    if ((route.request().postDataJSON() as { dimension?: string }).dimension === 'product') {
      await route.fulfill({
        json: {
          breakdown: {
            items: [
              {
                key: 'product-1',
                label: 'Notebook',
                currency: 'EGP',
                orderCount: 3,
                lineCount: 4,
                totals: { ...analyticsTotals, netMerchandiseMinor: '9000' },
              },
              {
                key: 'product-2',
                label: 'Pen',
                currency: 'USD',
                orderCount: 1,
                lineCount: 1,
                totals: { ...analyticsTotals, netMerchandiseMinor: '2000' },
              },
            ],
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        breakdown: {
          items: [
            {
              key: 'customer-1',
              label: 'Customer One',
              currency: 'EGP',
              orderCount: 3,
              lineCount: 4,
              totals: { collectedRevenueMinor: '12500' },
            },
          ],
        },
      },
    });
  });
  await page.route('**/api/v1/customers?limit=100', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            key: 'woo:1',
            externalCustomerId: '1',
            name: 'Customer One',
            email: 'customer@example.test',
            phone: '01000000000',
            orderCount: 3,
            firstOrderAt: '2026-08-01T00:00:00.000Z',
            lastOrderAt: '2026-08-31T00:00:00.000Z',
            currencies: [{ currency: 'EGP', orderCount: 3, totalSpendMinor: '12500' }],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/customers/woo%3A1?limit=25', async (route: Route) => {
    await route.fulfill({
      json: {
        customer: {
          key: 'woo:1',
          externalCustomerId: '1',
          name: 'Customer One',
          email: 'customer@example.test',
          phone: '01000000000',
          orderCount: 3,
          firstOrderAt: '2026-08-01T00:00:00.000Z',
          lastOrderAt: '2026-08-31T00:00:00.000Z',
          currencies: [{ currency: 'EGP', orderCount: 3, totalSpendMinor: '12500' }],
          customer: {},
          billing: { address_1: '1 Main Street', city: 'Cairo' },
          shipping: { address_1: '1 Main Street', city: 'Cairo' },
          recentOrders: [
            {
              id: 'order-1',
              orderNumber: '1001',
              remoteStatus: 'processing',
              grandTotalMinor: '12500',
              currency: 'EGP',
              remoteCreatedAt: '2026-08-31T00:00:00.000Z',
            },
          ],
        },
      },
    });
  });
}

test('admin navigation exposes authenticated operational workspaces and route states @admin', async ({
  page,
}, testInfo) => {
  await mockAdminApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Overview' }).click();
  await expect(page.getByTestId('admin-overview')).toBeVisible();
  await expect(page.getByTestId('overview-currency-EGP')).toContainText('125.00 EGP');
  await expect(page.getByTestId('overview-currency-USD')).toContainText('25.00 USD');
  await expect(page.getByTestId('overview-currency-EGP')).toContainText('Notebook');
  await expect(page.getByTestId('admin-overview')).not.toContainText('Job queue');
  await page.screenshot({ path: testInfo.outputPath('overview.png'), fullPage: true });
  await page.getByRole('button', { name: 'WooCommerce connection' }).click();
  await expect(page.getByTestId('connections-workspace')).toBeVisible();
  await expect(
    page.getByText(
      'One WooCommerce store can be active for this account. Disconnect the current store from Settings before connecting another.',
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start WooCommerce connection' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-workspace')).toBeVisible();
  await expect(page.getByTestId('settings-data-health')).toContainText('Job queue');
  await expect(page.getByTestId('settings-data-health')).toContainText('Demo shop');
  await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
  await page.getByRole('button', { name: 'Customers' }).click();
  await expect(page.getByTestId('customers-workspace')).toBeVisible();
  await expect(page.getByText('Customer One')).toBeVisible();
  await expect(page.getByText('125.00 EGP')).toBeVisible();
  await page.getByText('Customer One').click();
  await expect(page.getByText('Billing address')).toBeVisible();
  await expect(page.getByText('1 Main Street، Cairo').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'System health' }).click();
  await expect(page.getByTestId('operations-workspace')).toBeVisible();
  await expect(page.getByText('analytics.rebuild')).toBeVisible();
  await page.getByRole('button', { name: 'Run system maintenance' }).click();
  await expect(page.getByText('System maintenance was queued.')).toBeVisible();
});

test('overview keeps account currencies separate and shows partial analytics without hiding summary @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  let summaryFilter: { from?: string; to?: string } = {};
  await page.route('**/api/v1/analytics/summary', async (route: Route) => {
    summaryFilter = route.request().postDataJSON() as { from?: string; to?: string };
    await route.fulfill({
      json: {
        summary: {
          currencies: [
            {
              currency: 'EGP',
              orderCount: 2,
              lineCount: 2,
              totals: { ...analyticsTotals, collectedRevenueMinor: '5000' },
            },
          ],
          freshness: { lastRebuiltAt: null },
          costCoverage: { coveredLines: 0, totalLines: 2, percentage: 0 },
        },
      },
    });
  });
  await page.route('**/api/v1/analytics/timeseries', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }),
  );
  await page.goto('/overview');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('overview-currency-EGP')).toContainText('50.00 EGP');
  await expect(page.getByTestId('overview-currency-USD')).toHaveCount(0);
  await expect(page.getByTestId('admin-overview')).toContainText('temporarily unavailable');
  await expect(page.getByTestId('admin-overview')).toContainText('Profit is omitted');
  expect(summaryFilter.from).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  expect(summaryFilter.to).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
});

test('settings diagnostics fail independently of editable account settings @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.route('**/api/v1/operations/health', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }),
  );
  await page.goto('/settings');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('settings-data-health')).toContainText(
    'Some diagnostics are unavailable',
  );
  await expect(page.getByRole('textbox', { name: 'Account name' })).toHaveValue('Demo account');
  await page.getByRole('textbox', { name: 'Account name' }).fill('Unsaved name');
  await page.getByTestId('settings-data-health').getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('textbox', { name: 'Account name' })).toHaveValue('Unsaved name');
});

test('overview explains when the selected period has no analyzed orders @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.route('**/api/v1/analytics/summary', (route) =>
    route.fulfill({ json: { summary: { currencies: [], freshness: { lastRebuiltAt: null } } } }),
  );
  await page.goto('/overview');
  await expect(page.getByTestId('overview-empty')).toBeVisible();
  await expect(page.getByTestId('overview-currency-EGP')).toHaveCount(0);
});

test('overview and settings data status fit a narrow Arabic viewport @admin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminApi(page);
  await page.goto('/overview');
  await expect(page.getByTestId('overview-currency-EGP')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-data-health')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('filters the customer directory by purchased product and opens an order without losing customer context @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.route('**/api/v1/catalog?*', async (route: Route) => {
    await route.fulfill({
      json: { items: [{ externalId: '101', name: 'Notebook', sku: 'NOTE-1' }] },
    });
  });
  await page.route('**/api/v1/customers?*', async (route: Route) => {
    const productId = new URL(route.request().url()).searchParams.get('productId');
    const customers = [
      {
        key: 'woo:1',
        externalCustomerId: '1',
        name: 'Customer One',
        email: 'one@example.test',
        phone: null,
        orderCount: 3,
        firstOrderAt: null,
        lastOrderAt: null,
        currencies: [],
      },
      {
        key: 'woo:2',
        externalCustomerId: '2',
        name: 'Customer Two',
        email: 'two@example.test',
        phone: null,
        orderCount: 1,
        firstOrderAt: null,
        lastOrderAt: null,
        currencies: [],
      },
    ];
    await route.fulfill({
      json: { items: productId === '101' ? customers.slice(0, 1) : customers, nextCursor: null },
    });
  });
  await page.route('**/api/v1/orders/order-1', async (route: Route) => {
    await route.fulfill({
      json: {
        order: {
          id: 'order-1',
          orderNumber: '1001',
          origin: 'woo',
          remoteStatus: 'processing',
          exportState: 'never-exported',
          currency: 'EGP',
          grandTotalMinor: '12500',
          lines: [],
          billing: {},
          shipping: {},
        },
      },
    });
  });

  await page.goto('/members');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Customer Two')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter customers by product' }).fill('Notebook');
  await page.getByRole('option', { name: 'Notebook · NOTE-1' }).click();
  await expect(page.getByText('Customer Two')).toHaveCount(0);
  await page.getByText('Customer One').click();
  const customerDialog = page.locator('.customer-detail-dialog__paper');
  await expect(customerDialog).toBeVisible();
  await expect(customerDialog.getByText('Billing address')).toBeVisible();
  await expect(customerDialog).toHaveCSS('border-radius', '12px');
  await customerDialog.getByRole('button', { name: 'Open order details 1001' }).click();
  await expect(page.getByRole('document', { name: /Order details #1001/u })).toBeVisible();
  await expect(customerDialog).toBeHidden();
  await page
    .getByRole('document', { name: /Order details #1001/u })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(customerDialog).toBeVisible();
  await expect(customerDialog.getByText('Billing address')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => (await customerDialog.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(390);
});

test('customer dialog and order detail retain Arabic direction and fit a narrow viewport @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.route('**/api/v1/orders/order-1', async (route: Route) => {
    await route.fulfill({
      json: {
        order: {
          id: 'order-1',
          orderNumber: '1001',
          origin: 'woo',
          remoteStatus: 'processing',
          exportState: 'never-exported',
          currency: 'EGP',
          grandTotalMinor: '12500',
          lines: [],
          billing: {},
          shipping: {},
        },
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/members');
  await page.getByText('Customer One').click();
  const customerDialog = page.locator('.customer-detail-dialog__paper');
  await expect(customerDialog).toHaveAttribute('dir', 'rtl');
  await expect
    .poll(async () => (await customerDialog.boundingBox())?.width ?? 0)
    .toBeLessThanOrEqual(390);
  await customerDialog.getByRole('button', { name: /عرض تفاصيل الطلب 1001/u }).click();
  const drawer = page.locator('.order-detail-drawer__paper');
  await expect(drawer).toHaveAttribute('dir', 'rtl');
  await expect.poll(async () => (await drawer.boundingBox())?.x ?? -1).toBe(0);
});

test('expired sessions return to login and can authenticate again @admin', async ({ page }) => {
  await mockAdminApi(page, 'expired');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await page.getByLabel('البريد الإلكتروني').fill('admin@example.test');
  await page.getByLabel('كلمة المرور').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
});

test('Arabic login fields, labels and notches align right while headings stay centered @admin', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH_UNAUTHENTICATED' } } }),
  );
  await page.route('**/api/v1/auth/setup', (route) =>
    route.fulfill({ json: { registrationOpen: false } }),
  );
  await page.goto('/');
  const email = page.getByLabel('البريد الإلكتروني');
  await expect(email).toBeVisible();
  const positions = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="email"]')!;
    const field = input.closest('.MuiFormControl-root')!;
    const label = field.querySelector('label')!;
    const legend = field.querySelector('legend')!;
    const heading = document.querySelector('h1')!;
    const subtitle = document.querySelector('h2')!;
    const paper = document.querySelector('main')!;
    const center = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    return {
      inputAlign: getComputedStyle(input).textAlign,
      fieldRight: field.getBoundingClientRect().right,
      labelRight: label.getBoundingClientRect().right,
      legendRight: legend.getBoundingClientRect().right,
      headingCenter: center(heading),
      subtitleCenter: center(subtitle),
      paperCenter: center(paper),
    };
  });
  expect(positions.inputAlign).toBe('right');
  expect(positions.fieldRight - positions.labelRight).toBeLessThan(40);
  expect(positions.fieldRight - positions.legendRight).toBeLessThan(40);
  expect(Math.abs(positions.headingCenter - positions.paperCenter)).toBeLessThan(5);
  expect(Math.abs(positions.subtitleCenter - positions.paperCenter)).toBeLessThan(5);
});

test('Arabic outlined selects keep arrows opposite right-hand labels @admin', async ({ page }) => {
  await mockAdminApi(page);
  await page.goto('/settings');
  const positions = await page.getByTestId('settings-workspace').evaluate((workspace) => {
    const select = workspace.querySelector('.MuiSelect-select')!;
    const field = select.closest('.MuiFormControl-root')!;
    const label = field.querySelector('label')!;
    const legend = field.querySelector('legend')!;
    const icon = field.querySelector('.MuiSelect-icon')!;
    return {
      selectAlign: getComputedStyle(select).textAlign,
      fieldLeft: field.getBoundingClientRect().left,
      fieldRight: field.getBoundingClientRect().right,
      labelRight: label.getBoundingClientRect().right,
      legendRight: legend.getBoundingClientRect().right,
      iconRight: icon.getBoundingClientRect().right,
      iconLeft: icon.getBoundingClientRect().left,
      labelLeft: label.getBoundingClientRect().left,
    };
  });
  expect(positions.selectAlign).toBe('right');
  expect(positions.iconLeft - positions.fieldLeft).toBeGreaterThanOrEqual(12);
  expect(positions.iconLeft - positions.fieldLeft).toBeLessThanOrEqual(18);
  expect(positions.labelLeft - positions.iconRight).toBeGreaterThanOrEqual(8);
  expect(positions.fieldRight - positions.labelRight).toBeGreaterThanOrEqual(12);
  expect(positions.fieldRight - positions.legendRight).toBeGreaterThanOrEqual(8);
});

test('language switch updates text and direction together @admin', async ({ page }) => {
  await mockAdminApi(page);
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible();
});

test('owner can deliberately clear local test data from the settings danger zone @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  const owner = { ...user, role: 'owner' as const };
  let resetBody: Record<string, unknown> | null = null;
  let disconnectBody: Record<string, unknown> | null = null;
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({ json: { user: owner } }));
  await page.route('**/api/v1/account', async (route) => {
    await route.fulfill({ json: { account, user: owner } });
  });
  await page.route('**/api/v1/account/reset', async (route) => {
    resetBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: { reset: true, deletedRecords: 24, preservedConnections: 1 },
    });
  });
  await page.route('**/api/v1/connections/connection-1/disable', async (route) => {
    disconnectBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: { connection: { ...connection, status: 'disabled' } },
    });
  });
  await page.goto('/settings');
  const connectedStoreUrl = page.getByTestId('connected-store-url');
  const disconnectStoreButton = page.getByTestId('disconnect-store-button');
  await expect(page.getByTestId('connected-store-management')).toBeVisible();
  await expect(page.getByTestId('connected-store-identity')).toHaveCSS(
    'justify-items',
    'flex-start',
  );
  const desktopUrlBox = await connectedStoreUrl.boundingBox();
  const desktopButtonBox = await disconnectStoreButton.boundingBox();
  expect(desktopUrlBox).not.toBeNull();
  expect(desktopButtonBox).not.toBeNull();
  if (desktopUrlBox && desktopButtonBox) {
    const horizontalGap =
      desktopButtonBox.x < desktopUrlBox.x
        ? desktopUrlBox.x - (desktopButtonBox.x + desktopButtonBox.width)
        : desktopButtonBox.x - (desktopUrlBox.x + desktopUrlBox.width);
    expect(horizontalGap).toBeGreaterThanOrEqual(16);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('connected-store-management').scrollIntoViewIfNeeded();
  const mobileUrlBox = await connectedStoreUrl.boundingBox();
  const mobileButtonBox = await disconnectStoreButton.boundingBox();
  expect(mobileUrlBox).not.toBeNull();
  expect(mobileButtonBox).not.toBeNull();
  if (mobileUrlBox && mobileButtonBox) {
    expect(mobileButtonBox.y - (mobileUrlBox.y + mobileUrlBox.height)).toBeGreaterThanOrEqual(8);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('account-reset-zone')).toBeVisible();
  await page.getByRole('button', { name: 'Disconnect store' }).click();
  const disconnectDialog = page.getByRole('dialog');
  await disconnectDialog.getByLabel('Type DISCONNECT to confirm').fill('DISCONNECT');
  await disconnectDialog.getByLabel('Current password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Disconnect permanently' }).click();
  await expect(
    page.getByText('The WooCommerce store was disconnected. You can now connect another store.'),
  ).toBeVisible();
  expect(disconnectBody).toEqual({
    confirmation: 'DISCONNECT',
    currentPassword: 'correct horse battery staple',
  });
  await page.getByRole('button', { name: 'Clear test data' }).click();
  const resetDialog = page.getByRole('dialog');
  const confirm = page.getByLabel('Type RESET to confirm');
  await expect(page.getByRole('button', { name: 'Reset account data' })).toBeDisabled();
  await confirm.fill('RESET');
  await resetDialog.getByLabel('Current password').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Reset account data' }).click();
  await expect(
    page.getByText('Account data was cleared. You can now start a fresh WooCommerce sync.'),
  ).toBeVisible();
  expect(resetBody).toEqual({
    confirmation: 'RESET',
    preserveConnections: true,
    currentPassword: 'correct horse battery staple',
  });
});

test('admin workspaces have no automated accessibility violations @a11y @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto('/overview');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile drawer navigates and Woo return shows a safe connection state @admin', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminApi(page);
  await page.goto('/connections/woocommerce/callback?success=1&user_id=opaque-state');
  await expect(page).toHaveURL(/\/connections$/u);
  await expect(page.getByText('تمت الموافقة في WooCommerce.')).toBeVisible();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('button', { name: 'التحليلات' }).click();
  await expect(page.getByTestId('analytics-workspace')).toBeVisible();
});
