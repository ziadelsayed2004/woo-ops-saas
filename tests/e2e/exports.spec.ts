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

test('organizes printable outputs and exposes useful downloads without the manifest @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.unroute('**/api/v1/document-jobs?limit=30');
  await page.route('**/api/v1/document-jobs?limit=30', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'documents-1',
            action: 'generate-label',
            format: 'label-100x150mm',
            status: 'completed',
            totalCount: 2,
            processedCount: 2,
            succeededCount: 2,
            failedCount: 0,
            attemptCount: 1,
            jobId: 'job-1',
            createdAt: '2026-09-21T10:00:00.000Z',
            completedAt: '2026-09-21T10:00:01.000Z',
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/document-jobs/documents-1', async (route: Route) => {
    await route.fulfill({
      json: {
        batch: { id: 'documents-1' },
        artifacts: [
          {
            id: 'pdf-1',
            kind: 'merged-pdf',
            filename: 'labels.pdf',
            mimeType: 'application/pdf',
            byteSize: 120,
            checksum: 'a',
          },
          {
            id: 'zip-1',
            kind: 'zip',
            filename: 'labels.zip',
            mimeType: 'application/zip',
            byteSize: 240,
            checksum: 'b',
          },
          {
            id: 'manifest-1',
            kind: 'manifest',
            filename: 'manifest.json',
            mimeType: 'application/json',
            byteSize: 20,
            checksum: 'c',
          },
        ],
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('tab', { name: 'Invoices & print' }).click();
  await expect(page.getByText('80mm thermal shipping label')).toBeVisible();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(page.getByRole('link', { name: 'Download printable PDF' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download individual files ZIP' })).toBeVisible();
  await expect(page.getByText('manifest.json')).toHaveCount(0);
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
