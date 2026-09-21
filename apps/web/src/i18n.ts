import ar from './locales/ar.json';
import en from './locales/en.json';

export type AppLocale = 'ar' | 'en';
type Catalog = typeof en;
type Primitive = string | number | boolean | null;
type LeafPaths<T, Prefix extends string = ''> = {
  [Key in keyof T & string]: T[Key] extends Primitive
    ? `${Prefix}${Key}`
    : T[Key] extends Record<string, unknown>
      ? LeafPaths<T[Key], `${Prefix}${Key}.`>
      : never;
}[keyof T & string];

export type TranslationKey = LeafPaths<Catalog>;
export type TranslationParameters = Readonly<Record<string, string | number>>;

const catalogs: Record<AppLocale, Catalog> = { ar, en };

const readPath = (catalog: Catalog, key: TranslationKey): string => {
  let value: unknown = catalog;
  for (const segment of key.split('.')) {
    if (value === null || typeof value !== 'object' || !(segment in value)) {
      throw new Error(`Missing translation key: ${key}`);
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (typeof value !== 'string') throw new Error(`Translation key is not text: ${key}`);
  return value;
};

export const translate = (
  locale: AppLocale,
  key: TranslationKey,
  parameters: TranslationParameters = {},
): string =>
  readPath(catalogs[locale], key).replace(/\{\{([a-zA-Z0-9_]+)\}\}/gu, (token, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : token,
  );

export const getAppCopy = (locale: AppLocale): Catalog['app'] => catalogs[locale].app;
export const getAdminCopy = (locale: AppLocale): Catalog['admin'] => catalogs[locale].admin;
export const getShellCopy = (locale: AppLocale): Catalog['shell'] => catalogs[locale].shell;
export const getOutputDialogCopy = (locale: AppLocale): Catalog['outputDialog'] =>
  catalogs[locale].outputDialog;
