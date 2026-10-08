/** Locale primitives with no dependencies, importable from anywhere (including the DB schema). */

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export type Direction = 'rtl' | 'ltr';

export const DEFAULT_LOCALE: Locale = 'ar';
export const LOCALE_COOKIE = 'aivore_locale';

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): Direction {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
