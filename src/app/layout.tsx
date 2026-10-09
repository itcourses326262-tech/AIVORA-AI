import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n/client';
import { getI18n } from '@/lib/i18n/server';
import { metadataBaseFor } from '@/lib/site-url';
import { THEME_COLORS } from '@/lib/theme';
import { getTheme } from '@/lib/theme-server';
import { getEnv } from '@/server/env';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  const name = t('common.app.name');
  return {
    // Makes every relative metadata URL (Open Graph images, canonical links) absolute.
    metadataBase: metadataBaseFor(getEnv().APP_URL),
    title: { default: name, template: `%s · ${name}` },
    description: t('common.app.tagline'),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.dark },
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
  ],
};

/**
 * Root shell: `<html lang dir data-theme>` come from the request's cookies (locale, then
 * Accept-Language, then Arabic; theme defaults to dark), so the first byte is already correct and
 * no script is needed. Every page or layout below must render exactly one `<main id="main-content">`:
 * it is the target of the skip link.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const [{ locale, dir, t }, theme] = await Promise.all([getI18n(), getTheme()]);
  return (
    // `data-scroll-behavior` tells Next the smooth scrolling of globals.css is intended: it then
    // disables it for the instant of a route change instead of warning about it.
    <html
      lang={locale}
      dir={dir}
      data-theme={theme}
      data-scroll-behavior="smooth"
      // Browser extensions (translators, dictionaries) add attributes to <html> before React runs;
      // this silences only the attribute mismatch on this one element, not on its children.
      suppressHydrationWarning
    >
      <body className="min-h-dvh antialiased">
        <a
          href="#main-content"
          className="sr-only rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50"
        >
          {t('common.a11y.skipToContent')}
        </a>
        <I18nProvider locale={locale}>{children}</I18nProvider>
      </body>
    </html>
  );
}
