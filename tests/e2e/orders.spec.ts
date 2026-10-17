import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const order = {
  id: 'order-1',
  orderNumber: '1001',
  externalOrderId: 'woo-42',
  origin: 'woo',
  connectionId: 'store-egypt',
  remoteStatus: 'processing',
  localStatus: 'new',
  exportState: 'never-exported',
  currency: 'EGP',
  grandTotalMinor: '125050',
  createdAt: '2026-08-30T08:00:00.000Z',
  modifiedAt: '2026-08-30T09:00:00.000Z',
  channel: 'online',
  posLocation: 'Cairo POS',
  externalCustomerId: 'customer-12',
  billing: {
    first_name: 'أحمد',
    last_name: 'علي',
    email: 'ahmed@example.test',
    phone: '01000000000',
    address_1: 'شارع النيل ١',
    city: 'القاهرة',
    postcode: '11511',
    country: 'EG',
  },
  shipping: {
    first_name: 'أحمد',
    last_name: 'علي',
    address_1: 'شارع النيل ١',
    city: 'القاهرة',
    postcode: '11511',
    country: 'EG',
  },
  payment: { title: 'الدفع عند الاستلام', status: 'pending' },
  paymentStatus: 'pending',
  shippingMethod: { title: 'الشحن القياسي', actualCostMinor: '2500' },
  amounts: {
    merchandiseNetMinor: '110000',
    discountMinor: '0',
    shippingCollectedMinor: '10000',
    taxMinor: '5050',
    feesMinor: '0',
    refundMinor: '0',
    collectedMinor: '125050',
  },
  lines: [
    {
      externalLineId: 'line-1',
      name: 'قميص قطني',
      sku: 'SHIRT-01',
      quantity: 2,
      subtotalMinor: '110000',
      totalMinor: '110000',
    },
  ],
  refunds: [],
  tags: ['priority'],
  notesSummary: 'اتصل قبل التسليم',
  syncPolicy: 'read-only',
  inventoryPolicy: 'observe',
  syncEvents: [{ id: 'sync-1', type: 'order.imported', createdAt: '2026-08-30T09:00:00.000Z' }],
  exportHistory: [],
  documentHistory: [],
  auditHistory: [],
};

const manualOrder = {
  ...order,
  id: 'manual-order-1',
  orderNumber: 'MAN-000001',
  externalOrderId: undefined,
  origin: 'manual',
  connectionId: undefined,
  remoteStatus: undefined,
  localStatus: 'confirmed',
  syncPolicy: 'never',
  inventoryPolicy: 'ignore',
};

async function mockOrderApi(page: Page) {
  const queryBodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    const raw = route.request().postData();
    const query = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    if (raw) queryBodies.push(query);
    const manual = JSON.stringify(query.filter).includes('"value":"manual"');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [manual ? manualOrder : order],
        nextCursor: null,
        hasMore: false,
        facets: [
          ...(manual
            ? []
            : [{ field: 'remoteStatus', values: [{ value: 'processing', count: 1 }] }]),
          { field: 'governorate', values: [{ value: 'Cairo', count: 1 }] },
        ],
      }),
    });
  });
  await page.route('**/api/v1/orders/order-1', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ order }),
    });
  });
  await page.route('**/api/v1/orders/manual-order-1', (route) =>
    route.fulfill({ json: { order: manualOrder } }),
  );
  await page.route('**/api/v1/export-batches', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/document-jobs?limit=30', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  return queryBodies;
}

