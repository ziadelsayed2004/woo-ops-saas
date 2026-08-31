import { expect, test, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('edits a safe document template and previews a PDF @a11y @documents', async ({ page }) => {
  const template = {
    id: 'template-1',
    name: 'Invoice',
    format: 'a4',
    locale: 'en-US',
    direction: 'ltr',
    version: 1,
    body: '{{order.number}} {{customer.name}}',
    companyName: 'Woo Ops',
    companyAddress: null,
    footerText: null,
    active: true,
  } as const;
  await page.route('**/api/v1/auth/session', async (route) => {
    await route.fulfill({
      json: {
        user: { id: 'user-1', accountId: 'account-1', email: 'admin@example.test', role: 'admin' },
      },
    });
  });
  await page.route('**/api/v1/orders/query', async (route) => {
    await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false } });
  });
  await page.route('**/api/v1/document-templates', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [template] } });
      return;
    }
    await route.fulfill({ status: 201, json: { template } });
  });
  await page.route('**/api/v1/document-templates/template-1', async (route) => {
    await route.fulfill({ json: { template } });
  });
  await page.route('**/api/v1/document-templates/template-1/preview', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/pdf',
      body: Buffer.from('%PDF-1.7 document-preview-fixture'),
    });
  });
  await page.route('**/api/v1/document-jobs?limit=20', async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Documents' }).click();
  await expect(page.getByTestId('documents-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Document templates & printing' })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await expect(
    page.getByText(
      'Only allowlisted tokens are supported. HTML, scripts, and network loads are blocked.',
    ),
  ).toBeVisible();
  await page.getByLabel('Safe template text').fill('{{order.number}}\n{{customer.name}}');
  await page.getByRole('button', { name: 'Save template' }).click();
  await page.getByRole('button', { name: 'Preview PDF' }).click();
  await expect(page.getByTitle('Preview PDF')).toBeVisible();
});
