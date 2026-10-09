import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { createDemoImage, createDemoVideo, seedGallery } from './fixtures/api';
import { setPreferences, type Locale } from './fixtures/preferences';
import { settlePage } from './fixtures/studio';
import { en } from './fixtures/i18n';

// A phone: 390 x 844 CSS pixels, touch, mobile viewport handling.
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});

const LOCALES: readonly Locale[] = ['en', 'ar'];

/** What sticks out past the right or left edge of the viewport, and is not inside a scroller of its own. */
async function overflowReport(
  page: Page,
): Promise<{ page: number; viewport: number; offenders: string[] }> {
  return page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const scrolls = (element: Element | null): boolean => {
      for (
        let node = element;
        node && node !== document.documentElement;
        node = node.parentElement
      ) {
        const { overflowX } = getComputedStyle(node);
        if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const element of document.body.querySelectorAll('*')) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if ((box.right > viewport + 1 || box.left < -1) && !scrolls(element.parentElement)) {
        const label = `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}.${String(element.className).slice(0, 60)}`;
        offenders.push(`${label} [${Math.round(box.left)}..${Math.round(box.right)}]`);
      }
    }
    return {
      page: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      viewport,
      offenders: offenders.slice(0, 8),
    };
  });
}

async function expectNoSidewaysScroll(page: Page, label: string): Promise<void> {
  await settlePage(page);
  const report = await overflowReport(page);
  expect(
    report.page,
    `${label}: the page is ${report.page}px wide in a ${report.viewport}px viewport; ${report.offenders.join(' | ')}`,
  ).toBeLessThanOrEqual(report.viewport);
  expect(report.offenders, `${label}: elements outside the viewport`).toEqual([]);
}

async function visit(
  page: Page,
  baseURL: string | undefined,
  path: string,
  locale: Locale,
): Promise<void> {
  await setPreferences(page.context(), baseURL ?? '', { locale, theme: 'dark' });
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('main#main-content')).toBeVisible();
}

test.describe('responsive: 390px, no sideways scroll', () => {
  const publicPaths = [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/pricing',
    '/docs',
    '/terms',
    '/privacy',
    '/refunds',
    '/acceptable-use',
    '/does-not-exist',
  ];

  for (const path of publicPaths) {
    test(`${path}`, async ({ page, baseURL }) => {
      for (const locale of LOCALES) {
        await test.step(`${path} in ${locale}`, async () => {
          await visit(page, baseURL, path, locale);
          await expectNoSidewaysScroll(page, `${path} ${locale}`);
        });
      }
    });
  }

  test('/explore and a share page of an image and of a video', async ({ page, baseURL, api }) => {
    const image = await createDemoImage(
      api,
      'A long prompt that has to wrap on a narrow screen without pushing the page sideways at all',
    );
    const video = await createDemoVideo(api, 'Waves');
    await api.patchGeneration(image.id, { isPublic: true });
    await api.patchGeneration(video.id, { isPublic: true });
    for (const locale of LOCALES) {
      for (const path of ['/explore', `/s/${image.id}`, `/s/${video.id}`]) {
        await test.step(`${path} in ${locale}`, async () => {
          await visit(page, baseURL, path, locale);
          await expectNoSidewaysScroll(page, `${path} ${locale}`);
        });
      }
    }
  });

  test('the studio, with its settings sheet, on every tool', async ({ page, baseURL, api }) => {
    await seedGallery(api);
    for (const locale of LOCALES) {
      await test.step(`studio in ${locale}`, async () => {
        await visit(page, baseURL, '/studio', locale);
        await expect(page.getByRole('article').first()).toBeVisible();
        await expectNoSidewaysScroll(page, `studio ${locale}`);
        for (const tool of ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video']) {
          await page.goto(`/studio?tool=${tool}`);
          await expect(page.locator('main#main-content')).toBeVisible();
          await expectNoSidewaysScroll(page, `studio ${tool} ${locale}`);

          await page.getByRole('button', { name: /^(Settings|الإعدادات)/ }).click();
          const sheet = page.getByRole('dialog');
          await expect(sheet).toBeVisible();
          const sheetWidth = await sheet.evaluate((element) => ({
            scroll: element.scrollWidth,
            client: element.clientWidth,
          }));
          expect(sheetWidth.scroll, `settings sheet of ${tool} ${locale}`).toBeLessThanOrEqual(
            sheetWidth.client,
          );
          await page.keyboard.press('Escape');
          await expect(sheet).toBeHidden();
        }
      });
    }
  });

  test('the gallery and a creation page', async ({ page, baseURL, api }) => {
    const seeded = await seedGallery(api);
    for (const locale of LOCALES) {
      for (const path of [
        '/gallery',
        `/gallery/${seeded.neon.id}`,
        `/gallery/${seeded.waves.id}`,
      ]) {
        await test.step(`${path} in ${locale}`, async () => {
          await visit(page, baseURL, path, locale);
          await expectNoSidewaysScroll(page, `${path} ${locale}`);
        });
      }
    }
  });

  test('the account in every section and billing', async ({ page, baseURL, api }) => {
    await createDemoImage(api, 'Credit history row');
    await api.createKey('A key with a rather long name to see how the list wraps');
    for (const locale of LOCALES) {
      for (const path of [
        '/account',
        '/account?tab=security',
        '/account?tab=credits',
        '/account?tab=keys',
        '/account?tab=data',
        '/account/billing',
      ]) {
        await test.step(`${path} in ${locale}`, async () => {
          await visit(page, baseURL, path, locale);
          await expectNoSidewaysScroll(page, `${path} ${locale}`);
        });
      }
    }
  });
});

test.describe('responsive: 390px, signed-in navigation', () => {
  test.use({ signedIn: true });

  test('the phone navigation reaches every area', async ({ page }) => {
    await page.goto('/studio');
    const nav = page.getByRole('navigation', { name: en('common.a11y.mobileNavigation') });
    await expect(nav).toBeVisible();
    // Explore is a public page with the site header, so it is the last stop.
    for (const [name, path] of [
      ['Gallery', '/gallery'],
      ['Account', '/account'],
      ['Studio', '/studio'],
      ['Explore', '/explore'],
    ] as const) {
      await nav.getByRole('link', { name }).click();
      await expect(page).toHaveURL(new RegExp(path));
    }
  });
});
