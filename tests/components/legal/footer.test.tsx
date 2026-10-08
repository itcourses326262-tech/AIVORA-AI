import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  acceptLanguage: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () =>
    new Headers(mocks.acceptLanguage ? { 'accept-language': mocks.acceptLanguage } : {}),
}));
// The switchers are client islands with their own tests.
vi.mock('@/components/layout/locale-switcher', () => ({ LocaleSwitcher: () => <i /> }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => <i /> }));

import { SiteFooter } from '@/components/layout/site-footer';
import { LEGAL_PATHS, LEGAL_SLUGS } from '@/lib/legal';

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
});

function legalNav(html: string): string {
  const start = html.indexOf('<nav aria-label="Legal"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</nav>', start));
}

describe('SiteFooter legal links', () => {
  it('links all four documents, for a visitor and for a signed-in user alike', async () => {
    mocks.acceptLanguage = 'en';
    for (const signedIn of [false, true]) {
      const nav = legalNav(renderToStaticMarkup(await SiteFooter({ signedIn })));
      for (const slug of LEGAL_SLUGS) expect(nav).toContain(`href="${LEGAL_PATHS[slug]}"`);
      expect(nav.match(/<a /g)).toHaveLength(4);
    }
  });

  it('names them in English', async () => {
    mocks.acceptLanguage = 'en';
    const nav = legalNav(renderToStaticMarkup(await SiteFooter({})));
    for (const label of [
      'Terms of Service',
      'Privacy Policy',
      'Refund Policy',
      'Acceptable Use Policy',
    ]) {
      expect(nav).toContain(`>${label}</a>`);
    }
  });

  it('names them in Arabic, under a heading of their own', async () => {
    mocks.cookies.set('aivore_locale', 'ar');
    const html = renderToStaticMarkup(await SiteFooter({}));
    const start = html.indexOf('<nav aria-label="الشروط والسياسات"');
    expect(start).toBeGreaterThan(-1);
    const nav = html.slice(start, html.indexOf('</nav>', start));
    expect(nav).toContain('<h2');
    for (const label of [
      'شروط الخدمة',
      'سياسة الخصوصية',
      'سياسة الاسترداد',
      'سياسة الاستخدام المقبول',
    ]) {
      expect(nav).toContain(`>${label}</a>`);
    }
  });

  it('keeps the product and account columns it had', async () => {
    mocks.acceptLanguage = 'en';
    const html = renderToStaticMarkup(await SiteFooter({}));
    for (const href of ['/studio', '/explore', '/docs', '/login', '/register']) {
      expect(html).toContain(`href="${href}"`);
    }
  });
});
