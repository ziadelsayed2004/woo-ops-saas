/**
 * Keep production PDF rendering and deployment readiness on one browser path.
 * Hostinger shared Linux images cannot install Playwright's system packages, so
 * Linux uses the self-contained Sparticuz Chromium distribution. Windows and
 * macOS keep Playwright's managed browser for local development.
 */
export const documentBrowserProvider = (platform = process.platform) =>
  platform === 'linux' ? 'portable-linux' : 'playwright';

export const documentBrowserLaunchOptions = async () => {
  if (documentBrowserProvider() === 'portable-linux') {
    const { default: portableChromium } = await import('@sparticuz/chromium');
    return {
      args: portableChromium.args,
      executablePath: await portableChromium.executablePath(),
      headless: true,
    };
  }

  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
  return { headless: true };
};

export const launchDocumentBrowser = async () => {
  const { chromium } = await import('playwright-chromium');
  return chromium.launch(await documentBrowserLaunchOptions());
};
