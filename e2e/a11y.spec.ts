import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { seedGallery, createDemoImage } from './fixtures/api';
import { expectNoSeriousViolations } from './fixtures/axe';
import {
  COMBINATIONS,
  describeCombination,
  setPreferences,
  type Locale,
  type Theme,
} from './fixtures/preferences';
import { settlePage } from './fixtures/studio';

// Animations settle instantly, so axe measures the colours people end up seeing, not a frame of a fade.
test.use({ reducedMotion: 'reduce' });

type Combination = { locale: Locale; theme: Theme };

/** Opens `path` in every language and theme and scans it as it is rendered. */
async function scanEverywhere(
  page: Page,
  baseURL: string | undefined,
  testInfo: Parameters<typeof expectNoSeriousViolations>[1],
  path: string,
  ready: (page: Page) => Promise<void>,
  combinations: readonly Combination[] = COMBINATIONS,
): Promise<void> {
  for (const combination of combinations) {
    await test.step(`${path} in ${describeCombination(combination)}`, async () => {
      await setPreferences(page.context(), baseURL ?? '', combination);
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('lang', combination.locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', combination.theme);
      await ready(page);
      await settlePage(page);
      await expectNoSeriousViolations(
        page,
        testInfo,
        `${path} ${describeCombination(combination)}`,
      );
    });
  }
}

const mainVisible = (page: Page) => expect(page.locator('main#main-content')).toBeVisible();

test.describe('accessibility: public pages (axe, serious and critical violations)', () => {
  // The documentation and the legal texts are big; axe needs tens of seconds for each of them.
  test.describe.configure({ timeout: 150_000 });

  const publicPages = [
    '/',
    '/login',
    '/register',
    '/forgot-password',
    '/pricing',
    '/docs',
    '/terms',
    '/does-not-exist',
  ];

  // One test per language and theme, so the slow pages are scanned side by side by several workers.
  for (const path of publicPages) {
    for (const combination of COMBINATIONS) {
      test(`${path} in ${describeCombination(combination)}`, async ({
        page,
        baseURL,
      }, testInfo) => {
        await scanEverywhere(page, baseURL, testInfo, path, mainVisible, [combination]);
      });
    }
  }

  for (const path of ['/privacy', '/refunds', '/acceptable-use']) {
    test(`${path}`, async ({ page, baseURL }, testInfo) => {
      await scanEverywhere(page, baseURL, testInfo, path, mainVisible, [
        { locale: 'en', theme: 'light' },
        { locale: 'ar', theme: 'dark' },
      ]);
    });
  }

  test('/explore and a share page, with shared creations on them', async ({
    page,
    baseURL,
    api,
  }, testInfo) => {
    const creation = await createDemoImage(api, 'A shared lighthouse for the accessibility scan');
    await api.patchGeneration(creation.id, { isPublic: true });
    await page.context().clearCookies();
    await scanEverywhere(page, baseURL, testInfo, '/explore', async (current) => {
      await expect(current.getByRole('article').first()).toBeVisible();
    });
    await scanEverywhere(page, baseURL, testInfo, `/s/${creation.id}`, async (current) => {
      await expect(current.locator('main img').first()).toBeVisible();
    });
  });
});

test.describe('accessibility: signed-in pages', () => {
  test('/studio with results on the canvas', async ({ page, baseURL, api }, testInfo) => {
    await seedGallery(api);
    await scanEverywhere(page, baseURL, testInfo, '/studio', async (current) => {
      await expect(current.getByRole('textbox').first()).toBeVisible();
      await expect(current.getByRole('article').first()).toBeVisible();
    });
  });

  test('/gallery and a detail page', async ({ page, baseURL, api }, testInfo) => {
    const seeded = await seedGallery(api);
    await api.patchGeneration(seeded.alpine.id, { isFavorite: true });
    await scanEverywhere(page, baseURL, testInfo, '/gallery', async (current) => {
      await expect(current.getByRole('article').first()).toBeVisible();
    });
    await scanEverywhere(page, baseURL, testInfo, `/gallery/${seeded.neon.id}`, async (current) => {
      await expect(current.getByRole('img').first()).toBeVisible();
    });
  });

  test('/account in every section', async ({ page, baseURL, api }, testInfo) => {
    await createDemoImage(api, 'Something for the credit history');
    await api.createKey('scan key');
    await scanEverywhere(page, baseURL, testInfo, '/account', mainVisible);
    for (const tab of ['security', 'credits', 'keys', 'data']) {
      await scanEverywhere(page, baseURL, testInfo, `/account?tab=${tab}`, mainVisible, [
        { locale: 'en', theme: 'light' },
        { locale: 'ar', theme: 'dark' },
      ]);
    }
    await scanEverywhere(page, baseURL, testInfo, '/account/billing', mainVisible, [
      { locale: 'en', theme: 'dark' },
      { locale: 'ar', theme: 'light' },
    ]);
  });
});

test.describe('accessibility: the scanner itself', () => {
  test('fails on a page that really is inaccessible, so a green run means something', async ({
    page,
  }, testInfo) => {
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Broken</title></head><body><main id="main-content">' +
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><button></button></main></body></html>',
    );
    await expect(
      expectNoSeriousViolations(page, testInfo, 'deliberately broken page'),
    ).rejects.toThrow(/image-alt|button-name/);
  });
});