test('defaults Woo orders to processing and separates manual orders into a tab @orders', async ({
  page,
}) => {
  const queryBodies = await mockOrderApi(page);
  await page.goto('/');

  await expect(page.getByTestId('orders-tab-woo')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('orders-tab-manual')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('navigation-manual')).toHaveCount(0);
  await expect
    .poll(() => JSON.stringify(queryBodies[0]?.filter ?? null))
    .toContain('"field":"source","operator":"equals","value":"woo"');
  await expect
    .poll(() => JSON.stringify(queryBodies[0]?.filter ?? null))
    .toContain('"field":"remoteStatus","operator":"equals","value":"processing"');

  await page.getByTestId('orders-tab-manual').click();
  await expect(page).toHaveURL(/\/manual$/u);
  await expect(page.getByTestId('manual-orders-workspace')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'MAN-000001', exact: true })).toBeVisible();
  await expect
    .poll(() => JSON.stringify(queryBodies.at(-1)?.filter ?? null))
    .toContain('"field":"source","operator":"equals","value":"manual"');
  expect(JSON.stringify(queryBodies.at(-1)?.filter)).not.toContain('remoteStatus');
  expect(queryBodies.at(-1)?.sort).toEqual({ field: 'createdAt', direction: 'desc' });
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'حالة تصدير Woo' })).toHaveCount(0);

  await page.getByTestId('orders-tab-woo').click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await expect(page.getByTestId('order-row-order-1')).toBeVisible();
});

test('keeps the legacy manual orders URL on the manual tab @orders', async ({ page }) => {
  await mockOrderApi(page);
  await page.goto('/manual');
  await expect(page.getByTestId('orders-tab-manual')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('manual-orders-workspace')).toBeVisible();
});

test('switching to manual orders ignores a delayed Woo response and clears its selection @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  let releaseWoo: () => void = () => undefined;
  const heldWoo = new Promise<void>((resolve) => {
    releaseWoo = resolve;
  });
  await page.route('**/api/v1/orders/query', async (route) => {
    const manual = JSON.stringify(route.request().postDataJSON()).includes('"value":"manual"');
    if (!manual) await heldWoo;
    await route.fulfill({
      json: {
        items: [manual ? manualOrder : order],
        totalCount: 1,
        hasMore: false,
        nextCursor: null,
      },
    });
  });
  await page.goto('/');
  await page.getByTestId('orders-tab-manual').click();
  await expect(page.getByTestId('order-row-manual-order-1')).toBeVisible();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/orders/query') &&
      !JSON.stringify(response.request().postDataJSON()).includes('"value":"manual"'),
  );
  releaseWoo();
  await lateResponse;
  await expect(page.getByTestId('order-row-order-1')).toHaveCount(0);
  await page.getByTestId('order-row-manual-order-1').getByRole('checkbox').check();
  await page.getByTestId('orders-tab-woo').click();
  await expect(page.getByTestId('order-row-order-1')).toBeVisible();
  await expect(page.getByTestId('order-row-order-1').getByRole('checkbox')).not.toBeChecked();
  await expect(page.getByTestId('order-row-manual-order-1')).toHaveCount(0);
});

