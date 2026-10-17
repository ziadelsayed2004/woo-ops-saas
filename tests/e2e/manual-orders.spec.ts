import { expect, test, type Page, type Route } from '@playwright/test';

test('catalog shows only products shared by every selected category and clears back to all', async ({
  page,
}, testInfo) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    }),
  );
  const requestedCategories: string[][] = [];
  const product = (id: string, name: string, categoryIds: string[]) => ({
    id,
    kind: 'product',
    externalId: id,
    parentExternalId: null,
    name,
    price: '100.00',
    stockStatus: 'instock',
    stockQuantity: 5,
    backorders: 'no',
    catalogVisibility: 'visible',
    categories: categoryIds.map((categoryId) => ({
      id: categoryId,
      name: `Category ${categoryId}`,
    })),
  });
  const products = [
    product('10', 'Shared product', ['4', '5']),
    product('11', 'First only', ['4']),
    product('12', 'Second only', ['5']),
  ];
  await page.route('**/api/v1/catalog?**', (route) => {
    const query = new URL(route.request().url()).searchParams;
    const selected = query.getAll('categoryId');
    if (query.get('kind') === 'category') {
      return route.fulfill({
        json: {
          items: ['4', '5'].map((id) => product(id, `Category ${id}`, [])),
          hasMore: false,
          nextCursor: null,
        },
      });
    }
    if (query.get('kind') === 'variation')
      return route.fulfill({ json: { items: [], hasMore: false, nextCursor: null } });
    requestedCategories.push(selected);
    return route.fulfill({
      json: {
        items: products.filter(
          (item) =>
            item.name.toLowerCase().includes((query.get('search') ?? '').toLowerCase()) &&
            selected.every((id) => item.categories.some((c) => c.id === id)),
        ),
        hasMore: false,
        nextCursor: null,
      },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Products & stock' }).click();
  const categories = page.getByRole('combobox', { name: 'Categories (match all)' });
  await categories.click();
  await page.getByRole('option', { name: 'Category 4' }).click();
  await categories.click();
  await page.getByRole('option', { name: 'Category 5' }).click();
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('cell', { name: 'Shared product' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'First only' })).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'Second only' })).toHaveCount(0);
  expect(requestedCategories.at(-1)).toEqual(['4', '5']);
  await page.screenshot({
    path: testInfo.outputPath('catalog-category-intersection-en.png'),
    fullPage: true,
  });
  await page.getByRole('textbox', { name: 'Search product name' }).fill('First');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('No products match the selected filters.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Search product name' }).clear();
  await categories.click();
  await categories.press('Backspace');
  await categories.press('Backspace');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByRole('cell', { name: 'First only' })).toBeVisible();
  expect(requestedCategories.at(-1)).toEqual([]);
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.getByRole('combobox', { name: 'التصنيفات (مشتركة بينها)' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('main')).toHaveCSS('margin-left', '0px');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
  await page.screenshot({
    path: testInfo.outputPath('catalog-category-filter-ar.png'),
    fullPage: true,
  });
});

const disabledTaxes = {
  status: 'ready',
  enabled: false,
  pricesIncludeTax: false,
  syncedAt: '2026-10-17T00:00:00.000Z',
  policyHash: 'a'.repeat(64),
  error: null,
};
const mockTaxPreview = async (page: Page, percent = 0) => {
  await page.route('**/api/v1/manual-orders/tax-preview', async (route) => {
    const body = route.request().postDataJSON() as {
      lines: Array<{ quantity: number; unitPriceMinor: string }>;
      shippingCollectedMinor: string;
      discountMinor: string;
      feesMinor: string;
    };
    const net =
      body.lines.reduce(
        (total, line) => total + BigInt(line.quantity) * BigInt(line.unitPriceMinor),
        0n,
      ) - BigInt(body.discountMinor);
    const tax = (net * BigInt(percent) + 50n) / 100n;
    await route.fulfill({
      json: {
        amounts: {
          taxMinor: String(tax),
          grandTotalMinor: String(
            net + tax + BigInt(body.shippingCollectedMinor) + BigInt(body.feesMinor),
          ),
        },
        policyHash: disabledTaxes.policyHash,
      },
    });
  });
};
const openManualForm = async (page: Page, rates: unknown[], taxes = disabledTaxes) => {
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
      json: { currency: 'EGP', rates, taxes, proofTypes: ['image/png'], proofMaxBytes: 5242880 },
    });
  });
  await mockTaxPreview(page);
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
        taxes: disabledTaxes,
        rates: [{ governorate: 'Cairo', amountMinor: '1500' }],
        proofTypes: ['image/png'],
        proofMaxBytes: 5242880,
      },
    });
  });
  await mockTaxPreview(page);
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
  await expect(page.getByTestId('orders-tab-manual')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('manual-orders-workspace')).toBeVisible();
  expect(payload?.currency).toBe('EGP');
  expect(payload?.taxMode).toBe('store');
  expect(payload?.taxPolicyHash).toBe(disabledTaxes.policyHash);
  expect(payload).not.toHaveProperty('taxMinor');
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

test('recalculates automatic tax locally when quantity changes and keeps it read-only', async ({
  page,
}) => {
  await openManualForm(page, [{ governorate: 'EGC', amountMinor: '1000' }], {
    ...disabledTaxes,
    enabled: true,
  });
  await mockTaxPreview(page, 14);
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByLabel('Governorate').click();
  await page.getByRole('option', { name: /Cairo/ }).click();
  await page.getByLabel('Product name').click();
  await page.getByRole('option', { name: /Woo product/ }).click();
  const taxInput = page.getByLabel('Tax in minor units', { exact: true });
  await expect(taxInput).toHaveValue('1750');
  await expect(taxInput).toHaveAttribute('readonly', '');
  await page.getByLabel('Quantity').fill('2');
  await expect(taxInput).toHaveValue('3500');
  await expect(page.getByText('Calculated automatically from store tax settings')).toBeVisible();
});

test('does not silently save zero tax when store settings are unavailable', async ({ page }) => {
  await openManualForm(page, [{ governorate: 'EGC', amountMinor: '1000' }], {
    ...disabledTaxes,
    status: 'unavailable',
  });
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Tax settings are unavailable.', { exact: false })).toBeVisible();
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
