import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const user = {
  id: 'user-1',
  accountId: 'account-1',
  email: 'admin@example.test',
  role: 'admin',
} as const;
const account = {
  id: 'account-1',
  name: 'Demo account',
  locale: 'ar-EG',
  direction: 'rtl',
  timezone: 'Africa/Cairo',
  baseCurrency: 'EGP',
} as const;
const connection = {
  id: 'connection-1',
  platform: 'woocommerce',
  storeUrl: 'https://shop.example.test',
  displayName: 'Demo shop',
  status: 'active',
  healthStatus: 'healthy',
  syncStatus: 'succeeded',
  syncLastSuccessAt: '2026-08-31T08:00:00.000Z',
  syncOrdersCount: 12,
  syncCatalogCount: 8,
};

async function mockAdminApi(page: Page, session: 'authenticated' | 'expired' = 'authenticated') {
  let sessionCalls = 0;
  await page.route('**/api/v1/auth/session', async (route: Route) => {
    if (session === 'expired' && sessionCalls++ < 2) {
      await route.fulfill({ status: 401, json: { error: { code: 'AUTH_UNAUTHENTICATED' } } });
      return;
    }
    await route.fulfill({ json: { user } });
  });
  await page.route('**/api/v1/auth/login', async (route: Route) => {
    await route.fulfill({ json: { user } });
  });
  await page.route('**/api/v1/orders/query', async (route: Route) => {
    await route.fulfill({ json: { items: [], nextCursor: null, hasMore: false, totalCount: 0 } });
  });
  await page.route('**/api/v1/account', async (route: Route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ json: { account } });
      return;
    }
    await route.fulfill({ json: { account, user } });
  });
  await page.route('**/api/v1/operations/health', async (route: Route) => {
    await route.fulfill({
      json: {
        health: {
          database: 'connected',
          schemaVersion: 22,
          queue: { queued: 1, running: 0, deadLettered: 0 },
        },
        runner: {
          running: true,
          active: 0,
          registeredTypes: ['analytics.rebuild', 'field-mapping.backfill'],
        },
      },
    });
  });
  await page.route('**/api/v1/operations/usage', async (route: Route) => {
    await route.fulfill({
      json: {
        usage: {
          total: 2,
          queued: 1,
          running: 0,
          succeeded: 1,
          failed: 0,
          deadLettered: 0,
          payloadBytes: 20,
        },
      },
    });
  });
  await page.route('**/api/v1/operations/jobs?limit=50', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: 'job-1',
            type: 'analytics.rebuild',
            status: 'queued',
            progress: 25,
            attempts: 0,
            maxAttempts: 3,
            lastError: null,
            cancelRequested: false,
            createdAt: '2026-08-31T08:00:00.000Z',
            updatedAt: '2026-08-31T08:00:00.000Z',
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/operations/dead-letters?limit=50', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route('**/api/v1/operations/maintenance', async (route: Route) => {
    await route.fulfill({
      status: 202,
      json: {
        job: {
          id: 'maintenance-1',
          type: 'maintenance',
          status: 'queued',
          progress: 0,
          attempts: 0,
          maxAttempts: 3,
          lastError: null,
          cancelRequested: false,
          createdAt: '2026-08-31T08:00:00.000Z',
          updatedAt: '2026-08-31T08:00:00.000Z',
        },
      },
    });
  });
  await page.route('**/api/v1/connections', async (route: Route) => {
    await route.fulfill({ json: { items: [connection] } });
  });
  await page.route('**/api/v1/connections/connection-1/fields', async (route: Route) => {
    await route.fulfill({
      json: {
        catalog: [
          {
            id: 'field-1',
            connectionId: connection.id,
            scope: 'order',
            sourceKey: 'pos_location',
            sensitivity: 'safe',
            inferredType: 'text',
            occurrences: 4,
            sample: 'Cairo',
            discoveredAt: '2026-08-31T08:00:00.000Z',
          },
        ],
        mappings: [],
      },
    });
  });
  await page.route('**/api/v1/members', async (route: Route) => {
    await route.fulfill({
      json: {
        items: [
          {
            userId: user.id,
            email: user.email,
            role: 'admin',
            status: 'active',
            createdAt: '2026-08-31T08:00:00.000Z',
          },
        ],
      },
    });
  });
  await page.route('**/api/v1/members/invitations', async (route: Route) => {
    await route.fulfill({ json: { items: [] } });
  });
}

