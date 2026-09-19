import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const definitions = [
  'grossSalesMinor',
  'discountMinor',
  'netMerchandiseMinor',
  'shippingCollectedMinor',
  'taxMinor',
  'refundsMinor',
  'collectedRevenueMinor',
  'cogsMinor',
  'actualShippingCostMinor',
  'paymentFeesMinor',
  'returnCostMinor',
  'contributionProfitMinor',
].map((key) => ({
  key,
  label: key,
  formula: `${key} formula`,
  excludedStatuses: ['cancelled', 'failed', 'trash'],
}));

const totals = {
  grossSalesMinor: '150000',
  discountMinor: '5000',
  netMerchandiseMinor: '145000',
  shippingCollectedMinor: '10000',
  taxMinor: '5000',
  refundsMinor: '0',
  collectedRevenueMinor: '160000',
  cogsMinor: '70000',
  actualShippingCostMinor: '5000',
  paymentFeesMinor: '2000',
  returnCostMinor: '0',
  contributionProfitMinor: '68000',
};

async function mockAnalyticsApi(page: Page, empty = false) {
  const requestBodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false } });
  });
  await page.route('**/api/v1/analytics/summary', async (route: Route) => {
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        summary: {
          source: 'combined',
          from: null,
          to: null,
          excludedStatuses: ['cancelled', 'failed', 'trash'],
          metricsVersion: 1,
          definitions,
          freshness: { lastRebuiltAt: '2026-08-30T10:00:00.000Z' },
          costCoverage: { coveredLines: 8, totalLines: 10, percentage: 80 },
          currencies: empty ? [] : [{ currency: 'EGP', orderCount: 4, lineCount: 8, totals }],
        },
      },
    });
  });
  await page.route('**/api/v1/analytics/timeseries', async (route: Route) => {
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        timeseries: {
          source: 'combined',
          items: empty
            ? []
            : [
                {
                  date: '2026-08-29',
                  currency: 'EGP',
                  source: 'woo',
                  orderCount: 2,
                  lineCount: 4,
                  totals,
                },
                {
                  date: '2026-08-30',
                  currency: 'EGP',
                  source: 'manual',
                  orderCount: 2,
                  lineCount: 4,
                  totals,
                },
              ],
        },
      },
    });
  });
  await page.route('**/api/v1/analytics/breakdown', async (route: Route) => {
    requestBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      json: {
        breakdown: {
          dimension: 'source',
          source: 'combined',
          items: empty
            ? []
            : [
                { key: 'manual', currency: 'EGP', orderCount: 2, lineCount: 4, totals },
                { key: 'woo', currency: 'EGP', orderCount: 2, lineCount: 4, totals },
              ],
        },
      },
    });
  });
  return requestBodies;
}

async function openAnalytics(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Analytics' }).click();
  await expect(page.getByTestId('analytics-workspace')).toBeVisible();
}

test('renders revenue, profit, sources and explainable analytics in English layout @analytics', async ({
  page,
}) => {
  const requestBodies = await mockAnalyticsApi(page);
  await openAnalytics(page);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Sales analytics dashboard' })).toBeVisible();
  await expect(page.getByTestId('analytics-revenue')).toContainText('1,600.00 EGP');
  await expect(page.getByTestId('analytics-profit')).toContainText('680.00 EGP');
  await expect(page.getByText('Combined').first()).toBeVisible();
  await expect(page.getByText('Formulas and exclusions')).toBeVisible();
  await expect(page.getByText('80% (8/10)')).toBeVisible();
  await expect(page.getByTestId('analytics-trend')).toBeVisible();
  await expect(page.getByTestId('analytics-breakdown')).toBeVisible();
  await page.getByLabel('Break down by').click();
  await expect(page.getByRole('option', { name: 'WooCommerce status' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Manual order lifecycle' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Export state' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Governorate / region' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByLabel('Store / connection ID').fill('store-egypt');
  await page.getByLabel('Shipping method').fill('courier');
  await page.getByLabel('Product / SKU').fill('shirt');
  await page.getByLabel('Category').fill('clothing');
  await page.getByLabel('Author').fill('author-1');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect
    .poll(() =>
      requestBodies.some(
        (body) => body.store === 'store-egypt' && body.shippingMethod === 'courier',
      ),
    )
    .toBe(true);
  await expect
    .poll(() =>
      requestBodies.some((body) => body.product === 'shirt' && body.category === 'clothing'),
    )
    .toBe(true);
});

test('isolates currency values from Arabic RTL reordering @analytics', async ({ page }) => {
  await mockAnalyticsApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'التحليلات' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  const revenue = page.getByTestId('analytics-revenue').locator('[dir="ltr"]');
  const profit = page.getByTestId('analytics-profit').locator('[dir="ltr"]');
  await expect(revenue).toHaveText('1,600.00 EGP');
  await expect(profit).toHaveText('680.00 EGP');
});

test('shows an explicit empty state when filters have no facts @analytics', async ({ page }) => {
  await mockAnalyticsApi(page, true);
  await openAnalytics(page);
  await expect(page.getByTestId('analytics-empty')).toBeVisible();
  await expect(page.getByText('No analytics facts match these filters')).toBeVisible();
});

test('analytics workspace has no automated accessibility violations @a11y @analytics', async ({
  page,
}) => {
  await mockAnalyticsApi(page);
  await openAnalytics(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('keeps a deterministic analytics dashboard visual baseline @visual @dashboard', async ({
  page,
}) => {
  await mockAnalyticsApi(page);
  await openAnalytics(page);
  await expect(page.getByTestId('analytics-breakdown')).toBeVisible();
  await expect(page).toHaveScreenshot('analytics-dashboard.png', {
    animations: 'disabled',
    fullPage: true,
  });
});
