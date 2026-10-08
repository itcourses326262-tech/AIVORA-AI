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

import HomePage from '@/app/(marketing)/page';
import RootLayout, { generateMetadata, viewport } from '@/app/layout';

async function renderLayout(child = <main id="main-content">content</main>) {
  return renderToStaticMarkup(await RootLayout({ children: child }));
}

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
});

describe('RootLayout', () => {
  it('is Arabic, right-to-left and dark by default', async () => {
    const html = await renderLayout();
    expect(html).toMatch(/^<html lang="ar" dir="rtl" data-theme="dark">/);
  });

  it('follows Accept-Language when there is no locale cookie', async () => {
    mocks.acceptLanguage = 'en-US,en;q=0.9';
    expect(await renderLayout()).toMatch(/^<html lang="en" dir="ltr"/);
  });

  it('prefers the locale cookie over Accept-Language', async () => {
    mocks.acceptLanguage = 'en-US';
    mocks.cookies.set('aivore_locale', 'ar');
    expect(await renderLayout()).toMatch(/^<html lang="ar" dir="rtl"/);
  });

  it.each(['light', 'system'])(
    'renders the %s theme from the aivore_theme cookie',
    async (theme) => {
      mocks.cookies.set('aivore_theme', theme);
      expect(await renderLayout()).toContain(`data-theme="${theme}"`);
    },
  );

  it('falls back to dark for an unknown theme cookie', async () => {
    mocks.cookies.set('aivore_theme', 'solarized');
    expect(await renderLayout()).toContain('data-theme="dark"');
  });

  it('puts a localized skip link to #main-content before the page content', async () => {
    const arabic = await renderLayout();
    expect(arabic).toMatch(/<a href="#main-content"[^>]*>تخطَّ إلى المحتوى الرئيسي<\/a>/);
    expect(arabic.indexOf('href="#main-content"')).toBeLessThan(arabic.indexOf('<main'));

    mocks.acceptLanguage = 'en';
    expect(await renderLayout()).toMatch(/<a href="#main-content"[^>]*>Skip to main content<\/a>/);
  });

  it('renders its children inside the body', async () => {
    expect(await renderLayout(<main id="main-content">hello</main>)).toContain(
      '<main id="main-content">hello</main>',
    );
  });

  it('ships no inline script (the theme is rendered by the server)', async () => {
    expect(await renderLayout()).not.toContain('<script');
  });
});

describe('metadata', () => {
  it('localizes the title and description', async () => {
    const arabic = await generateMetadata();
    expect(arabic.description).toContain('الذكاء الاصطناعي');
    expect(arabic.title).toMatchObject({ default: 'AIVORE', template: '%s · AIVORE' });

    mocks.acceptLanguage = 'en';
    expect((await generateMetadata()).description).toBe(
      'Create stunning images and videos with AI',
    );
  });

  it('declares a theme color per color scheme', () => {
    expect(viewport.themeColor).toHaveLength(2);
  });
});

describe('placeholder home page', () => {
  it('shows the AIVORE name and the tagline in the active locale inside <main id="main-content">', async () => {
    const arabic = renderToStaticMarkup(await HomePage());
    expect(arabic).toContain('<main id="main-content"');
    expect(arabic).toContain('<h1 class="text-5xl font-bold">AIVORE</h1>');
    expect(arabic).toContain('أنشئ صورًا وفيديوهات مذهلة بالذكاء الاصطناعي');

    mocks.acceptLanguage = 'en';
    const english = renderToStaticMarkup(await HomePage());
    expect(english).toContain('Create stunning images and videos with AI');
  });
});
