import { defineConfig, devices } from '@playwright/test';

const port = process.env.PW_PORT ?? '4175';
const packageManager = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: 'ar-EG',
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `${packageManager} run dev --workspace=@woo-ops/web -- --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
