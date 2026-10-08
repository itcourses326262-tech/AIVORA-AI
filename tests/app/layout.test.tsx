import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import RootLayout, { generateMetadata, viewport } from '@/app/layout';
import { THEME_COLORS } from '@/lib/theme';
import { resetEnvForTests } from '@/server/env';

async function renderLayout(child = <main id="main-content">content</main>) {
  return renderToStaticMarkup(await RootLayout({ children: child }));
}

beforeEach(() => {
  mocks.cookies.clear();
  mocks.acceptLanguage = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('RootLayout', () => {
  it('is Arabic, right-to-left and dark by default', async () => {
    const html = await renderLayout();
    expect(html).toMatch(/^<html lang="ar" dir="rtl" data-theme="dark"[ >]/);
  });

  it('declares smooth scrolling as intended, so Next stops warning about globals.css', async () => {
    expect(await renderLayout()).toMatch(/^<html [^>]*data-scroll-behavior="smooth"/);
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

  it('declares a theme color per color scheme, equal to that scheme background token', () => {
    expect(viewport.themeColor).toEqual([
      { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
      { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
    ]);
    // The light chrome colour used to be pure white, a shade off every light surface.
    expect(THEME_COLORS.light).toBe('#f6f6fb');
  });

  it('sets metadataBase from APP_URL, so relative metadata URLs become absolute', async () => {
    vi.stubEnv('APP_URL', 'https://aivore.example.com/');
    resetEnvForTests();
    const { metadataBase } = await generateMetadata();
    expect(String(metadataBase)).toBe('https://aivore.example.com/');
  });

  it('falls back to the default APP_URL origin in development', async () => {
    vi.stubEnv('APP_URL', '');
    resetEnvForTests();
    expect(String((await generateMetadata()).metadataBase)).toBe('http://localhost:3000/');
  });
});
