import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const documentsRequire = createRequire(
  join(process.cwd(), 'packages', 'documents', 'package.json'),
);
const playwrightPackage = documentsRequire.resolve('playwright-core/package.json');
const cli = join(dirname(playwrightPackage), 'cli.js');
const { documentBrowserProvider, launchDocumentBrowser, preparePortableBrowserEnvironment } =
  await import('../packages/documents/runtime/browser.mjs');
const provider = documentBrowserProvider();
process.stdout.write(`[documents] browser provider: ${provider}\n`);

if (provider === 'portable-linux') {
  const cacheDirectory = await preparePortableBrowserEnvironment();
  process.stdout.write(`[documents] executable cache: ${cacheDirectory}\n`);
}

if (provider === 'playwright') {
  const result = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: '0',
      PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT:
        process.env.PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT ?? '120000',
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Fail deployment early instead of silently producing a different PDF layout at runtime.
const browser = await launchDocumentBrowser();
try {
  const page = await browser.newPage();
  await page.setContent('<html><body>Woo Ops PDF readiness</body></html>');
  const pdf = await page.pdf();
  if (pdf.length < 100) throw new Error('DOCUMENT_BROWSER_PDF_CHECK_FAILED');
} finally {
  await browser.close();
}
