import { isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  acceptLanguage: null as string | null,
  getAppUser: vi.fn(),
  getOptionalUser: vi.fn(),
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
vi.mock('@/lib/auth-guard', () => ({
  getAppUser: mocks.getAppUser,
  getOptionalUser: mocks.getOptionalUser,
}));
// Client islands are covered by their own tests; here only the server composition matters.
vi.mock('@/components/layout/locale-switcher', () => ({
  LocaleSwitcher: () => <i data-island="locale" />,
}));
vi.mock('@/components/layout/theme-toggle', () => ({
  ThemeToggle: () => <i data-island="theme" />,
}));
vi.mock('@/components/layout/site-header', () => ({
  SiteHeader: () => <header data-island="header" />,
}));
vi.mock('@/components/ui/toast', () => ({ Toaster: () => <i data-island="toaster" /> }));

import AppLayout from '@/app/(app)/layout';
import AuthLayout from '@/app/(auth)/layout';
import MarketingLayout from '@/app/(marketing)/layout';
import { AppShell } from '@/components/layout/app-shell';
import { RedirectToLogin } from '@/components/layout/redirect-to-login';
import { SiteChrome } from '@/components/layout/site-chrome';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { UserProvider } from '@/lib/user-context';

const LAYLA = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user' as const,
  locale: 'en' as const,
  creditBalance: 50,
};

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
  mocks.getAppUser.mockReset();
  mocks.getOptionalUser.mockReset();
});

function elementOf(node: unknown): ReactElement<Record<string, unknown>> {
  if (!isValidElement(node)) throw new Error('expected a React element');
  return node as ReactElement<Record<string, unknown>>;
}

describe('(app) layout', () => {
  it('renders the shell for a signed-in user, with the sidebar state from the cookie', async () => {
    mocks.getAppUser.mockResolvedValue(LAYLA);
    mocks.cookies.set('aivore_sidebar', 'collapsed');
    const shell = elementOf(await AppLayout({ children: <p>page</p> }));
    expect(shell.type).toBe(AppShell);
    expect(shell.props.initialUser).toEqual(LAYLA);
    expect(shell.props.defaultCollapsed).toBe(true);
  });

  it('is expanded by default', async () => {
    mocks.getAppUser.mockResolvedValue(LAYLA);
    expect(elementOf(await AppLayout({ children: null })).props.defaultCollapsed).toBe(false);
  });

  it('never renders the page for a visitor: a login redirect inside the one <main> instead', async () => {
    mocks.getAppUser.mockResolvedValue(null);
    const page = <p>secret page</p>;
    const fallback = elementOf(await AppLayout({ children: page }));
    expect(fallback.type).toBe('main');
    expect(fallback.props.id).toBe('main-content');
    expect(elementOf(fallback.props.children).type).toBe(RedirectToLogin);
    expect(JSON.stringify(fallback)).not.toContain('secret page');
  });
});

describe('(marketing) layout and SiteChrome', () => {
  it('wraps the page in the public chrome', () => {
    const chrome = elementOf(MarketingLayout({ children: <p>landing</p> }));
    expect(chrome.type).toBe(SiteChrome);
  });

  it('SiteChrome gives client components the server-resolved user', async () => {
    mocks.getOptionalUser.mockResolvedValue(LAYLA);
    const provider = elementOf(await SiteChrome({ children: <p>page</p> }));
    expect(provider.type).toBe(UserProvider);
    expect(provider.props.initialUser).toEqual(LAYLA);
  });

  it('SiteChrome puts the header, then the page, then the footer, and leaves <main> to the page', async () => {
    mocks.getOptionalUser.mockResolvedValue(null);
    const page = <main id="main-content">landing</main>;
    const provider = elementOf(await SiteChrome({ children: page }));
    const [frame, toaster] = provider.props.children as ReactElement[];
    expect(elementOf(toaster).type).toBeTypeOf('function');
    const [header, body, footer] = elementOf(frame).props.children as ReactElement<
      Record<string, unknown>
    >[];
    expect(elementOf(header).type).toBe(SiteHeader);
    expect(elementOf(body).props.children).toBe(page);
    expect(elementOf(footer).type).toBe(SiteFooter);
    expect(elementOf(footer).props.signedIn).toBe(false);
  });

  it('tells the footer when somebody is signed in', async () => {
    mocks.getOptionalUser.mockResolvedValue(LAYLA);
    const provider = elementOf(await SiteChrome({ children: null }));
    const [frame] = provider.props.children as ReactElement[];
    const footer = (elementOf(frame).props.children as ReactElement<Record<string, unknown>>[])[2];
    expect(elementOf(footer).props.signedIn).toBe(true);
  });
});

describe('(auth) layout', () => {
  async function render() {
    return renderToStaticMarkup(await AuthLayout({ children: <form>login form</form> }));
  }

  it('renders the page card inside exactly one <main id="main-content">', async () => {
    const html = await render();
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toMatch(/<main id="main-content"[^>]*>.*login form.*<\/main>/s);
  });

  it('has the brand link, the switchers and the toast region', async () => {
    mocks.acceptLanguage = 'en';
    const html = await render();
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-label="AIVORE home"');
    expect(html).toContain('data-island="locale"');
    expect(html).toContain('data-island="theme"');
    expect(html).toContain('data-island="toaster"');
  });

  it('is not indexed', async () => {
    const { metadata } = await import('@/app/(auth)/layout');
    expect(metadata.robots).toEqual({ index: false });
  });
});

describe('SiteFooter', () => {
  it('offers the product links and, to a visitor, the log in and sign up links', async () => {
    mocks.acceptLanguage = 'en';
    const html = renderToStaticMarkup(await SiteFooter({}));
    for (const href of ['/studio', '/explore', '/docs', '/login', '/register']) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).not.toContain('href="/gallery"');
    expect(html).toContain('Turn a sentence into images and video, in Arabic or English.');
    expect(html).toContain(`© ${new Date().getUTCFullYear()} AIVORE. All rights reserved.`);
  });

  it('offers the account links to a signed-in user instead', async () => {
    mocks.acceptLanguage = 'en';
    const html = renderToStaticMarkup(await SiteFooter({ signedIn: true }));
    expect(html).toContain('href="/gallery"');
    expect(html).toContain('href="/account"');
    expect(html).not.toContain('href="/login"');
  });

  it('is written in Arabic with Arabic-Indic digits for the year', async () => {
    mocks.cookies.set('aivore_locale', 'ar');
    const html = renderToStaticMarkup(await SiteFooter({}));
    expect(html).toContain('حوّل جملة واحدة إلى صور وفيديوهات');
    expect(html).toContain('جميع الحقوق محفوظة');
    expect(html).toMatch(/٢٠[٠-٩]{2}/);
    expect(html).toContain('aria-label="المنتج"');
  });
});
