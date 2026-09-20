import { expect, test } from '@playwright/test';

test('keeps document generation in order and export workflows without a standalone page @documents', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route) => {
    await route.fulfill({
      json: { items: [], facets: [], nextCursor: null, hasMore: false, totalCount: 0 },
    });
  });
  await page.route('**/api/v1/orders/views', async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('button', { name: 'Documents' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Exports' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Invoices & print' }).click();
  await expect(page.getByRole('heading', { name: 'Invoice and print commands' })).toBeVisible();
});
