import { chmod, lstat, mkdir, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, parse, relative, resolve } from 'node:path';

// Capture this before portable preparation rewrites TMPDIR/TMP/TEMP. Calling
// os.tmpdir() after that mutation would identify our own cache as system temp.
const operatingSystemTempDirectory = resolve(tmpdir());

/**
 * Keep production PDF rendering and deployment readiness on one browser path.
 * Hostinger shared Linux images cannot install Playwright's system packages, so
 * Linux uses the self-contained Sparticuz Chromium distribution. Windows and
 * macOS keep Playwright's managed browser for local development.
 */
export const documentBrowserProvider = (platform = process.platform) =>
  platform === 'linux' ? 'portable-linux' : 'playwright';

const isInsideDirectory = (directory, candidate) => {
  const pathFromDirectory = relative(directory, candidate);
  return (
    pathFromDirectory === '' ||
    (!pathFromDirectory.startsWith('..') && !isAbsolute(pathFromDirectory))
  );
};

const assertSafeCacheDirectory = (cacheDirectory, cwd) => {
  const resolvedCache = resolve(cacheDirectory);
  const forbiddenExactPaths = [parse(resolvedCache).root, resolve(cwd), resolve(homedir())];
  if (
    forbiddenExactPaths.includes(resolvedCache) ||
    isInsideDirectory(operatingSystemTempDirectory, resolvedCache)
  ) {
    throw new Error('WOO_OPS_BROWSER_CACHE_DIR_UNSAFE');
  }
};

export const documentBrowserCacheDirectory = ({ cwd = process.cwd(), env = process.env } = {}) => {
  const configured = env.WOO_OPS_BROWSER_CACHE_DIR?.trim();
  if (configured && !isAbsolute(configured)) {
    throw new Error('WOO_OPS_BROWSER_CACHE_DIR_MUST_BE_ABSOLUTE');
  }
  const cacheDirectory = configured || resolve(cwd, '.cache', 'woo-ops-browser');
  assertSafeCacheDirectory(cacheDirectory, cwd);
  return cacheDirectory;
};

export const preparePortableBrowserEnvironment = async ({
  cwd = process.cwd(),
  env = process.env,
} = {}) => {
  const cacheDirectory = documentBrowserCacheDirectory({ cwd, env });
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
  const cacheStat = await lstat(cacheDirectory);
  if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) {
    throw new Error('WOO_OPS_BROWSER_CACHE_DIR_INVALID');
  }
  const executableCacheDirectory = await realpath(cacheDirectory);
  assertSafeCacheDirectory(executableCacheDirectory, cwd);
  await chmod(executableCacheDirectory, 0o700);
  env.TMPDIR = executableCacheDirectory;
  env.TMP = executableCacheDirectory;
  env.TEMP = executableCacheDirectory;
  return executableCacheDirectory;
};

export const documentBrowserLaunchOptions = async ({
  platform = process.platform,
  cwd = process.cwd(),
  env = process.env,
  loadPortableChromium = () => import('@sparticuz/chromium'),
} = {}) => {
  if (documentBrowserProvider(platform) === 'portable-linux') {
    const cacheDirectory = await preparePortableBrowserEnvironment({ cwd, env });
    const { default: portableChromium } = await loadPortableChromium();
    const executablePath = await portableChromium.executablePath();
    if (!isInsideDirectory(cacheDirectory, executablePath)) {
      throw new Error('DOCUMENT_BROWSER_EXECUTABLE_OUTSIDE_CACHE');
    }
    await chmod(executablePath, 0o700);
    return {
      args: portableChromium.args,
      executablePath,
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
