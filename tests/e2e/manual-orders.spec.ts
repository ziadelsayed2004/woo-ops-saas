import { expect, test } from '@playwright/test';

test('creates a manual order through the local-only form', async ({ page }) => {
  const requests: string[] = [];
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/v1/orders/query', async (route) => {
    await route.fulfill({
      json: { items: [], nextCursor: null, hasMore: false },
    });
  });
  await page.route('**/api/v1/manual-orders', async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        order: {
          id: 'manual-1',
          orderNumber: 'MAN-000001',
          origin: 'manual',
          syncPolicy: 'never',
          inventoryPolicy: 'ignore',
          exportState: 'never-exported',
          currency: 'EGP',
          grandTotalMinor: '26500',
        },
      },
    });
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Create manual order' }).click();
  await expect(page.getByRole('heading', { name: 'New local manual order' })).toBeVisible();
  await expect(
    page.getByText('Local only: this order never calls WooCommerce or changes inventory').first(),
  ).toBeVisible();
  await page.getByLabel('Customer name').fill('Manual Customer');
  await page.getByLabel('Product name').fill('Manual product');
  await page.getByLabel('Unit price in minor units').fill('12500');
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Save manual order' }).click();
  await expect(page.getByText('Manual order saved locally')).toBeVisible();
  expect(payload?.currency).toBe('EGP');
  expect(payload?.lines).toEqual([
    { name: 'Manual product', quantity: 2, unitPriceMinor: '12500' },
  ]);
  expect(requests.some((url) => url.includes('/connections'))).toBe(false);
});
