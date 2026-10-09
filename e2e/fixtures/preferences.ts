import type { BrowserContext } from '@playwright/test';

export type Locale = 'ar' | 'en';
export type Theme = 'light' | 'dark';

/** The cookies the app itself writes when the language or theme is switched (`aivore_locale`, `aivore_theme`). */
export async function setPreferences(
  context: BrowserContext,
  baseURL: string,
  preferences: { locale?: Locale; theme?: Theme },
): Promise<void> {
  const cookies = [];
  if (preferences.locale) {
    cookies.push({ name: 'aivore_locale', value: preferences.locale, url: baseURL });
  }
  if (preferences.theme) {
    cookies.push({ name: 'aivore_theme', value: preferences.theme, url: baseURL });
  }
  await context.addCookies(cookies);
}

export const COMBINATIONS: ReadonlyArray<{ locale: Locale; theme: Theme }> = [
  { locale: 'en', theme: 'dark' },
  { locale: 'en', theme: 'light' },
  { locale: 'ar', theme: 'dark' },
  { locale: 'ar', theme: 'light' },
];

export function describeCombination(combination: { locale: Locale; theme: Theme }): string {
  return `${combination.locale}/${combination.theme}`;
}
