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

test('shows export history in a dedicated export navigation destination @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.locator('[data-testid="navigation-exports"]:visible').click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous files' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exports', exact: true })).toBeVisible();
  await expect(page.getByLabel('Orders to export')).toBeVisible();
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
  await expect(page.getByTestId('exports-workspace')).toHaveCount(0);
  expect(profileReads).toBe(0);
});

test('Excel click downloads automatically, keeps the file in history and supports repeat download and removal @exports', async ({
  page,
}, testInfo) => {
  await mockExports(page);
  let created = false;
  let deleted = false;
  let reads = 0;
  let historyReads = 0;
  let deleteAttempts = 0;
  const batch = {
    id: 'saved-excel',
    format: 'xlsx',
    rowMode: 'order',
    status: 'completed',
    filename: 'orders-2026-11-05.xlsx',
    createdAt: '2026-11-05T09:00:00.000Z',
    orderCount: 2,
    rowCount: 2,
    error: null,
  };
  await page.route('**/api/v1/export-batches', (route) => {
    expect(route.request().method()).toBe('POST');
    created = true;
    return route.fulfill({ status: 202, json: { batch: { ...batch, status: 'queued' } } });
  });
  await page.route('**/api/v1/export-batches?*', (route) => {
    historyReads++;
    return route.fulfill({
      json: { items: created && !deleted ? [batch] : [], hasMore: false, nextCursor: null },
    });
  });
  await page.route('**/api/v1/export-batches/saved-excel', (route) => {
    if (route.request().method() === 'DELETE') {
      expect(route.request().headers()['x-csrf-token']).toBe('excel-history-csrf');
      if (++deleteAttempts === 1) return route.fulfill({ status: 503, json: {} });
      deleted = true;
      return route.fulfill({ status: 204 });
    }
    reads++;
    return route.fulfill({
      json: { batch: { ...batch, status: reads < 3 ? 'running' : 'completed' } },
    });
  });
  await page.route('**/api/v1/export-batches/saved-excel/download', (route) =>
    route.fulfill({
      body: 'saved Excel bytes',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'content-disposition': `attachment; filename="${batch.filename}"` },
    }),
  );
  await page.goto('/exports');
  await page.getByRole('button', { name: 'English' }).click();
  await page
    .context()
    .addCookies([{ name: 'woo_ops_csrf', value: 'excel-history-csrf', url: page.url() }]);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel', exact: true }).click();
  await expect(page.getByText('Preparing your Excel file.', { exact: false })).toBeVisible();
  expect((await download).suggestedFilename()).toBe(batch.filename);
  expect(historyReads).toBe(0);
  await expect(page.getByText('Download started.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Previous files', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Previous Excel files' });
  await expect(dialog.getByText(batch.filename)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('spreadsheet-history-desktop.png'),
    animations: 'disabled',
  });
  const secondDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await secondDownload).suggestedFilename()).toBe(batch.filename);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Previous files', exact: true }).click();
  await expect(dialog.getByText(batch.filename)).toBeVisible();
  await dialog
    .getByRole('button', { name: `Remove ${batch.filename} from history`, exact: true })
    .click();
  await expect(dialog.getByText('Remove this entry from history?', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove from history', exact: true }).click();
  await expect(
    dialog.getByText('Could not complete the history request. Try again.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  expect(deleted).toBe(false);
  await dialog.getByRole('button', { name: 'Remove from history', exact: true }).click();
  await expect(dialog.getByText('No previous files.', { exact: true })).toBeVisible();
  expect(deleted).toBe(true);
});

test('previous files paginate, recover from load errors and fit Arabic mobile @exports', async ({
  page,
}, testInfo) => {
  await mockExports(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await page.route('**/api/v1/export-batches?*', (route) => {
    if (fail) return route.fulfill({ status: 503, json: {} });
    const older = new URL(route.request().url()).searchParams.has('cursor');
    return route.fulfill({
      json: {
        items: [
          {
            id: older ? 'old-batch' : 'new-batch',
            status: 'completed',
            format: 'xlsx',
            rowMode: 'order',
            filename: older
              ? 'old-orders.xlsx'
              : 'shipping-orders-with-a-very-long-filename-2026-11-05.xlsx',
            createdAt: '2026-11-05T09:00:00Z',
            orderCount: 2,
            rowCount: 2,
          },
        ],
        hasMore: !older,
        nextCursor: older ? null : 'older-page',
      },
    });
  });
  await page.goto('/exports');
  await page.getByRole('button', { name: 'الملفات السابقة', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ملفات Excel السابقة' });
  await expect(dialog.getByRole('alert')).toBeVisible();
  fail = false;
  await dialog.getByRole('button', { name: 'تحديث', exact: true }).click();
  await expect(dialog.getByText('2 طلب · 2 صف')).toBeVisible();
  await dialog.getByRole('button', { name: 'التالي', exact: true }).click();
  await expect(dialog.getByText('old-orders.xlsx')).toBeVisible();
  await expect(dialog.getByText('صفحة 2', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'السابق', exact: true }).click();
  await expect(dialog.getByText('صفحة 1', { exact: true })).toBeVisible();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('spreadsheet-history-mobile-ar.png'),
    animations: 'disabled',
  });
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);
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
            totalCount: 25,
            processedCount: 25,
            succeededCount: 25,
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
          ...Array.from({ length: 25 }, (_, index) => ({
            id: `order-pdf-${index + 1}`,
            kind: 'order-pdf',
            filename: `shipping-label-80mm-order-${1001 + index}-2026-09-21.pdf`,
            mimeType: 'application/pdf',
            byteSize: 100,
            checksum: `order-${index + 1}`,
          })),
        ],
      },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.locator('[data-testid="navigation-exports"]:visible').click();
  await page.getByRole('tab', { name: 'Invoices & print' }).click();
  await expect(page.getByText('80mm thermal shipping label')).toBeVisible();
  await page.getByRole('button', { name: 'Show files' }).click();
  await expect(page.locator('.document-files-dialog__paper')).toHaveCSS('border-radius', '12px');
  await expect(page.locator('.document-files-dialog__primary-actions')).toHaveCSS('gap', '12px');
  await expect(page.getByRole('link', { name: 'Download printable PDF' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download individual files ZIP' })).toBeVisible();
  await expect(page.getByText('manifest.json')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(20);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByText('shipping-label-80mm-order-1021-2026-09-21.pdf')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download', exact: true })).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(
      async () => (await page.locator('.document-files-dialog__paper').boundingBox())?.width ?? 0,
    )
    .toBeLessThanOrEqual(390);
});

test('preserves the selected export history tab across refreshes @exports', async ({ page }) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.locator('[data-testid="navigation-exports"]:visible').click();

  const documentsTab = page.getByRole('tab', { name: 'Invoices & print' });
  await documentsTab.click();
  await expect(page).toHaveURL(/\/exports\?history=documents$/u);
  await page.reload();
  await expect(documentsTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('export-document-jobs')).toBeVisible();

  const excelTab = page.getByRole('tab', { name: 'Excel' });
  await excelTab.click();
  await expect(page).toHaveURL(/\/exports$/u);
  await page.reload();
  await expect(excelTab).toHaveAttribute('aria-selected', 'true');
});

test('export workspace has no automated accessibility violations @a11y @exports', async ({
  page,
}) => {
  await mockExports(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.locator('[data-testid="navigation-exports"]:visible').click();
  await expect(page.getByTestId('exports-workspace')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
