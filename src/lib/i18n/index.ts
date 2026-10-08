/**
 * Isomorphic i18n runtime: locale resolution, typed message lookup, interpolation and plurals.
 * Server components use `getI18n()` (./server), client components `useI18n()` (./client).
 */
import { formatNumber, formatPlainNumber, intlTag } from '@/lib/utils';
import { defineMessages, type MessageTree } from './define';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  dirOf,
  isLocale,
  type Direction,
  type Locale,
} from './locales';
import account from './messages/account';
import auth from './messages/auth';
import billing from './messages/billing';
import common from './messages/common';
import errors from './messages/errors';
import gallery from './messages/gallery';
import landing from './messages/landing';
import legal from './messages/legal';
import studio from './messages/studio';

// ---- Locales ---------------------------------------------------------------------------------

export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, dirOf, isLocale };
export type { Direction, Locale };

const LOCALE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

/**
 * Picks the best supported locale from an `Accept-Language` header: highest `q` first, region
 * subtags ignored (`ar-SA` -> `ar`), wildcard and `q=0` entries skipped. Null when nothing matches.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const candidates: Array<{ locale: Locale; q: number; order: number }> = [];
  header.split(',').forEach((part, order) => {
    const [tag = '', ...params] = part.trim().split(';');
    const primary = tag.trim().toLowerCase().split('-')[0];
    if (!isLocale(primary)) return;
    let q = 1;
    for (const param of params) {
      const [name, value] = param.trim().split('=');
      if (name?.toLowerCase() === 'q') q = Number(value);
    }
    if (Number.isFinite(q) && q > 0) candidates.push({ locale: primary, q, order });
  });
  candidates.sort((a, b) => b.q - a.q || a.order - b.order);
  return candidates[0]?.locale ?? null;
}

/** Resolution order: locale cookie, then Accept-Language, then Arabic. */
export function resolveLocale(input: {
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  return parseAcceptLanguage(input.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Reads the locale cookie out of a `Cookie` request header value. */
export function readLocaleCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() !== LOCALE_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    return isLocale(value) ? value : null;
  }
  return null;
}

/** Resolves the locale of a request from its `Cookie` and `Accept-Language` headers. */
export function localeFromHeaders(headers: Headers): Locale {
  return resolveLocale({
    cookie: readLocaleCookie(headers.get('cookie')),
    acceptLanguage: headers.get('accept-language'),
  });
}

/** A `Set-Cookie` / `document.cookie` string. Readable by scripts on purpose: it is a preference. */
export function serializeLocaleCookie(locale: Locale, options: { secure?: boolean } = {}): string {
  const parts = [
    `${LOCALE_COOKIE}=${locale}`,
    'Path=/',
    `Max-Age=${LOCALE_COOKIE_MAX_AGE_SEC}`,
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

// ---- Messages --------------------------------------------------------------------------------

export { defineMessages };
export type { MessageTree };

const dictionaries = {
  common,
  errors,
  auth,
  landing,
  studio,
  gallery,
  account,
  legal,
  billing,
};

type Dictionaries = typeof dictionaries;
type Messages = { [N in keyof Dictionaries]: Dictionaries[N]['en'] };

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every translatable key as a dotted path, e.g. `common.nav.studio`. */
export type MessageKey = Paths<Messages>;
export type MessageVars = Readonly<Record<string, string | number>>;

export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

export type TFunction = (key: MessageKey, vars?: MessageVars) => string;

export interface Translator {
  readonly locale: Locale;
  readonly dir: Direction;
  t: TFunction;
  /**
   * Picks the form for `count` with `Intl.PluralRules` (Arabic: zero/one/two/few/many/other).
   * Missing categories fall back to `other`; a `zero` form wins for 0 in every language.
   * `{count}` (and any `vars`) are interpolated, `count` formatted with the locale's digits.
   */
  plural: (count: number, forms: PluralForms, vars?: MessageVars) => string;
}

const flatCache = new Map<Locale, ReadonlyMap<string, string>>();

function flatten(tree: MessageTree, prefix: string, into: Map<string, string>): void {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') into.set(path, value);
    else flatten(value, path, into);
  }
}

function flatMessages(locale: Locale): ReadonlyMap<string, string> {
  let flat = flatCache.get(locale);
  if (!flat) {
    const map = new Map<string, string>();
    for (const [namespace, dictionary] of Object.entries(dictionaries)) {
      flatten(dictionary[locale], namespace, map);
    }
    flat = map;
    flatCache.set(locale, flat);
  }
  return flat;
}

function interpolate(template: string, vars: MessageVars | undefined, locale: Locale): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(vars, name)) return placeholder;
    const value = vars[name];
    if (value === undefined) return placeholder;
    return typeof value === 'number' ? formatPlainNumber(value, locale) : value;
  });
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(intlTag(locale));
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

export function selectPlural(locale: Locale, count: number, forms: PluralForms): string {
  if (count === 0 && forms.zero !== undefined) return forms.zero;
  return forms[pluralCategory(locale, count)] ?? forms.other;
}

const translators = new Map<Locale, Translator>();

export function createTranslator(locale: Locale): Translator {
  const cached = translators.get(locale);
  if (cached) return cached;
  const messages = flatMessages(locale);
  const translator: Translator = {
    locale,
    dir: dirOf(locale),
    // A key outside the typed set (dynamic lookups) renders as itself instead of crashing a page.
    t: (key, vars) => interpolate(messages.get(key) ?? key, vars, locale),
    plural: (count, forms, vars) =>
      interpolate(
        selectPlural(locale, count, forms),
        { ...vars, count: formatNumber(count, locale) },
        locale,
      ),
  };
  translators.set(locale, translator);
  return translator;
}
