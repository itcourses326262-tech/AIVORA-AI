import { createRoot } from 'react-dom/client';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  router: { refresh: vi.fn(), replace: vi.fn() },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = mocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => mocks.router,
  usePathname: () => '/nowhere',
}));
// The switchers are covered by their own tests; here only the page composition matters.
vi.mock('@/components/layout/locale-switcher', () => ({
  LocaleSwitcher: () => <i data-island="locale" />,
}));
vi.mock('@/components/layout/theme-toggle', () => ({
  ThemeToggle: () => <i data-island="theme" />,
}));

import ErrorPage from '@/app/error';
import GlobalError from '@/app/global-error';
import NotFound, { generateMetadata } from '@/app/not-found';
import { ApiError } from '@/lib/api-client';
import { renderUi } from '../render';

beforeEach(() => {
  mocks.cookies.clear();
});

describe('not-found page', () => {
  it('says the page is out of frame and offers three ways on, in English', async () => {
    mocks.cookies.set('aivore_locale', 'en');
    const html = renderToStaticMarkup(await NotFound());
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html).toContain('<main id="main-content"');
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('This page is out of frame');
    expect(html).toContain('Error 404');
    expect(html).toMatch(/<a [^>]*href="\/"[^>]*>Back to home/);
    expect(html).toMatch(/<a [^>]*href="\/studio"[^>]*>Open the studio/);
    expect(html).toMatch(/<a [^>]*href="\/explore"[^>]*>Explore creations/);
    expect(html).toContain('aria-label="AIVORE home"');
  });

  it('is the same page in Arabic, with the arrow turned around', async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('هذه الصفحة خارج الإطار');
    expect(html).toContain('العودة إلى الرئيسية');
    expect(html).toContain('rtl:-scale-x-100');
    expect(html).not.toContain('Back to home');
  });

  it('keeps its brand frame and switchers without needing the site chrome', async () => {
    const html = renderToStaticMarkup(await NotFound());
    expect(html).toContain('data-island="locale"');
    expect(html).toContain('data-island="theme"');
  });

  it('titles the tab and keeps the page out of search results', async () => {
    mocks.cookies.set('aivore_locale', 'en');
    expect(await generateMetadata()).toEqual({
      title: 'This page is out of frame',
      robots: { index: false },
    });
  });
});

describe('error page', () => {
  const failure = (digest?: string) => Object.assign(new Error('secret server detail'), { digest });

  it('apologises, offers a retry that calls reset and a way home, and never shows the message', () => {
    const reset = vi.fn();
    renderUi(<ErrorPage error={failure('abc123')} reset={reset} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Something went wrong on our side' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/secret server detail/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('gives support something to quote when Next provides a digest, and nothing otherwise', () => {
    const { unmount } = renderUi(<ErrorPage error={failure('abc123')} reset={() => {}} />);
    expect(screen.getByText('Reference: abc123')).toBeInTheDocument();
    unmount();
    renderUi(<ErrorPage error={failure()} reset={() => {}} />);
    expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument();
  });

  it('moves focus to the heading so assistive technology announces the failure', () => {
    renderUi(<ErrorPage error={failure()} reset={() => {}} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  it('says what went wrong when the failure has a code the visitor can act on', () => {
    renderUi(
      <ErrorPage error={new ApiError('network_error', 0, 'offline') as never} reset={() => {}} />,
    );
    expect(
      screen.getByText("We can't reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
  });

  it('is Arabic when the page is', () => {
    renderUi(<ErrorPage error={failure('d1')} reset={() => {}} />, { locale: 'ar' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'حدث خطأ من جانبنا' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حاول مرة أخرى' })).toBeInTheDocument();
    expect(screen.getByText('المرجع: d1')).toBeInTheDocument();
  });
});

describe('global error page', () => {
  const failure = Object.assign(new Error('boom'), { digest: '99' });

  it('renders its own html, in Arabic and dark by default (what the server can know)', () => {
    const html = renderToStaticMarkup(<GlobalError error={failure} />);
    expect(html).toMatch(/^<html lang="ar" dir="rtl" data-theme="dark">/);
    expect(html).toContain('واجهت AIVORE مشكلة مؤقتة');
    expect(html).toContain('إعادة تحميل الصفحة');
    expect(html).toContain('المرجع: 99');
  });

  it('is self-contained: its own stylesheet and the system font, no providers', () => {
    const html = renderToStaticMarkup(<GlobalError error={failure} />);
    expect(html).toContain('<style>');
    expect(html).toContain('system-ui');
    expect(html).not.toContain('Inter Variable');
    expect(html.match(/<main /g)).toHaveLength(1);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
  });

  describe('in the browser', () => {
    const originalCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    let cookie = '';
    let languages: string[] = ['en-US'];
    let root: ReturnType<typeof createRoot> | undefined;

    beforeEach(() => {
      cookie = '';
      languages = ['en-US'];
      Object.defineProperty(document, 'cookie', { get: () => cookie, configurable: true });
      vi.spyOn(navigator, 'languages', 'get').mockImplementation(() => languages);
    });

    afterEach(() => {
      act(() => root?.unmount());
      root = undefined;
      delete (document as { cookie?: string }).cookie;
      if (originalCookie) Object.defineProperty(Document.prototype, 'cookie', originalCookie);
    });

    function mount() {
      act(() => {
        root = createRoot(document);
        root.render(<GlobalError error={failure} />);
      });
    }

    it('takes the language from the locale cookie, then from the browser, then Arabic', () => {
      cookie = 'aivore_locale=ar';
      mount();
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.dir).toBe('rtl');
      act(() => root?.unmount());

      cookie = '';
      languages = ['en-GB', 'en'];
      mount();
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.title).toBe('AIVORE hit a snag');
      expect(screen.getByRole('button', { name: 'Reload the page' })).toBeInTheDocument();
    });

    it('follows the theme cookie', () => {
      cookie = 'aivore_locale=en; aivore_theme=light';
      mount();
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('offers one action, a reload: nothing smaller can recover from a failing root layout', () => {
      mount();
      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAttribute('type', 'button');
      expect(buttons[0]).toHaveTextContent('Reload the page');
    });
  });
});
