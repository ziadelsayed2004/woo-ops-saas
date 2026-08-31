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

test('renders the export workspace with profile, selection preview, and progress controls @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Exports' }).click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Order exports' })).toBeVisible();
  await page.getByLabel('Selection ID').fill('selection-1');
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('export-preview')).toContainText('1001');
});

test('export workspace has no automated accessibility violations @a11y @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Exports' }).click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
