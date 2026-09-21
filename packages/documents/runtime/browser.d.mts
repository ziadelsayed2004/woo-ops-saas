import type { Browser, LaunchOptions } from 'playwright-chromium';

export type DocumentBrowserProvider = 'portable-linux' | 'playwright';

export declare const documentBrowserProvider: (
  platform?: NodeJS.Platform,
) => DocumentBrowserProvider;
export declare const documentBrowserLaunchOptions: () => Promise<LaunchOptions>;
export declare const launchDocumentBrowser: () => Promise<Browser>;