test('manual grid filters local status, paginates and opens the shared detail drawer @orders', async ({
  page,
}, testInfo) => {
  await mockOrderApi(page);
  const queries: Record<string, unknown>[] = [];
  await page.route('**/api/v1/orders/query', (route) => {
    const query = route.request().postDataJSON() as Record<string, unknown>;
    queries.push(query);
    return route.fulfill({
      json: {
        items: [
          query.cursor
            ? { ...manualOrder, id: 'manual-order-2', orderNumber: 'MAN-000002' }
            : manualOrder,
        ],
        hasMore: !query.cursor,
        nextCursor: query.cursor ? null : 'manual-page-2',
        totalCount: 2,
        facets: [{ field: 'localStatus', values: [{ value: 'confirmed', count: 2 }] }],
      },
    });
  });
  await page.goto('/manual');
  await page.getByRole('button', { name: 'English' }).click();
  const table = page.getByTestId('orders-table');
  await expect(
    table.getByRole('columnheader', { name: 'Local status', exact: true }),
  ).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /Woo export|Platform status/ })).toHaveCount(
    0,
  );
  await expect(table.getByText('Confirmed')).toBeVisible();
  await page.getByRole('combobox', { name: 'Status', exact: true }).click();
  await page.getByRole('option', { name: 'Confirmed', exact: true }).click();
  await expect
    .poll(() => JSON.stringify(queries.at(-1)?.filter))
    .toContain('"field":"localStatus","operator":"equals","value":"confirmed"');
  await page
    .getByRole('textbox', { name: 'Search order number, customer or phone' })
    .fill('Manual');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => queries.at(-1)?.search).toBe('Manual');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByTestId('order-row-manual-order-2')).toBeVisible();
  expect(queries.at(-1)?.cursor).toBe('manual-page-2');
  expect(JSON.stringify(queries.at(-1)?.filter)).toContain('"value":"manual"');
  await page.getByTestId('order-row-manual-order-1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Order details #MAN-000001' })).toBeVisible();
  await expect(
    page.getByText('Local only: this order never calls WooCommerce or changes inventory'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Payment, shipping & tax' }).click();
  await expect(page.getByRole('link', { name: 'Transfer proof' })).toHaveAttribute(
    'href',
    '/api/v1/manual-orders/manual-order-1/payment-proof',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.order-detail-drawer__paper')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('manual-grid-en.png'), fullPage: true });
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(table.getByText('مؤكد')).toHaveCount(2);
  await expect(page.locator('main')).toHaveCSS('margin-left', '0px');
  await page.screenshot({ path: testInfo.outputPath('manual-grid-ar.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'إدارة الطلبات اليدوية' })).toBeVisible();
  await expect(page.locator('main')).toHaveCSS('margin-right', '0px');
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('manual-grid-mobile-ar.png'), fullPage: true });
});

test('manual selections download Woo-layout Excel, shipping sheets and all PDF types without clearing selection @orders @exports', async ({
  page,
}) => {
  await mockOrderApi(page);
  const selections: Record<string, unknown>[] = [];
  const versions: Record<string, unknown>[] = [];
  const documentActions: string[] = [];
  const profiles: string[] = [];
  let batchId = 0;
  await page.route('**/api/v1/selections', (route) => {
    selections.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { selection: { id: 'selection-manual', estimatedCount: 1 } } });
  });
  await page.route('**/api/v1/export-profiles', (route) => {
    if (route.request().method() === 'POST') {
      profiles.push((route.request().postDataJSON() as { name: string }).name);
      return route.fulfill({ json: { profile: { id: 'manual-profile' } } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/export-profiles/manual-profile/versions', (route) => {
    if (route.request().method() === 'POST') {
      versions.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { version: { id: 'manual-version' } } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/export-batches', (route) => {
    if (route.request().method() === 'POST') {
      batchId += 1;
      return route.fulfill({ json: { batch: { id: `manual-batch-${batchId}` } } });
    }
    return route.fulfill({
      json: {
        items: [
          { id: `manual-batch-${batchId}`, status: 'completed', filename: 'manual-orders.xlsx' },
        ],
      },
    });
  });
  await page.route('**/api/v1/export-batches/*/download', (route) =>
    route.fulfill({
      body: 'workbook fixture',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'content-disposition': 'attachment; filename="manual-orders.xlsx"' },
    }),
  );
  await page.route('**/api/v1/document-templates', (route) =>
    route.fulfill({
      json: {
        items: ['a4', 'thermal-80mm', 'label-100x150mm'].map((format) => ({
          id: `template-${format}`,
          active: true,
          format,
        })),
      },
    }),
  );
  await page.route('**/api/v1/document-jobs', (route) => {
    const body = route.request().postDataJSON() as { action: string; selectionId: string };
    expect(body.selectionId).toBe('selection-manual');
    documentActions.push(body.action);
    return route.fulfill({ json: { batch: { id: 'manual-documents' } } });
  });
  await page.route('**/api/v1/document-jobs/manual-documents', (route) =>
    route.fulfill({
      json: {
        batch: { id: 'manual-documents', status: 'completed' },
        artifacts: [{ id: 'manual-pdf', kind: 'merged-pdf', filename: 'manual-invoices.pdf' }],
      },
    }),
  );
  await page.route('**/api/v1/document-artifacts/manual-pdf?download=1', (route) =>
    route.fulfill({
      body: '%PDF-1.4 fixture',
      contentType: 'application/pdf',
      headers: { 'content-disposition': 'attachment; filename="manual-invoices.pdf"' },
    }),
  );
  await page.goto('/manual');
  await page.getByRole('button', { name: 'English' }).click();
  const selected = page.getByTestId('order-row-manual-order-1').getByRole('checkbox');
  await selected.check();
  for (const name of [
    'Export Excel',
    'Shipping sheet',
    'Download A4 invoice',
    'Download thermal receipt',
    'Download shipping label',
  ]) {
    await page.getByRole('button', { name: 'Export & print', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/manual-(orders.xlsx|invoices.pdf)/);
    await expect(selected).toBeChecked();
  }
  expect(profiles).toEqual(['Manual orders XLSX v1', 'Manual shipping orders XLSX v1']);
  expect(versions.map((version) => version.filenameTemplate)).toEqual([
    'manual-orders-{date}-{format}',
    'manual-shipping-orders-{date}-{format}',
  ]);
  expect((versions[0]?.columns as { key: string; label: string }[]).slice(0, 3)).toEqual([
    { key: 'woo.orderNumber', label: 'رقم الطلب', type: 'text' },
    { key: 'woo.orderStatus', label: 'حالة الطلب', type: 'text' },
    { key: 'woo.orderDate', label: 'تاريخ الطلب', type: 'text' },
  ]);
  expect(documentActions).toEqual(['generate-invoice', 'generate-thermal', 'generate-label']);
  expect(selections).toEqual(
    Array.from({ length: 5 }, () => ({ mode: 'explicit', orderIds: ['manual-order-1'] })),
  );
});

test('manual select-all output keeps the manual query and thermal printing opens its PDF @orders @exports', async ({
  page,
  context,
}) => {
  await mockOrderApi(page);
  await page.route('**/api/v1/orders/query', (route) =>
    route.fulfill({
      json: { items: [manualOrder], totalCount: 51, hasMore: true, nextCursor: 'more-manual' },
    }),
  );
  let selection: Record<string, unknown> | null = null;
  await page.route('**/api/v1/selections', (route) => {
    selection = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { selection: { id: 'all-manual', estimatedCount: 51 } } });
  });
  await page.route('**/api/v1/document-templates', (route) =>
    route.fulfill({ json: { items: [{ id: 'thermal', format: 'thermal-80mm', active: true }] } }),
  );
  await page.route('**/api/v1/document-jobs', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      selectionId: 'all-manual',
      templateId: 'thermal',
      action: 'generate-thermal',
    });
    return route.fulfill({ json: { batch: { id: 'all-manual-docs' } } });
  });
  await page.route('**/api/v1/document-jobs/all-manual-docs', (route) =>
    route.fulfill({
      json: {
        batch: { status: 'completed' },
        artifacts: [{ id: 'all-manual-pdf', kind: 'merged-pdf', filename: 'receipts.pdf' }],
      },
    }),
  );
  await page.goto('/manual');
  await page.getByRole('button', { name: 'English' }).click();
  const pdfBytes = await page.pdf({ format: 'A4' });
  await page.route('**/api/v1/document-artifacts/all-manual-pdf', (route) =>
    route.fulfill({ body: pdfBytes, contentType: 'application/pdf' }),
  );
  await page.getByTestId('order-row-manual-order-1').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Select all matching results (51)' }).click();
  await page.getByRole('button', { name: 'Export & print', exact: true }).click();
  await page.getByRole('tab', { name: 'Print', exact: true }).click();
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Print thermal receipt', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.locator('iframe')).toBeVisible();
  expect(selection).toMatchObject({
    mode: 'query',
    query: {
      filter: { field: 'source', operator: 'equals', value: 'manual' },
      sort: { field: 'createdAt', direction: 'desc' },
    },
  });
  await expect(page.getByTestId('order-row-manual-order-1').getByRole('checkbox')).toBeChecked();
  await popup.close();
});

