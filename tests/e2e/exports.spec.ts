import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const profile = {
  id: 'profile-1',
  name: 'Courier export',
  description: null,
  active: true,
};
const version = {
  id: 'version-1',
  profileId: 'profile-1',
  version: 1,
  format: 'xlsx',
  rowMode: 'order',
  columns: [{ key: 'orderNumber', label: 'Order', type: 'text' }],
  filenameTemplate: 'shipping-{format}',
};

async function mockExports(page: Page) {
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false, totalCount: 0 } });
  });
  await page.route('**/api/v1/export-profiles', async (route: Route) => {
    await route.fulfill({ json: { items: [profile] } });
  });
  await page.route('**/api/v1/export-profiles/profile-1/versions', async (route: Route) => {
    await route.fulfill({ json: { items: [version] } });
  });
  await page.route('**/api/v1/export-batches', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/document-jobs?limit=30', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/saved-views', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/selections', async (route: Route) => {
    await route.fulfill({ json: { selection: { id: 'selection-1' } } });
  });
  await page.route('**/api/v1/export-profiles/profile-1/preview', async (route: Route) => {
    await route.fulfill({
      json: {
        preview: {
          columns: version.columns,
          rows: [['1001']],
          orderCount: 1,
          rowCount: 1,
          errors: [],
          warnings: [],
        },
        selection: { hasMore: false, totalCount: 1 },
      },
    });
  });
}

test('shows export history in orders without standalone export navigation @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Export batches' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exports', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Orders to export')).toHaveCount(0);
  await expect(page.getByLabel('Saved profiles')).toHaveCount(0);
  await expect(page.getByLabel('Profile version')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preview' })).toHaveCount(0);
});

test('does not load profiles merely to show order export history @exports', async ({ page }) => {
  let profileReads = 0;
  await mockExports(page);
  await page.unroute('**/api/v1/export-profiles');
  await page.route('**/api/v1/export-profiles', async (route: Route) => {
    profileReads += 1;
    await route.fulfill({ json: { items: [profile] } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  expect(profileReads).toBe(0);
});

test('export workspace has no automated accessibility violations @a11y @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
