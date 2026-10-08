import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestState = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = requestState.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => requestState.headers,
}));

import { getI18n, getLocale } from '@/lib/i18n/server';

beforeEach(() => {
  requestState.cookies = new Map();
  requestState.headers = new Headers();
});

describe('getLocale', () => {
  it('prefers the aivore_locale cookie', async () => {
    requestState.cookies.set('aivore_locale', 'en');
    requestState.headers = new Headers({ 'accept-language': 'ar' });
    expect(await getLocale()).toBe('en');
  });

  it('falls back to Accept-Language, then to Arabic', async () => {
    requestState.headers = new Headers({ 'accept-language': 'en-US,en;q=0.9' });
    expect(await getLocale()).toBe('en');
    requestState.headers = new Headers({ 'accept-language': 'fr-FR' });
    expect(await getLocale()).toBe('ar');
    requestState.headers = new Headers();
    expect(await getLocale()).toBe('ar');
  });

  it('ignores an unsupported cookie value', async () => {
    requestState.cookies.set('aivore_locale', 'xx');
    requestState.headers = new Headers({ 'accept-language': 'en' });
    expect(await getLocale()).toBe('en');
  });
});

describe('getI18n', () => {
  it('returns locale, dir and bound translation functions', async () => {
    requestState.cookies.set('aivore_locale', 'ar');
    const { locale, dir, t, plural } = await getI18n();
    expect(locale).toBe('ar');
    expect(dir).toBe('rtl');
    expect(t('common.nav.gallery')).toBe('معرضي');
    expect(plural(2, { two: 'اثنان', other: 'x' })).toBe('اثنان');
  });

  it('is left-to-right for English', async () => {
    requestState.cookies.set('aivore_locale', 'en');
    const { dir, t } = await getI18n();
    expect(dir).toBe('ltr');
    expect(t('common.nav.gallery')).toBe('Gallery');
  });
});