test('creates the Woo-layout XLSX and offers repeat download in orders @orders @exports', async ({
  page,
}) => {
  await mockOrderApi(page);
  let createdVersion: Record<string, unknown> | null = null;
  let batchCreated = false;
  await page.route('**/api/v1/export-profiles', async (route: Route) => {
    await route.fulfill({
      json:
        route.request().method() === 'POST'
          ? { profile: { id: 'profile-woo', name: 'Woo Orders XLSX v2', active: true } }
          : { items: [] },
    });
  });
  await page.route('**/api/v1/export-profiles/profile-woo/versions', async (route: Route) => {
    if (route.request().method() === 'POST') {
      createdVersion = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      await route.fulfill({
        json: { version: { id: 'version-woo', profileId: 'profile-woo', ...createdVersion } },
      });
    } else await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/export-batches', async (route: Route) => {
    if (route.request().method() === 'POST') {
      batchCreated = true;
      await route.fulfill({ json: { batch: { id: 'batch-woo' } } });
    } else
      await route.fulfill({
        json: {
          items: batchCreated
            ? [
                {
                  id: 'batch-woo',
                  status: 'completed',
                  format: 'xlsx',
                  rowMode: 'line',
                  orderCount: 1,
                  rowCount: 1,
                  filename: 'orders-export-xlsx.xlsx',
                },
              ]
            : [],
        },
      });
  });
  await page.route('**/api/v1/document-jobs?limit=30', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/selections', async (route: Route) => {
    await route.fulfill({ json: { selection: { id: 'selection-woo', estimatedCount: 1 } } });
  });
  await page.route('**/api/v1/export-batches/batch-woo/download', async (route: Route) => {
    await route.fulfill({
      body: 'mock workbook',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      headers: { 'content-disposition': 'attachment; filename="orders-export-xlsx.xlsx"' },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Export & print', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('tab', { name: 'Print', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Print Thermal receipt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Print Shipping label' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export Excel' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Download files' }).click();
  const automaticDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Excel' }).click();
  expect((await automaticDownload).suggestedFilename()).toBe('orders-export-xlsx.xlsx');
  await expect(
    page.getByText(/Export command added and will download automatically/u),
  ).toBeVisible();
  await expect(page.getByTestId('order-row-order-1').getByRole('checkbox')).toBeChecked();
  const columns = (createdVersion?.columns ?? []) as Array<{ key: string; label: string }>;
  expect(createdVersion?.filenameTemplate).toBe('orders-{date}-{format}');
  expect(createdVersion?.rowMode).toBe('line');
  expect(columns).toHaveLength(15);
  expect(columns.map((column) => column.label).slice(0, 3)).toEqual([
    'رقم الطلب',
    'حالة الطلب',
    'تاريخ الطلب',
  ]);
  expect(columns.map((column) => column.label)).toContain('المحافظة');
  await page.locator('[data-testid="navigation-exports"]:visible').click();
  await expect(page.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'href',
    '/api/v1/export-batches/batch-woo/download',
  );
  const historyBox = await page.getByTestId('exports-workspace').boundingBox();
  expect(historyBox).not.toBeNull();
});

test('shows an export job failure with retry instead of claiming a download @orders @exports', async ({
  page,
}) => {
  await mockOrderApi(page);
  let created = false;
  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });
  await page.route('**/api/v1/export-profiles', async (route: Route) => {
    await route.fulfill({
      json:
        route.request().method() === 'POST'
          ? { profile: { id: 'profile-woo', name: 'Woo Orders XLSX v3', active: true } }
          : { items: [{ id: 'profile-woo', name: 'Woo Orders XLSX v3', active: true }] },
    });
  });
  await page.route('**/api/v1/export-profiles/profile-woo/versions', async (route: Route) => {
    await route.fulfill({
      json:
        route.request().method() === 'POST' ? { version: { id: 'version-woo' } } : { items: [] },
    });
  });
  await page.route('**/api/v1/export-batches', async (route: Route) => {
    if (route.request().method() === 'POST') {
      created = true;
      await route.fulfill({ json: { batch: { id: 'batch-failed' } } });
    } else
      await route.fulfill({
        json: {
          items: created
            ? [
                {
                  id: 'batch-failed',
                  status: 'failed',
                  format: 'xlsx',
                  rowMode: 'line',
                  orderCount: 1,
                  rowCount: 0,
                  error: 'EXPORT_REQUIRED_FIELD_MISSING',
                },
              ]
            : [],
        },
      });
  });
  await page.route('**/api/v1/selections', async (route: Route) => {
    await route.fulfill({ json: { selection: { id: 'selection-failed', estimatedCount: 1 } } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Export & print', exact: true }).click();
  await page.getByRole('button', { name: 'Export Excel' }).click();
  await expect.poll(() => created).toBe(true);
  await page.locator('[data-testid="navigation-exports"]:visible').click();
  await expect(page.getByText('EXPORT_REQUIRED_FIELD_MISSING')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(downloads).toBe(0);
});

test('renders bounded Arabic orders workspace and keyboard detail navigation @orders @localization', async ({
  page,
}) => {
  const queryBodies = await mockOrderApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'إدارة الطلبات' })).toBeVisible();
  const accountToggle = page.getByTestId('sidebar-account-toggle');
  await expect(accountToggle).toContainText('admin@example.test');
  await expect(accountToggle).not.toContainText('طي القائمة');
  await accountToggle.click();
  await expect(page.getByRole('button', { name: 'فتح القائمة الجانبية' })).toBeVisible();
  await expect(accountToggle).not.toContainText('admin@example.test');
  await accountToggle.click();
  await expect(accountToggle).toContainText('admin@example.test');
  await expect(page.locator('[data-testid="navigation-connections"]:visible')).not.toContainText(
    'تخصيص بيانات المتجر',
  );
  await expect(page.getByText('خرائط الحقول', { exact: true })).toHaveCount(0);
  const mappingNav = page.locator('[data-testid="navigation-connections"]:visible');
  const mappingIcon = page.locator('[data-testid="navigation-connections-icon"]:visible');
  await expect
    .poll(async () => {
      const [navigationBox, iconBox] = await Promise.all([
        mappingNav.boundingBox(),
        mappingIcon.boundingBox(),
      ]);
      if (!navigationBox || !iconBox) return false;
      return iconBox.x > navigationBox.x + navigationBox.width / 2;
    })
    .toBe(true);
  await expect(page.getByTestId('orders-table')).toBeVisible();
  expect(queryBodies.some((body) => body.limit === 50)).toBe(true);
  expect(queryBodies.some((body) => body.includeFacets === true)).toBe(true);

  const scroller = page.getByTestId('orders-table-scroll');
  await expect(scroller).toBeVisible();
  expect(await scroller.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  await expect(page.getByTestId('saved-order-filters')).toHaveCount(0);
  const savedFiltersButton = page.locator('button[aria-controls="saved-order-filters"]');
  await savedFiltersButton.click();
  await expect(page.getByTestId('saved-order-filters')).toBeVisible();
  await expect(page.getByTestId('orders-table').locator('th').nth(1)).toHaveCSS(
    'text-align',
    'right',
  );
  await expect(page.getByText('لم يُصدّر', { exact: true })).toBeVisible();

  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'تصدير وطباعة', exact: true }).click();
  await expect(page.getByRole('button', { name: 'تصدير Excel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تصدير CSV' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تحميل فاتورة A4' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تحميل إيصال حراري' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'تحميل بوليصة شحن' })).toBeVisible();
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();
  await page.getByTestId('order-row-order-1').getByRole('checkbox').uncheck();

  await page.getByRole('button', { name: 'فلاتر متقدمة' }).click();
  const filterGrid = page.getByTestId('advanced-order-filters');
  await expect(filterGrid).toBeVisible();
  await expect(page.getByLabel('المحافظة / المنطقة')).toBeVisible();
  const governorateControl = page
    .getByLabel('المحافظة / المنطقة')
    .locator('xpath=ancestor::div[contains(@class,"MuiAutocomplete-root")]');
  const [governorateBox, governorateIndicatorBox] = await Promise.all([
    governorateControl.boundingBox(),
    governorateControl.locator('.MuiAutocomplete-popupIndicator').boundingBox(),
  ]);
  expect(governorateBox).not.toBeNull();
  expect(governorateIndicatorBox).not.toBeNull();
  expect(governorateIndicatorBox!.x).toBeLessThan(governorateBox!.x + governorateBox!.width / 2);
  await page.getByLabel('المحافظة / المنطقة').click();
  await page.getByRole('option', { name: 'القاهرة' }).click();
  await page.getByRole('button', { name: 'بحث', exact: true }).click();
  await expect
    .poll(() => JSON.stringify(queryBodies.at(-1)?.filter ?? null))
    .toContain('"field":"governorate","operator":"contains","value":"Cairo"');

  const row = page.getByTestId('order-row-order-1');
  await expect(row).toHaveCount(1);
  await row.press('Enter');
  await expect(page.getByText('بيانات المنصة')).toBeVisible();
  const arabicDrawerBox = await page
    .locator('.MuiDrawer-paper[role="dialog"]:visible')
    .filter({ hasText: 'بيانات المنصة' })
    .boundingBox();
  expect(arabicDrawerBox).not.toBeNull();
  expect(arabicDrawerBox!.x + arabicDrawerBox!.width / 2).toBeLessThan(
    page.viewportSize()!.width / 2,
  );
  await expect(page.getByText('قميص قطني')).toBeVisible();

  const itemsTab = page.getByRole('tab', { name: 'المنتجات' });
  await expect(itemsTab).toHaveCount(1);
  await itemsTab.click();
  await expect(page.getByRole('cell', { name: 'SHIRT-01' })).toBeVisible();

  const closeButton = page.getByRole('button', { name: 'إغلاق' });
  await expect(closeButton).toHaveCount(1);
  await closeButton.click();

  const languageButton = page.getByRole('button', { name: 'English' });
  await expect(languageButton).toHaveCount(1);
  await languageButton.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Orders workspace' })).toBeVisible();
  await page.getByTestId('order-row-order-1').press('Enter');
  await expect(page.getByText('Platform facts')).toBeVisible();
  const englishDrawerBox = await page
    .locator('.MuiDrawer-paper[role="dialog"]:visible')
    .filter({ hasText: 'Platform facts' })
    .boundingBox();
  expect(englishDrawerBox).not.toBeNull();
  expect(englishDrawerBox!.x + englishDrawerBox!.width / 2).toBeGreaterThan(
    page.viewportSize()!.width / 2,
  );
});

