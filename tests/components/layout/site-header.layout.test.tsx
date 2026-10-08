import type { Browser } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SiteHeader } from '@/components/layout/site-header';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { chromiumPath, launchBrowser, openPage } from '../browser';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => '/',
}));

const LAYLA: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla Hassan',
  role: 'user',
  locale: 'en',
  creditBalance: 50,
};

const LG = 1024;
// Every 20px from a small phone to a desktop, plus both sides of each breakpoint.
const WIDTHS = [
  ...new Set([
    ...Array.from({ length: 40 }, (_, step) => 320 + step * 20),
    639,
    640,
    767,
    768,
    859,
    860,
    LG - 1,
    LG,
    1100,
  ]),
].sort((a, b) => a - b);

function headerMarkup(locale: Locale, user: CurrentUser | null): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={user}>
        <SiteHeader />
      </UserProvider>
    </I18nProvider>,
  );
}

/**
 * Everything wrong with the header at the current viewport width (empty when it is fine). It runs
 * inside the page, so it must not use anything from this module.
 */
function inspectHeader([width, large]: readonly [number, number]): string[] {
  const problems: string[] = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth)
    problems.push(`the page scrolls sideways by ${root.scrollWidth - root.clientWidth}px`);
  const header = document.querySelector('header');
  if (!header) return ['no header'];
  for (const element of header.querySelectorAll<HTMLElement>('a, button')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue; // not displayed at this width
    const name = element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '?';
    if (rect.left < -0.5 || rect.right > root.clientWidth + 0.5)
      problems.push(`"${name}" is cut off (${Math.round(rect.left)}..${Math.round(rect.right)})`);
    if (getComputedStyle(element).display === 'inline') continue;
    if (element.scrollHeight > element.clientHeight + 1)
      problems.push(`"${name}" wraps onto more lines than its box holds`);
    if (element.scrollWidth > element.clientWidth + 1) problems.push(`"${name}" overflows its box`);
  }
  const shown = (selector: string) => {
    const target = header.querySelector(selector);
    return target !== null && target.getBoundingClientRect().width > 0;
  };
  const wide = width >= large;
  if (shown('nav') !== wide)
    problems.push(`the inline navigation is ${wide ? 'missing' : 'shown'}`);
  if (shown('button[aria-haspopup="dialog"]') === wide)
    problems.push(`the menu button is ${wide ? 'shown' : 'missing'}`);
  return problems;
}

describe.skipIf(chromiumPath() === undefined)('SiteHeader in a real browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const cases: Array<[string, Locale, CurrentUser | null]> = [
    ['a visitor, Arabic', 'ar', null],
    ['a visitor, English', 'en', null],
    ['a signed-in user, Arabic', 'ar', { ...LAYLA, locale: 'ar' }],
    ['a signed-in user, English', 'en', LAYLA],
  ];

  it.each(cases)(
    'fits every width from 320 to 1100px without clipping or sideways scrolling: %s',
    async (_name, locale, user) => {
      const page = await openPage(browser, headerMarkup(locale, user), { locale, width: 320 });
      const failures: Record<number, string[]> = {};
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const problems = await page.evaluate(inspectHeader, [width, LG] as const);
        if (problems.length > 0) failures[width] = problems;
      }
      await page.context().close();
      expect(failures).toEqual({});
    },
    120_000,
  );
});
