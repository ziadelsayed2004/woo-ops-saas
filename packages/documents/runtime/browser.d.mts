import type { Browser, LaunchOptions } from 'playwright-chromium';

export type DocumentBrowserProvider = 'portable-linux' | 'playwright';

export declare const documentBrowserProvider: (
  platform?: NodeJS.Platform,
) => DocumentBrowserProvider;
export declare const documentBrowserCacheDirectory: (options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) => string;
export declare const preparePortableBrowserEnvironment: (options?: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}) => Promise<string>;
export declare const documentBrowserLaunchOptions: (options?: {
  platform?: NodeJS.Platform;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  loadPortableChromium?: () => Promise<{
    default: { args: string[]; executablePath: () => Promise<string> };
  }>;
}) => Promise<LaunchOptions>;
export declare const launchDocumentBrowser: () => Promise<Browser>;
