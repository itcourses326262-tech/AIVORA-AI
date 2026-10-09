import { expect, test } from './fixtures';
import { DEMO_WORDS, seedGallery } from './fixtures/api';
import { expectImagesLoaded } from './fixtures/media';
import { storedFiles } from './fixtures/storage';
import type { Page } from '@playwright/test';
import { en } from './fixtures/i18n';

function cards(page: Page) {
  return page.getByRole('region', { name: 'Your creations' }).getByRole('article');
}

function cardOf(page: Page, prompt: string) {
  return cards(page).filter({ hasText: prompt });
}

async function openGallery(page: Page, query = ''): Promise<void> {
  await page.goto(`/gallery${query}`);
  await expect(page.getByRole('heading', { level: 1, name: en('gallery.title') })).toBeVisible();
}

// Every journey here starts signed in.
test.use({ signedIn: true });

test.describe('gallery: finding things', () => {
  test('filters by type and status, by favourites and by search', async ({ page, api }) => {
    const seeded = await seedGallery(api);
    await openGallery(page);
    await expect(cards(page)).toHaveCount(4);
    await expect(
      page.getByRole('status').filter({ hasText: 'Showing 4 creations' }),
    ).toBeAttached();

    await test.step('type: videos, images, all', async () => {
      await page.getByRole('radio', { name: en('gallery.list.filters.kind.video') }).click();
      await expect(cards(page)).toHaveCount(1);
      await expect(cardOf(page, 'Ocean waves')).toBeVisible();
      await expect(page).toHaveURL(/kind=video/);

      await page.getByRole('radio', { name: 'Images' }).click();
      await expect(cards(page)).toHaveCount(3);
      await page.getByRole('radio', { name: en('gallery.list.filters.kind.all') }).click();
      await expect(cards(page)).toHaveCount(4);
    });

    await test.step('status: failed shows only the broken run, with its refund note', async () => {
      await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Failed' });
      await expect(cards(page)).toHaveCount(1);
      await expect(cardOf(page, 'Broken tower')).toContainText(
        en('studio.generations.failure.refunded'),
      );
      await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Any status' });
      await expect(cards(page)).toHaveCount(4);
    });

    await test.step('favourite one card, then show only favourites', async () => {
      await cardOf(page, 'Alpine lake')
        .getByRole('button', { name: en('studio.generations.card.favorite') })
        .click();
      await expect(
        cardOf(page, 'Alpine lake').getByRole('button', {
          name: en('studio.generations.card.favorite'),
        }),
      ).toHaveAttribute('aria-pressed', 'true');
      await expect
        .poll(async () => (await api.getGeneration(seeded.alpine.id)).isFavorite)
        .toBe(true);

      await page.getByRole('button', { name: en('gallery.list.filters.favorites') }).click();
      await expect(cards(page)).toHaveCount(1);
      await expect(cardOf(page, 'Alpine lake')).toBeVisible();
      await page.getByRole('button', { name: en('gallery.list.filters.favorites') }).click();
      await expect(cards(page)).toHaveCount(4);
    });

    await test.step('search by words of the prompt, then a search that finds nothing', async () => {
      const search = page.getByRole('textbox', { name: en('gallery.list.search.label') });
      await search.fill('neon');
      await expect(cards(page)).toHaveCount(1);
      await expect(cardOf(page, 'Neon city')).toBeVisible();

      await search.fill('no such words anywhere');
      await expect(
        page.getByRole('heading', { name: en('gallery.list.noResults.title') }),
      ).toBeVisible();
      await page
        .getByRole('region', { name: 'Your creations' })
        .getByRole('button', { name: en('gallery.list.filters.clear') })
        .click();
      await expect(cards(page)).toHaveCount(4);
    });
  });

  test('a filtered address restores the same view after a reload', async ({ page, api }) => {
    await seedGallery(api);
    await openGallery(page, '?kind=image&q=neon');
    await expect(cards(page)).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'Images' })).toBeChecked();
    await expect(page.getByRole('textbox', { name: en('gallery.list.search.label') })).toHaveValue(
      'neon',
    );
    await page.reload();
    await expect(cards(page)).toHaveCount(1);
  });

  test('an empty gallery invites the first creation', async ({ page }) => {
    await openGallery(page);
    await expect(page.getByRole('heading', { name: en('gallery.list.empty.title') })).toBeVisible();
    await page.getByRole('link', { name: en('gallery.list.empty.action') }).click();
    await expect(page).toHaveURL(/\/studio/);
  });
});

