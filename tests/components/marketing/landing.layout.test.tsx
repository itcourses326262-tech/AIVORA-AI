import type { Browser, Page } from '@playwright/test';
import sharp from 'sharp';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { Showcase } from '@/components/marketing/showcase';
import { createTranslator, type Locale } from '@/lib/i18n';
import { chromiumPath, launchBrowser, openPage } from '../browser';

const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number) =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

function render(locale: Locale, node: 'how' | 'showcase' | 'hero'): string {
  const i18n = createTranslator(locale);
  return renderToStaticMarkup(
    <main>
      {node === 'how' ? <HowItWorks i18n={i18n} /> : null}
      {node === 'showcase' ? <Showcase i18n={i18n} /> : null}
      {node === 'hero' ? <Hero i18n={i18n} bonus={50} /> : null}
    </main>,
  );
}

/**
 * White caption text over the artwork, worst case: the 5th percentile of the contrast between
 * white and the pixels behind each caption (the text itself is hidden, its scrim stays).
 */
async function captionContrasts(page: Page): Promise<number[]> {
  const count = await page.locator('figure').count();
  const results: number[] = [];
  for (let index = 0; index < count; index++) {
    const figure = page.locator('figure').nth(index);
    await figure.scrollIntoViewIfNeeded();
    const caption = figure.locator('figcaption p');
    await caption.evaluate((element) => {
      element.style.visibility = 'hidden';
    });
    const box = await caption.boundingBox();
    if (!box) throw new Error('caption has no box');
    const shot = await page.screenshot({ clip: box });
    const { data, info } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const ratios: number[] = [];
    for (let i = 0; i < data.length; i += info.channels) {
      ratios.push(1.05 / (luminance(data[i]!, data[i + 1]!, data[i + 2]!) + 0.05));
    }
    ratios.sort((a, b) => a - b);
    results.push(ratios[Math.floor(ratios.length * 0.05)]!);
  }
  return results;
}

describe.skipIf(chromiumPath() === undefined)('landing sections in a real browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  it.each(['ar', 'en'] as const)(
    'lines the three steps up on one row, whatever their text length: %s',
    async (locale) => {
      const page = await openPage(browser, render(locale, 'how'), { locale, width: 1280 });
      const tops = await page
        .locator('ol h3')
        .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
      await page.context().close();
      expect(tops).toHaveLength(3);
      expect(new Set(tops).size).toBe(1);
    },
    60_000,
  );

  it.each([
    ['ar', 360, true],
    ['en', 360, true],
    ['ar', 1280, false],
  ] as const)(
    'fades the edges of the jump links only where they scroll sideways: %s at %ipx',
    async (locale, width, fades) => {
      const page = await openPage(browser, render(locale, 'hero'), {
        locale,
        width,
        touch: width < 800,
      });
      const mask = await page
        .locator('nav ul')
        .evaluate((element) => getComputedStyle(element).maskImage);
      await page.context().close();
      expect(mask !== 'none').toBe(fades);
    },
    60_000,
  );

  it.each([
    ['ar', 360],
    ['en', 360],
    ['ar', 1280],
    ['en', 1280],
  ] as const)(
    'never cuts a sample badge short and keeps the captions readable: %s at %ipx',
    async (locale, width) => {
      const page = await openPage(browser, render(locale, 'showcase'), {
        locale,
        width,
        touch: width < 800,
      });
      const clipped = await page
        .locator('figure .truncate')
        .evaluateAll((nodes) =>
          nodes
            .filter((node) => node.scrollWidth > node.clientWidth + 1)
            .map((node) => node.textContent),
        );
      const contrasts = await captionContrasts(page);
      await page.context().close();
      expect(clipped).toEqual([]);
      expect(contrasts).toHaveLength(7);
      // 4.5:1 is the AA ratio for text this size.
      for (const ratio of contrasts) expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
    120_000,
  );
});
