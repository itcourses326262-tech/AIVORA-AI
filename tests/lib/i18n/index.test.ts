import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALES,
  createTranslator,
  dirOf,
  isLocale,
  localeFromHeaders,
  parseAcceptLanguage,
  pluralCategory,
  readLocaleCookie,
  resolveLocale,
  selectPlural,
  serializeLocaleCookie,
} from '@/lib/i18n';

describe('locale basics', () => {
  it('supports Arabic and English with Arabic as the default', () => {
    expect(LOCALES).toEqual(['ar', 'en']);
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(LOCALE_COOKIE).toBe('aivore_locale');
  });

  it('derives the direction from the locale', () => {
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });

  it('isLocale only accepts supported locales', () => {
    expect(isLocale('ar')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('parseAcceptLanguage', () => {
  it.each([
    ['en-US,en;q=0.9,ar;q=0.8', 'en'],
    ['ar-SA,ar;q=0.9,en;q=0.5', 'ar'],
    ['fr-FR,fr;q=0.9,en;q=0.8', 'en'],
    ['fr, ar;q=0.2', 'ar'],
    ['en;q=0.3, ar;q=0.7', 'ar'],
    ['EN', 'en'],
    ['ar;q=0, en;q=0.1', 'en'],
    ['en, ar', 'en'],
  ])('%s -> %s', (header, expected) => {
    expect(parseAcceptLanguage(header)).toBe(expected);
  });

  it.each([[''], ['*'], ['fr-FR,de;q=0.5'], ['ar;q=0'], ['garbage;;q=x']])(
    'returns null for %j',
    (header) => {
      expect(parseAcceptLanguage(header)).toBeNull();
    },
  );

  it('returns null for a missing header', () => {
    expect(parseAcceptLanguage(null)).toBeNull();
    expect(parseAcceptLanguage(undefined)).toBeNull();
  });
});

describe('resolveLocale', () => {
  it('prefers the cookie over Accept-Language', () => {
    expect(resolveLocale({ cookie: 'en', acceptLanguage: 'ar' })).toBe('en');
  });

  it('uses Accept-Language when the cookie is missing or invalid', () => {
    expect(resolveLocale({ acceptLanguage: 'en-GB' })).toBe('en');
    expect(resolveLocale({ cookie: 'klingon', acceptLanguage: 'en' })).toBe('en');
  });

  it('falls back to Arabic', () => {
    expect(resolveLocale({})).toBe('ar');
    expect(resolveLocale({ cookie: null, acceptLanguage: 'fr' })).toBe('ar');
  });
});

describe('locale cookie helpers', () => {
  it('serializes a year-long, same-site cookie', () => {
    expect(serializeLocaleCookie('en')).toBe(
      'aivore_locale=en; Path=/; Max-Age=31536000; SameSite=Lax',
    );
    expect(serializeLocaleCookie('ar', { secure: true })).toMatch(/; Secure$/);
  });

  it('reads the locale out of a Cookie header', () => {
    expect(readLocaleCookie('a=1; aivore_locale=en; b=2')).toBe('en');
    expect(readLocaleCookie('aivore_locale=de')).toBeNull();
    expect(readLocaleCookie('other=ar')).toBeNull();
    expect(readLocaleCookie('')).toBeNull();
    expect(readLocaleCookie(null)).toBeNull();
    expect(readLocaleCookie('novalue')).toBeNull();
  });

  it('resolves the locale of a whole request', () => {
    expect(localeFromHeaders(new Headers({ cookie: 'aivore_locale=en' }))).toBe('en');
    expect(localeFromHeaders(new Headers({ 'accept-language': 'en-US' }))).toBe('en');
    expect(localeFromHeaders(new Headers())).toBe('ar');
  });
});

describe('translator', () => {
  it('translates dotted keys in both languages', () => {
    const en = createTranslator('en');
    const ar = createTranslator('ar');
    expect(en.t('common.nav.studio')).toBe('Studio');
    expect(ar.t('common.nav.studio')).toBe('الاستوديو');
    expect(en.t('studio.generate')).toBe('Generate');
    expect(en.dir).toBe('ltr');
    expect(ar.dir).toBe('rtl');
    expect(ar.locale).toBe('ar');
  });

  it('returns the same translator instance for a locale', () => {
    expect(createTranslator('en')).toBe(createTranslator('en'));
  });

  it('renders an unknown key as itself instead of throwing', () => {
    const { t } = createTranslator('en');
    expect(t('common.nope' as never)).toBe('common.nope');
  });

  it('is a compile error to use a key that does not exist', () => {
    const { t } = createTranslator('en');
    // @ts-expect-error unknown key
    t('common.nav.missing');
    // @ts-expect-error namespaces are not keys
    t('common.nav');
  });
});

describe('interpolation', () => {
  // Interpolation is exercised through plural() because the seed dictionaries have no {vars};
  // t() shares the same implementation.
  it('replaces {name} placeholders and keeps unknown ones visible', () => {
    const { plural } = createTranslator('en');
    expect(plural(1, { one: 'Hello {name}, {missing}', other: 'x' }, { name: 'Sara' })).toBe(
      'Hello Sara, {missing}',
    );
  });

  it('formats numeric values with the locale digits and no grouping', () => {
    const forms = { other: 'Year {year}' };
    expect(createTranslator('en').plural(2, forms, { year: 2026 })).toBe('Year 2026');
    expect(createTranslator('ar').plural(2, forms, { year: 2026 })).toBe('Year ٢٠٢٦');
  });

  it('does not treat vars as a way to read prototype properties', () => {
    const { plural } = createTranslator('en');
    expect(plural(1, { other: '{constructor}' }, {})).toBe('{constructor}');
  });
});

describe('plural', () => {
  const english = { one: '{count} image', other: '{count} images' };
  const arabic = {
    zero: 'لا صور',
    one: 'صورة واحدة',
    two: 'صورتان',
    few: '{count} صور',
    many: '{count} صورة',
    other: '{count} صورة',
  };

  it('uses English one/other', () => {
    const { plural } = createTranslator('en');
    expect(plural(1, english)).toBe('1 image');
    expect(plural(0, english)).toBe('0 images');
    expect(plural(2, english)).toBe('2 images');
    expect(plural(1234, english)).toBe('1,234 images');
  });

  it.each([
    [0, 'zero', 'لا صور'],
    [1, 'one', 'صورة واحدة'],
    [2, 'two', 'صورتان'],
    [3, 'few', '٣ صور'],
    [10, 'few', '١٠ صور'],
    [11, 'many', '١١ صورة'],
    [99, 'many', '٩٩ صورة'],
    [100, 'other', '١٠٠ صورة'],
  ])('uses the Arabic %i -> %s category', (count, category, text) => {
    expect(pluralCategory('ar', count)).toBe(category);
    expect(createTranslator('ar').plural(count, arabic)).toBe(text);
  });

  it('falls back to other for categories a message does not define', () => {
    expect(selectPlural('ar', 2, { one: 'a', other: 'b' })).toBe('b');
    expect(selectPlural('en', 5, { one: 'a', other: 'b' })).toBe('b');
  });

  it('prefers an explicit zero form for 0 in any language', () => {
    expect(selectPlural('en', 0, { zero: 'none', one: 'a', other: 'b' })).toBe('none');
  });

  it('treats non-finite counts as other', () => {
    expect(selectPlural('en', Number.NaN, { one: 'a', other: 'b' })).toBe('b');
  });
});
