import 'server-only';
import { cookies, headers } from 'next/headers';
import {
  createTranslator,
  LOCALE_COOKIE,
  resolveLocale,
  type Locale,
  type Translator,
} from './index';

/** Locale of the current request: cookie, then Accept-Language, then Arabic. */
export async function getLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });
}

/** `const { locale, dir, t, plural } = await getI18n()` in server components and layouts. */
export async function getI18n(): Promise<Translator> {
  return createTranslator(await getLocale());
}