test('separates download and print in an accessible RTL dialog @orders', async ({ page }) => {
  await mockOrderApi(page);
  await page.goto('/');
  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  const launcher = page.getByRole('button', { name: 'تصدير وطباعة', exact: true });
  await launcher.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('dir', 'rtl');
  await expect(dialog.getByRole('button', { name: 'تحميل فاتورة A4' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'طباعة فاتورة A4' })).toHaveCount(0);
  await dialog.screenshot({ path: 'output/ui/output-dialog-download.png' });
  await dialog.getByRole('tab', { name: 'الطباعة', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'طباعة إيصال حراري' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'تصدير Excel' })).toHaveCount(0);
  await dialog.screenshot({ path: 'output/ui/output-dialog-print.png' });
  const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(launcher).toBeFocused();
  await expect(page.getByTestId('order-row-order-1').getByRole('checkbox')).toBeChecked();
});

test('keeps export choices and order details aligned across viewport and language @orders @exports', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  await page.getByTestId('order-row-order-1').getByRole('checkbox').check();
  await page.getByRole('button', { name: /تصدير وطباعة/u }).click();

  const dialog = page.getByRole('dialog');
  const paper = page.locator('.order-output-dialog__paper');
  await expect(paper).toHaveCSS('border-radius', '12px');
  await expect(dialog.locator('.order-output-dialog__document-row').first()).toHaveCSS(
    'flex-direction',
    'row',
  );
  const firstCopy = await dialog
    .locator('.order-output-dialog__document-copy')
    .first()
    .boundingBox();
  const firstAction = await dialog
    .locator('.order-output-dialog__document-action')
    .first()
    .boundingBox();
  expect(firstCopy).not.toBeNull();
  expect(firstAction).not.toBeNull();
  expect(firstAction!.x + firstAction!.width).toBeLessThanOrEqual(firstCopy!.x);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.locator('.order-output-dialog__document-row').first()).toHaveCSS(
    'flex-direction',
    'column',
  );
  const mobilePaper = await paper.boundingBox();
  expect(mobilePaper).not.toBeNull();
  expect(mobilePaper!.x).toBeGreaterThanOrEqual(0);
  expect(mobilePaper!.x + mobilePaper!.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');

  await page.getByTestId('order-row-order-1').press('Enter');
  const drawer = page.locator('.MuiDrawer-paper.order-detail-drawer__paper');
  await expect(drawer).toHaveAttribute('dir', 'rtl');
  await expect(drawer.locator('.order-detail__badges')).toHaveCSS('flex-direction', 'row');
  await expect(drawer.locator('.order-detail__fact').first()).toHaveCSS('display', 'grid');
  const mobileDrawer = await drawer.boundingBox();
  expect(mobileDrawer?.width).toBeCloseTo(390, 3);
  await drawer.getByRole('button', { name: /إغلاق/u }).click();

  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('order-row-order-1').press('Enter');
  await expect(drawer).toHaveAttribute('dir', 'ltr');
  await expect(drawer.locator('.order-detail__fact').first()).toHaveCSS('display', 'grid');
});

