import type { Browser } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from '@/components/layout/site-header';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { axeViolationsInPage, chromiumPath, launchBrowser, openPage } from '../browser';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/',
}));

const USER: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla Hassan',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

function headerMarkup(locale: Locale): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={USER}>
        <SiteHeader />
      </UserProvider>
    </I18nProvider>,
  );
}

describe.skipIf(chromiumPath() === undefined)(
  'the signed-in header, checked by axe in a real browser',
  () => {
    let browser: Browser;

    beforeAll(async () => {
      browser = await launchBrowser();
    }, 60_000);

    afterAll(async () => {
      await browser?.close();
    });

    it.each([
      ['ar', 'dark', 1280],
      ['ar', 'light', 360],
      ['en', 'dark', 360],
      ['en', 'light', 1280],
    ] as const)(
      'has no accessibility violations (%s, %s, %ipx), the account button included',
      async (locale, theme, width) => {
        const page = await openPage(browser, headerMarkup(locale), { locale, theme, width });
        const violations = await axeViolationsInPage(page);
        await page.context().close();
        expect(violations).toEqual([]);
      },
      60_000,
    );
  },
);
