import { expect, test, type Page, type Route } from '@playwright/test';

const openManualForm = async (page: Page, rates: unknown[]) => {
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
  await page.route('**/api/v1/catalog?**', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'catalog-1',
            kind: 'product',
            externalId: '44',
            parentExternalId: null,
            name: 'Woo product',
            sku: 'WOO-44',
            price: '125.00',
            stockStatus: 'instock',
            stockQuantity: 8,
            categories: [{ id: '5', name: 'Coffee' }],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/manual-orders/config', async (route: Route) => {
    await route.fulfill({
      json: { currency: 'EGP', rates, proofTypes: ['image/png'], proofMaxBytes: 5242880 },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'إنشاء طلب يدوي' }).click();
};

test('creates a manual order through the local-only form', async ({ page }) => {
  const requests: string[] = [];
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route) => {
    await route.fulfill({
      json: { items: [], nextCursor: null, hasMore: false },
    });
  });
  await page.route('**/api/v1/catalog?**', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'catalog-1',
            kind: 'product',
            externalId: '44',
            parentExternalId: null,
            name: 'Woo product',
            sku: 'WOO-44',
            price: '125.00',
            regularPrice: '125.00',
            salePrice: null,
            stockStatus: 'instock',
            stockQuantity: 8,
            categories: [{ id: '5', name: 'Coffee' }],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/manual-orders/config', async (route) => {
    await route.fulfill({
      json: {
        currency: 'EGP',
        rates: [{ governorate: 'Cairo', amountMinor: '1500' }],
        proofTypes: ['image/png'],
        proofMaxBytes: 5242880,
      },
    });
  });
  await page.route('**/api/v1/manual-orders/manual-1/payment-proof', async (route) => {
    await route.fulfill({ status: 201, json: { proof: { id: 'proof-1' } } });
  });
  await page.route('**/api/v1/manual-orders/manual-1', async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        order: {
          id: 'manual-1',
          orderNumber: 'MAN-000001',
          origin: 'manual',
          localStatus: 'confirmed',
          syncPolicy: 'never',
          inventoryPolicy: 'ignore',
          exportState: 'never-exported',
          currency: 'EGP',
          grandTotalMinor: '26500',
        },
      },
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
  await page.getByRole('button', { name: 'Products & stock' }).click();
  await expect(page.getByTestId('catalog-workspace')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Woo product' })).toBeVisible();
  await expect(page.getByText('instock · 8')).toBeVisible();
  await page.getByRole('button', { name: 'Create manual order' }).click();
  await expect(page.getByRole('heading', { name: 'New local manual order' })).toBeVisible();
  await expect(
    page.getByText('Local only: this order never calls WooCommerce or changes inventory').first(),
  ).toBeVisible();
  await page.getByLabel('Customer name').fill('Manual Customer');
  await page.getByLabel('Customer phone').fill('01000000000');
  await page.getByLabel('Address').fill('1 Test street');
  await page.getByLabel('Governorate').click();
  await page.getByRole('option', { name: /Cairo/ }).click();
  await page.getByLabel('Product name').click();
  await page.getByRole('option', { name: /Woo product/ }).click();
  await page.getByLabel('Quantity').fill('2');
  await page.locator('input[type="file"]').setInputFiles({
    name: 'transfer.png',
    mimeType: 'image/png',
    buffer: Buffer.from('proof'),
  });
  await page.getByRole('button', { name: 'Save manual order' }).click();
  await expect(page.getByText('Manual order saved locally')).toBeVisible();
  expect(payload?.currency).toBe('EGP');
  expect(payload?.lines).toEqual([
    {
      name: 'Woo product',
      sku: 'WOO-44',
      productId: '44',
      quantity: 2,
      unitPriceMinor: '12500',
    },
  ]);
  expect(requests.some((url) => url.includes('/connections'))).toBe(false);
});

test('explains missing shipping rates instead of opening an empty governorate list', async ({
  page,
}) => {
  await openManualForm(page, []);
  await expect(page.getByTestId('shipping-rates-empty')).toBeVisible();
  await expect(page.getByLabel('المحافظة')).toBeDisabled();
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
});

test('shows all Egyptian governorates by name while disabling those without Woo rates', async ({
  page,
}) => {
  await openManualForm(page, [{ governorate: 'EGSHR', amountMinor: '1500' }]);
  await page.getByLabel('المحافظة').click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(27);
  await expect(page.getByRole('option', { name: /الشرقية/ })).toBeEnabled();
  await expect(page.getByRole('option', { name: /القاهرة/ })).toBeDisabled();
});

test('keeps a deterministic responsive manual-order baseline @visual @manual-orders', async ({
  page,
}) => {
  await openManualForm(page, [{ governorate: 'EGSHR', amountMinor: '1500' }]);
  await expect(page.getByLabel('اسم المنتج')).toBeVisible();
  await expect(page).toHaveScreenshot('manual-order-form.png', {
    animations: 'disabled',
    fullPage: true,
  });
});

test('stacks the manual-order form cleanly on narrow screens @visual @manual-orders', async ({
  page,
}) => {
  await openManualForm(page, [{ governorate: 'EGSHR', amountMinor: '1500' }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel('اسم المنتج')).toBeVisible();
  await expect(page).toHaveScreenshot('manual-order-form-mobile.png', {
    animations: 'disabled',
    fullPage: true,
  });
});