test('has no automated accessibility violations in the orders workspace @a11y @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('shows Woo export status only when the connector supplies authoritative evidence', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.route('**/api/v1/orders/query', async (route) => {
    const baseOrder = order;
    await route.fulfill({
      json: {
        items: [
          {
            ...baseOrder,
            id: 'order-exported',
            orderNumber: '1001',
            remoteExportStatus: 'exported',
          },
          {
            ...baseOrder,
            id: 'order-not-exported',
            orderNumber: '1002',
            remoteExportStatus: 'not_exported',
          },
          { ...baseOrder, id: 'order-unknown', orderNumber: '1003', remoteExportStatus: 'unknown' },
        ],
        nextCursor: null,
        hasMore: false,
        facets: [],
      },
    });
  });
  await page.goto('/');
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByText('Exported in WooCommerce', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Not exported in WooCommerce', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Woo status unavailable', { exact: true })).toHaveCount(1);
  await expect(page.getByTestId('woo-export-status-order-exported')).toHaveClass(/MuiChip-filled/u);
  await expect(page.getByTestId('woo-export-status-order-exported')).toHaveClass(
    /MuiChip-colorSuccess/u,
  );
  await expect(page.getByTestId('woo-export-status-order-not-exported')).toHaveClass(
    /MuiChip-outlined/u,
  );
  await expect(page.getByTestId('woo-export-status-order-unknown')).toHaveClass(
    /MuiChip-colorWarning/u,
  );
});