test('admin navigation exposes authenticated operational workspaces and route states @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByRole('button', { name: 'Overview' }).click();
  await expect(page.getByTestId('admin-overview')).toBeVisible();
  await page.getByRole('button', { name: 'WooCommerce connection' }).click();
  await expect(page.getByTestId('connections-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'Members' }).click();
  await expect(page.getByTestId('members-workspace')).toBeVisible();
  await page.getByRole('button', { name: 'System health' }).click();
  await expect(page.getByTestId('operations-workspace')).toBeVisible();
  await expect(page.getByText('analytics.rebuild')).toBeVisible();
  await page.getByRole('button', { name: 'Run system maintenance' }).click();
  await expect(page.getByText('System maintenance was queued.')).toBeVisible();
});

test('expired sessions return to login and can authenticate again @admin', async ({ page }) => {
  await mockAdminApi(page, 'expired');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible();
  await page.getByLabel('البريد الإلكتروني').fill('admin@example.test');
  await page.getByLabel('كلمة المرور').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
});

test('Arabic login fields, labels and notches align right while headings stay centered @admin', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'AUTH_UNAUTHENTICATED' } } }),
  );
  await page.route('**/api/v1/auth/setup', (route) =>
    route.fulfill({ json: { registrationOpen: false } }),
  );
  await page.goto('/');
  const email = page.getByLabel('البريد الإلكتروني');
  await expect(email).toBeVisible();
  const positions = await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[type="email"]')!;
    const field = input.closest('.MuiFormControl-root')!;
    const label = field.querySelector('label')!;
    const legend = field.querySelector('legend')!;
    const heading = document.querySelector('h1')!;
    const subtitle = document.querySelector('h2')!;
    const paper = document.querySelector('main')!;
    const center = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.left + rect.width / 2;
    };
    return {
      inputAlign: getComputedStyle(input).textAlign,
      fieldRight: field.getBoundingClientRect().right,
      labelRight: label.getBoundingClientRect().right,
      legendRight: legend.getBoundingClientRect().right,
      headingCenter: center(heading),
      subtitleCenter: center(subtitle),
      paperCenter: center(paper),
    };
  });
  expect(positions.inputAlign).toBe('right');
  expect(positions.fieldRight - positions.labelRight).toBeLessThan(40);
  expect(positions.fieldRight - positions.legendRight).toBeLessThan(40);
  expect(Math.abs(positions.headingCenter - positions.paperCenter)).toBeLessThan(5);
  expect(Math.abs(positions.subtitleCenter - positions.paperCenter)).toBeLessThan(5);
});

test('Arabic outlined selects keep arrows opposite right-hand labels @admin', async ({ page }) => {
  await mockAdminApi(page);
  await page.goto('/settings');
  const positions = await page.getByTestId('settings-workspace').evaluate((workspace) => {
    const select = workspace.querySelector('.MuiSelect-select')!;
    const field = select.closest('.MuiFormControl-root')!;
    const label = field.querySelector('label')!;
    const legend = field.querySelector('legend')!;
    const icon = field.querySelector('.MuiSelect-icon')!;
    return {
      selectAlign: getComputedStyle(select).textAlign,
      fieldLeft: field.getBoundingClientRect().left,
      fieldRight: field.getBoundingClientRect().right,
      labelRight: label.getBoundingClientRect().right,
      legendRight: legend.getBoundingClientRect().right,
      iconRight: icon.getBoundingClientRect().right,
      iconLeft: icon.getBoundingClientRect().left,
      labelLeft: label.getBoundingClientRect().left,
    };
  });
  expect(positions.selectAlign).toBe('right');
  expect(positions.iconLeft - positions.fieldLeft).toBeGreaterThanOrEqual(12);
  expect(positions.iconLeft - positions.fieldLeft).toBeLessThanOrEqual(18);
  expect(positions.labelLeft - positions.iconRight).toBeGreaterThanOrEqual(8);
  expect(positions.fieldRight - positions.labelRight).toBeGreaterThanOrEqual(12);
  expect(positions.fieldRight - positions.legendRight).toBeGreaterThanOrEqual(8);
});

test('language switch updates text and direction together @admin', async ({ page }) => {
  await mockAdminApi(page);
  await page.goto('/settings');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible();
});

test('admin workspaces have no automated accessibility violations @a11y @admin', async ({
  page,
}) => {
  await mockAdminApi(page);
  await page.goto('/overview');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('mobile drawer navigates and Woo return shows a safe connection state @admin', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockAdminApi(page);
  await page.goto('/connections/woocommerce/callback?success=1&user_id=opaque-state');
  await expect(page).toHaveURL(/\/connections$/u);
  await expect(page.getByText('تمت الموافقة في WooCommerce.')).toBeVisible();
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('button', { name: 'التحليلات' }).click();
  await expect(page.getByTestId('analytics-workspace')).toBeVisible();
});