test.describe('gallery: long lists', () => {
  test('the first 24 load at once and scrolling to the end brings the rest, without repeats', async ({
    page,
    api,
  }) => {
    test.setTimeout(150_000);
    // Four at a time: the account may only have four generations running.
    for (let batch = 0; batch < 7; batch += 1) {
      const created = [];
      for (let index = 0; index < 4 && batch * 4 + index < 26; index += 1) {
        created.push(
          await api.createGeneration({
            tool: 'text-to-image',
            modelId: 'aivore-demo-image',
            prompt: `Long list ${String(batch * 4 + index).padStart(2, '0')} ${DEMO_WORDS.sync}`,
          }),
        );
      }
      for (const generation of created) await api.waitForStatus(generation.id, 'succeeded');
    }
    expect(await api.listGenerations()).toHaveLength(26);

    await openGallery(page);
    await expect(cards(page)).toHaveCount(24);
    await expect(
      page.getByRole('status').filter({ hasText: 'Showing 24 creations' }),
    ).toBeAttached();

    // Scrolling to the end loads the next page by itself (the "Load more" button is the fallback).
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 30_000);
    await expect(cards(page)).toHaveCount(26);
    await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);

    const titles = await cards(page)
      .getByRole('link', { name: /^Long list/ })
      .allTextContents();
    expect(new Set(titles).size).toBe(26);
    expect(titles[0]).toContain('Long list 25');
    expect(titles[25]).toContain('Long list 00');
  });
});

test.describe('gallery: sharing and deleting', () => {
  test('the share toggle publishes and unpublishes, and the server follows', async ({
    page,
    api,
  }) => {
    const { alpine } = await seedGallery(api);
    await openGallery(page);

    await test.step('share from the card menu', async () => {
      await cardOf(page, 'Alpine lake')
        .getByRole('button', { name: en('studio.generations.actions.menu') })
        .click();
      await page.getByRole('menuitem', { name: 'Share to Explore' }).click();
      await expect(page.getByText(en('studio.generations.toast.shared'))).toBeVisible();
      await expect.poll(async () => (await api.getGeneration(alpine.id)).isPublic).toBe(true);
      await expect(
        cardOf(page, 'Alpine lake').getByText(en('studio.generations.card.shared'), {
          exact: true,
        }),
      ).toBeVisible();
    });

    await test.step('stop sharing from the same menu', async () => {
      await cardOf(page, 'Alpine lake')
        .getByRole('button', { name: en('studio.generations.actions.menu') })
        .click();
      await page.getByRole('menuitem', { name: en('studio.generations.actions.unshare') }).click();
      await expect(page.getByText(en('studio.generations.toast.unshared'))).toBeVisible();
      await expect.poll(async () => (await api.getGeneration(alpine.id)).isPublic).toBe(false);
    });
  });

  test('deleting asks first, removes the creation and its files', async ({
    page,
    account,
    api,
  }) => {
    const { alpine, neon } = await seedGallery(api);
    const picture = alpine.outputs[0]?.url ?? '';
    expect((await page.request.get(picture)).status()).toBe(200);
    const alpineFiles = await storedFiles(account.id, alpine.id);
    const neonFiles = await storedFiles(account.id, neon.id);
    // The picture and its thumbnail, with a hidden mime-type note next to each.
    expect(
      alpineFiles.length,
      'the creation has files on disk before it is deleted',
    ).toBeGreaterThan(0);
    expect(neonFiles.length).toBeGreaterThan(0);
    await openGallery(page);

    await cardOf(page, 'Alpine lake')
      .getByRole('button', { name: en('studio.generations.actions.menu') })
      .click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('alertdialog', { name: 'Delete this creation?' });
    await test.step('keeping it changes nothing', async () => {
      await dialog.getByRole('button', { name: 'Keep' }).click();
      await expect(dialog).toBeHidden();
      await expect(cards(page)).toHaveCount(4);
      expect(await storedFiles(account.id, alpine.id)).toEqual(alpineFiles);
    });

    await test.step('confirming removes it from the list, the API and the media route', async () => {
      await cardOf(page, 'Alpine lake')
        .getByRole('button', { name: en('studio.generations.actions.menu') })
        .click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await dialog.getByRole('button', { name: 'Delete' }).click();
      await expect(cards(page)).toHaveCount(3);
      await expect(cardOf(page, 'Alpine lake')).toHaveCount(0);
      expect((await page.request.get(`/api/v1/generations/${alpine.id}`)).status()).toBe(404);
      expect((await page.request.get(picture)).status()).toBe(404);
      expect((await page.request.get(neon.outputs[0]?.url ?? '')).status()).toBe(200);
    });

    await test.step('the files are gone from the disk, and the neighbour keeps its own', async () => {
      await expect.poll(() => storedFiles(account.id, alpine.id)).toEqual([]);
      expect(await storedFiles(account.id, neon.id)).toEqual(neonFiles);
    });
  });

  test('selecting several creations deletes them together', async ({ page, api }) => {
    await seedGallery(api);
    await openGallery(page);
    await page.getByRole('button', { name: en('gallery.select.mode'), exact: true }).click();
    await page.getByRole('button', { name: /^Select: Alpine lake/ }).click();
    await page.getByRole('button', { name: /^Select: Neon city/ }).click();
    await expect(page.getByText(en('gallery.select.count.two'))).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: en('gallery.select.deleteTitle.two') });
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(en('gallery.select.deleted.two'))).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(cards(page)).toHaveCount(2);
  });
});