test('keeps a saved filter selected, applies its exact query and deletes it', async ({ page }) => {
  const queryBodies = await mockOrderApi(page);
  let deleted = false;
  await page.route('**/api/v1/saved-views', async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'saved-processing',
            name: 'Processing orders',
            query: {
              search: 'Ahmed',
              filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
            },
            sort: { field: 'remoteCreatedAt', direction: 'desc' },
            columns: ['orderNumber', 'remoteStatus'],
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/saved-views/saved-processing', async (route) => {
    deleted = route.request().method() === 'DELETE';
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/');
  await page.locator('button[aria-controls="saved-order-filters"]').click();
  await page.getByTestId('saved-order-filters').getByRole('combobox').click();
  await page.getByRole('option', { name: 'Processing orders' }).click();
  await expect(page.getByTestId('saved-order-filters').getByRole('combobox')).toContainText(
    'Processing orders',
  );
  await expect.poll(() => queryBodies.at(-1)?.search).toBe('Ahmed');
  await page.locator('#saved-order-filters button.MuiButton-colorError').click();
  await expect.poll(() => deleted).toBe(true);
  await expect(page.getByText('Processing orders')).toHaveCount(0);
});

test('keeps a deterministic visual baseline for the Arabic workspace @visual @orders', async ({
  page,
}) => {
  await mockOrderApi(page);
  await page.goto('/');
  await expect(page.getByTestId('orders-table')).toBeVisible();
  await expect(page).toHaveScreenshot('orders-workspace.png', { animations: 'disabled' });
});
