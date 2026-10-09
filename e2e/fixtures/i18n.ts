import { createTranslator, type Locale, type TFunction } from '@/lib/i18n';

/** The app's own translator, so expectations come from the dictionaries instead of copies of them. */
export function translate(locale: Locale): TFunction {
  return createTranslator(locale).t;
}

/**
 * English copy by key. A page's wording is the dictionary's business: a test that spells it out
 * would fail on every copy edit that changes no behaviour, and could not tell the two apart.
 */
export const en: TFunction = translate('en');
