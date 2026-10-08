import type { Browser } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'aivore_locale' ? { name, value: mocks.locale } : undefined),
  }),
  headers: async () => new Headers(),
}));

import { LegalDocument } from '@/components/legal/legal-document';
import { LEGAL_SLUGS, type LegalSlug } from '@/lib/legal';
import { axeViolationsInPage, chromiumPath, launchBrowser, openPage } from '../browser';

type Locale = 'ar' | 'en';

/** The page as the site renders it: its own <main>, with the site's header and footer around it. */
async function documentMarkup(slug: LegalSlug, locale: Locale): Promise<string> {
  mocks.locale = locale;
  const page = renderToStaticMarkup(await LegalDocument({ slug }));
  return `<header>Site header</header>${page}<footer>Site footer</footer>`;
}

describe.skipIf(chromiumPath() === undefined)('legal pages in a real browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each(
    (['ar', 'en'] as const).flatMap((locale) =>
      ([320, 390, 768, 1024, 1440] as const).flatMap((width) =>
        (['terms', 'privacy'] as const).map((slug) => [locale, width, slug] as const),
      ),
    ),
  )(
    'never scrolls sideways: %s at %ipx, %s',
    async (locale, width, slug) => {
      const page = await openPage(browser, await documentMarkup(slug, locale), {
        locale,
        width,
        touch: width < 800,
      });
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        wide: [...document.querySelectorAll('main *')]
          .filter((node) => node.getBoundingClientRect().right > window.innerWidth + 1)
          .filter((node) => node.getBoundingClientRect().left >= 0)
          .map((node) => node.tagName.toLowerCase()),
      }));
      await page.context().close();
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.wide).toEqual([]);
    },
    60_000,
  );

  it.each([
    [390, false],
    [768, false],
    [1024, true],
    [1440, true],
  ] as const)(
    'shows the sticky contents beside the text from 1024px and the folded one below it: %ipx',
    async (width, beside) => {
      const page = await openPage(browser, await documentMarkup('terms', 'en'), {
        locale: 'en',
        width,
      });
      const nav = page.getByRole('navigation', { name: 'On this page' });
      const details = page.locator('details');
      expect(await nav.isVisible()).toBe(beside);
      expect(await details.isVisible()).toBe(!beside);
      if (!beside) {
        // Folded: the links stay out of view until the summary is opened.
        expect(await details.locator('a').first().isVisible()).toBe(false);
        await details.locator('summary').click();
        expect(await details.locator('a').first().isVisible()).toBe(true);
      }
      await page.context().close();
    },
    60_000,
  );

  it('keeps the contents in view while the text scrolls past it', async () => {
    const page = await openPage(browser, await documentMarkup('terms', 'en'), {
      locale: 'en',
      width: 1440,
      height: 900,
    });
    const nav = page.getByRole('navigation', { name: 'On this page' });
    expect(await nav.evaluate((element) => getComputedStyle(element).position)).toBe('sticky');
    await page.evaluate(() => window.scrollTo({ top: 1800, behavior: 'instant' }));
    const box = await nav.boundingBox();
    await page.context().close();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThan(200);
  }, 60_000);

  it.each([
    ['en', true],
    ['ar', false],
  ] as const)(
    'puts the contents at the start of the line, whichever side that is: %s',
    async (locale, onTheLeft) => {
      const page = await openPage(browser, await documentMarkup('terms', locale), {
        locale,
        width: 1440,
      });
      const [toc, article] = await Promise.all([
        page.locator('main nav').first().boundingBox(),
        page.locator('article').boundingBox(),
      ]);
      await page.context().close();
      expect(toc).not.toBeNull();
      expect(article).not.toBeNull();
      expect(toc!.x < article!.x).toBe(onTheLeft);
    },
    60_000,
  );

  it.each(['en', 'ar'] as const)(
    'keeps the lines of text readable: no wider than about 70 characters (%s)',
    async (locale) => {
      const page = await openPage(browser, await documentMarkup('privacy', locale), {
        locale,
        width: 1440,
      });
      const widest = await page.evaluate(() =>
        Math.max(
          ...[...document.querySelectorAll('article p')].map(
            (p) => p.getBoundingClientRect().width,
          ),
        ),
      );
      await page.context().close();
      expect(widest).toBeLessThanOrEqual(768);
      expect(widest).toBeGreaterThan(300);
    },
    60_000,
  );

  it('leaves room under the sticky site header when a contents link jumps to a section', async () => {
    const page = await openPage(browser, await documentMarkup('terms', 'en'), {
      locale: 'en',
      width: 1440,
    });
    const margin = await page
      .locator('section#plans')
      .evaluate((element) => getComputedStyle(element).scrollMarginTop);
    await page.context().close();
    expect(margin).toBe('96px');
  }, 60_000);

  it('has no accessibility violations, colour contrast included, in any document, language or theme', async () => {
    const problems: string[] = [];
    for (const locale of ['ar', 'en'] as const) {
      for (const theme of ['dark', 'light'] as const) {
        for (const slug of LEGAL_SLUGS) {
          for (const width of [390, 1440]) {
            const page = await openPage(browser, await documentMarkup(slug, locale), {
              locale,
              theme,
              width,
              touch: width < 800,
            });
            for (const violation of await axeViolationsInPage(page)) {
              problems.push(`${slug} ${locale} ${theme} ${width}: ${violation}`);
            }
            await page.context().close();
          }
        }
      }
    }
    expect(problems).toEqual([]);
  }, 240_000);

  it.each(['en', 'ar'] as const)(
    'prints as a plain document: no site header, footer or contents, dark text on white, the draft notice kept (%s)',
    async (locale) => {
      const page = await openPage(browser, await documentMarkup('refunds', locale), {
        locale,
        theme: 'dark',
        width: 1000,
      });
      await page.emulateMedia({ media: 'print' });
      const printed = await page.evaluate(() => {
        const display = (selector: string) =>
          getComputedStyle(document.querySelector(selector) as Element).display;
        return {
          header: display('header'),
          footer: display('footer'),
          toc: display('main nav'),
          details: display('details'),
          draft: display('[data-legal-draft]'),
          heading: getComputedStyle(document.querySelector('h1') as Element).color,
          background: getComputedStyle(document.body).backgroundColor,
          body: getComputedStyle(document.querySelector('article p') as Element).color,
        };
      });
      await page.context().close();
      expect(printed.header).toBe('none');
      expect(printed.footer).toBe('none');
      expect(printed.toc).toBe('none');
      expect(printed.details).toBe('none');
      expect(printed.draft).not.toBe('none');
      expect(printed.heading).toBe('rgb(17, 17, 17)');
      expect(printed.body).toBe('rgb(17, 17, 17)');
      expect(printed.background).toBe('rgb(255, 255, 255)');
    },
    60_000,
  );

  it('keeps the screen look on screen: the print rules do not apply there', async () => {
    const page = await openPage(browser, await documentMarkup('refunds', 'en'), {
      locale: 'en',
      theme: 'dark',
      width: 1440,
    });
    const screen = await page.evaluate(() => ({
      header: getComputedStyle(document.querySelector('header') as Element).display,
      heading: getComputedStyle(document.querySelector('h1') as Element).color,
    }));
    await page.context().close();
    expect(screen.header).not.toBe('none');
    expect(screen.heading).not.toBe('rgb(17, 17, 17)');
  }, 60_000);

  it('wraps a long placeholder across lines without breaking the box around it', async () => {
    const page = await openPage(browser, await documentMarkup('terms', 'en'), {
      locale: 'en',
      width: 320,
      touch: true,
    });
    const marks = await page.locator('mark[data-placeholder]').evaluateAll((nodes) =>
      nodes.map((node) => ({
        clone: getComputedStyle(node).boxDecorationBreak,
        right: node.getBoundingClientRect().right,
      })),
    );
    await page.context().close();
    expect(marks.length).toBeGreaterThan(3);
    for (const mark of marks) {
      expect(mark.clone).toBe('clone');
      expect(mark.right).toBeLessThanOrEqual(320);
    }
  }, 60_000);
});