test.describe('gallery: the detail page', () => {
  test('opens from a card, shows the settings and moves between neighbours', async ({
    page,
    api,
  }) => {
    const { alpine, neon } = await seedGallery(api);
    await openGallery(page);

    await test.step('open a creation from its title', async () => {
      await cardOf(page, 'Neon city')
        .getByRole('link', { name: /Neon city/ })
        .click();
      await expect(page).toHaveURL(new RegExp(`/gallery/${neon.id}$`));
      await expect(page.getByRole('heading', { level: 1, name: /Neon city/ })).toBeVisible();
      await expectImagesLoaded(
        page.getByRole('region', { name: en('gallery.detail.results') }).getByRole('img'),
        1,
      );
    });

    await test.step('the details match what the server stored', async () => {
      const details = page.getByRole('region', { name: 'Details' });
      await expect(details).toContainText(en('common.tools.textToImage.name'));
      await expect(details).toContainText('AIVORE Demo Image');
      await expect(details).toContainText('2 credits');
    });

    await test.step('previous and next walk the list the page was opened from', async () => {
      await expect(page.getByText('3 of 4')).toBeVisible();
      await page.getByRole('link', { name: en('gallery.detail.previous') }).click();
      await expect(page).not.toHaveURL(new RegExp(`/gallery/${neon.id}$`));
      await expect(page.getByText('2 of 4')).toBeVisible();
      await page.getByRole('link', { name: en('gallery.detail.next') }).click();
      await expect(page).toHaveURL(new RegExp(`/gallery/${neon.id}$`));
      await page.keyboard.press('ArrowRight');
      await expect(page).toHaveURL(new RegExp(`/gallery/${alpine.id}$`));
    });

    await test.step('back to the gallery returns to the same list', async () => {
      await page.getByRole('link', { name: en('gallery.detail.back') }).click();
      await expect(page).toHaveURL(/\/gallery$/);
      await expect(cards(page)).toHaveCount(4);
    });
  });

  test('downloads the original and offers to edit or animate the picture', async ({
    page,
    api,
  }) => {
    const { alpine } = await seedGallery(api);
    await page.goto(`/gallery/${alpine.id}`);

    const download = page.getByRole('link', { name: en('gallery.detail.download') });
    const href = (await download.getAttribute('href')) ?? '';
    const file = await page.request.get(href);
    expect(file.status()).toBe(200);
    expect(file.headers()['content-disposition']).toMatch(/^attachment/);
    expect(file.headers()['x-content-type-options']).toBe('nosniff');

    await page.getByRole('link', { name: en('gallery.detail.animate') }).click();
    await expect(page).toHaveURL(/\/studio\?tool=image-to-video/);
    await expect(
      page.getByRole('tab', { name: en('common.tools.imageToVideo.name'), selected: true }),
    ).toBeVisible();
    await expectImagesLoaded(page.getByRole('img', { name: en('studio.image.preview') }));
  });

  test('shares from the detail page and shows the public link', async ({ page, api, baseURL }) => {
    const { alpine } = await seedGallery(api);
    await page.goto(`/gallery/${alpine.id}`);

    const toggle = page.getByRole('switch', { name: en('gallery.share.toggle') });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(page.getByLabel(en('gallery.share.link'))).toHaveValue(
      `${baseURL}/s/${alpine.id}`,
    );
    await expect(page.getByRole('link', { name: en('gallery.share.open') })).toHaveAttribute(
      'href',
      `/s/${alpine.id}`,
    );
    await expect.poll(async () => (await api.getGeneration(alpine.id)).isPublic).toBe(true);
  });

  test('a creation that is not yours is a 404 inside the app', async ({ page, otherUser }) => {
    const owner = await otherUser();
    const { alpine } = await seedGallery(owner.api);
    const response = await page.goto(`/gallery/${alpine.id}`);
    expect(response?.status()).toBe(404);
  });
});
