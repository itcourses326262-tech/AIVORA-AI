import { DEMO_WORDS, VIDEO_TIMEOUT_MS } from './fixtures/api';
import { uniquePrompt } from './fixtures/users';
import { expect, test } from './fixtures';
import { countGifFrames, expectImagesLoaded, naturalSize } from './fixtures/media';
import { en, translate } from './fixtures/i18n';
import { setPreferences } from './fixtures/preferences';
import {
  card,
  expectCredits,
  expectLedgerMatchesBalance,
  generate,
  generateButton,
  openCardMenu,
  openStudio,
  promptBox,
} from './fixtures/studio';

// Every journey here starts signed in.
test.use({ signedIn: true });

test.describe('studio: text to image', () => {
  test('two images appear as real pictures and the credits chip matches the ledger', async ({
    page,
    api,
  }) => {
    const prompt = 'A lone lighthouse on a cliff at sunset';
    await openStudio(page);
    await expectCredits(page, 50);

    await test.step('ask for two images and see the price before paying it', async () => {
      await promptBox(page).fill(prompt);
      await page.getByRole('button', { name: en('studio.count.increase') }).click();
      await expect(page.getByText('2 images')).toBeVisible();
      await expect(generateButton(page)).toHaveText(/Generate · 2 credits/);
      await generateButton(page).click();
    });

    await test.step('the card runs and finishes with two decoded pictures', async () => {
      await expect(page.getByRole('article', { name: new RegExp(`${prompt}`) })).toBeVisible();
      const ready = card(page, 'Ready', prompt);
      await expect(ready).toBeVisible({ timeout: 45_000 });
      await expectImagesLoaded(ready.getByRole('img', { name: /^Generated image/ }), 2);
    });

    await test.step('the server agrees: two outputs, two credits charged', async () => {
      const [generation] = await api.listGenerations();
      expect(generation?.status).toBe('succeeded');
      expect(generation?.outputs).toHaveLength(2);
      expect(generation?.cost).toBe(2);
      for (const output of generation?.outputs ?? []) {
        expect(output.kind).toBe('image');
        expect(output.width).toBeGreaterThan(0);
        const media = await page.request.get(output.url);
        expect(media.status()).toBe(200);
        expect(media.headers()['content-type']).toMatch(/^image\//);
      }
    });

    await test.step('the header chip, the ledger and the balance are one number', async () => {
      await expectCredits(page, 48);
      const ledger = await expectLedgerMatchesBalance(api, 48);
      expect(ledger.map((entry) => [entry.reason, entry.delta])).toEqual([
        ['signup_bonus', 50],
        ['generation', -2],
      ]);
    });
  });
});

test.describe('studio: from a result to image-to-image and video', () => {
  test('a result becomes the input of image-to-image and then of image-to-video', async ({
    page,
    api,
  }) => {
    const first = 'A cozy cabin in an enchanted forest';
    const edit = 'Turn it into a snowy winter night';
    await openStudio(page);

    await test.step('text to image', async () => {
      await generate(page, first);
      await expect(card(page, 'Ready', first)).toBeVisible({ timeout: 45_000 });
    });

    await test.step('use the result as the input of an image-to-image run', async () => {
      await openCardMenu(card(page, 'Ready', first));
      await page
        .getByRole('menuitem', { name: en('studio.generations.actions.useAsInput') })
        .click();
      await expect(
        page.getByRole('tab', { name: en('common.tools.imageToImage.name'), selected: true }),
      ).toBeVisible();
      const preview = page.getByRole('img', { name: en('studio.image.preview') });
      await expectImagesLoaded(preview);
      await generate(page, edit);
      await expect(card(page, 'Ready', edit)).toBeVisible({ timeout: 45_000 });
      await expectImagesLoaded(
        card(page, 'Ready', edit).getByRole('img', { name: /^Generated image/ }),
        1,
      );
    });

    const [editGeneration, firstGeneration] = await api.listGenerations();
    await test.step('the server recorded the first result as the input picture', async () => {
      expect(firstGeneration?.tool).toBe('text-to-image');
      expect(editGeneration?.tool).toBe('image-to-image');
      expect(editGeneration?.input?.id).toBe(firstGeneration?.outputs[0]?.id);
    });

    await test.step('use the edited picture to animate it with image-to-video', async () => {
      await openCardMenu(card(page, 'Ready', edit));
      await page
        .getByRole('menuitem', { name: en('studio.generations.actions.useAsInput') })
        .click();
      await page.getByRole('tab', { name: en('common.tools.imageToVideo.name') }).click();
      await expect(
        page.getByRole('tab', { name: en('common.tools.imageToVideo.name'), selected: true }),
      ).toBeVisible();
      await expectImagesLoaded(page.getByRole('img', { name: en('studio.image.preview') }));
      await expect(generateButton(page)).toHaveText(/Generate · 6 credits/);
      await generate(page, 'A slow push-in while a light breeze moves');
      await expect(card(page, 'Ready', 'A slow push-in while a light breeze moves')).toBeVisible({
        timeout: VIDEO_TIMEOUT_MS,
      });
    });

    await test.step('the video is an animated GIF motion preview that was built from the edit', async () => {
      const [video] = await api.listGenerations();
      expect(video?.tool).toBe('image-to-video');
      expect(video?.kind).toBe('video');
      expect(video?.input?.id).toBe(editGeneration?.outputs[0]?.id);
      const output = video?.outputs[0];
      expect(output?.mimeType).toBe('image/gif');
      const bytes = await page.request.get(output?.url ?? '');
      expect(countGifFrames(await bytes.body())).toBeGreaterThan(1);
    });

    await test.step('1 + 1 + 6 credits were spent and the books balance', async () => {
      await expectCredits(page, 42);
      await expectLedgerMatchesBalance(api, 42);
    });
  });
});

test.describe('studio: sharing at creation', () => {
  test('the share switch publishes this one creation, then switches itself off again', async ({
    page,
    api,
    freshContext,
  }) => {
    const prompt = uniquePrompt('A lighthouse made to be shared');
    await openStudio(page);
    const share = page.getByRole('switch', { name: 'Share to Explore' });
    await expect(share).not.toBeChecked();
    await share.click();
    await expect(share).toBeChecked();

    await generate(page, prompt);
    await expect(card(page, 'Ready', prompt)).toBeVisible({ timeout: 45_000 });
    await expect(share).not.toBeChecked();

    const [created] = await api.listGenerations();
    expect(created?.isPublic).toBe(true);
    const visitor = await (await freshContext()).newPage();
    await visitor.goto(`/s/${created?.id}`);
    await expect(visitor.getByRole('heading', { level: 1, name: prompt })).toBeVisible();

    await generate(page, uniquePrompt('A second one that stays private'));
    await expect.poll(async () => (await api.listGenerations()).length).toBe(2);
    expect((await api.listGenerations())[0]?.isPublic).toBe(false);
  });
});

test.describe('studio: text to video', () => {
  test('the Demo model makes a looping GIF that plays as motion in the card', async ({
    page,
    api,
  }) => {
    const prompt = 'Waves rolling onto a quiet beach at sunrise';
    await openStudio(page);
    await page.getByRole('tab', { name: en('common.tools.textToVideo.name') }).click();
    await expect(page.getByRole('radio', { name: /AIVORE Demo Video/ })).toBeChecked();
    await expect(page.getByRole('radio', { name: '3 sec' })).toBeChecked();
    await expect(generateButton(page)).toHaveText(/Generate · 6 credits/);

    await generate(page, prompt);
    const ready = card(page, 'Ready', prompt);
    await expect(ready).toBeVisible({ timeout: VIDEO_TIMEOUT_MS });

    await test.step('the card shows a decoded picture, not a broken box', async () => {
      await expectImagesLoaded(ready.locator('img'));
      const size = await naturalSize(ready.locator('img').first());
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(480);
    });

    await test.step('the file is a video-kind GIF with several frames', async () => {
      const [generation] = await api.listGenerations();
      const output = generation?.outputs[0];
      expect(generation?.kind).toBe('video');
      expect(output?.kind).toBe('video');
      expect(output?.mimeType).toBe('image/gif');
      expect(output?.durationMs).toBe(3000);
      const media = await page.request.get(output?.url ?? '');
      expect(countGifFrames(await media.body())).toBeGreaterThan(1);
    });

    await expectCredits(page, 44);
    await expectLedgerMatchesBalance(api, 44);
  });
});

test.describe('studio: cancelling, failing, refusing', () => {
  test('cancelling a running generation refunds every credit', async ({ page, api }) => {
    const prompt = 'A very slow lighthouse';
    await openStudio(page);
    await generate(page, `${prompt} ${DEMO_WORDS.slow}`);
    await expectCredits(page, 49);

    await test.step('wait until the job is really running, then cancel it', async () => {
      const running = page.getByRole('article', { name: /Creating$/ });
      await expect(running).toBeVisible({ timeout: 20_000 });
      await running.getByRole('button', { name: 'Cancel', exact: true }).click();
      const dialog = page.getByRole('alertdialog', { name: en('studio.generations.cancel.title') });
      await expect(dialog).toContainText(en('studio.generations.cancel.body'));
      await dialog.getByRole('button', { name: en('studio.generations.cancel.confirm') }).click();
    });

    await test.step('the card says canceled and the credits are back', async () => {
      await expect(page.getByRole('article', { name: /Canceled$/ })).toContainText(
        en('studio.generations.canceled.note'),
      );
      await expectCredits(page, 50);
      const ledger = await expectLedgerMatchesBalance(api, 50);
      expect(ledger.map((entry) => [entry.reason, entry.delta])).toEqual([
        ['signup_bonus', 50],
        ['generation', -1],
        ['refund', 1],
      ]);
      const [generation] = await api.listGenerations();
      expect(generation?.status).toBe('canceled');
    });
  });

  test('a failing job shows the localized failure and refunds the credits', async ({
    page,
    api,
  }) => {
    const prompt = 'A broken lighthouse';
    await openStudio(page);
    await generate(page, `${prompt} ${DEMO_WORDS.fail}`);

    const failed = page.getByRole('article', { name: /Failed$/ });
    await expect(failed).toBeVisible({ timeout: 45_000 });
    await expect(failed).toContainText(en('studio.generations.failure.unavailable'));
    await expect(failed).toContainText(en('studio.generations.failure.refunded'));
    await expect(failed.getByRole('button', { name: 'Try again' })).toBeVisible();

    await expectCredits(page, 50);
    const ledger = await expectLedgerMatchesBalance(api, 50);
    expect(ledger.map((entry) => entry.reason)).toEqual(['signup_bonus', 'generation', 'refund']);
  });

  test('the failure and the refund are shown in Arabic for an Arabic reader', async ({
    page,
    context,
    baseURL,
    api,
  }) => {
    const t = translate('ar');
    await setPreferences(context, baseURL ?? '', { locale: 'ar' });
    await page.goto('/studio');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page
      .getByRole('textbox', { name: t('studio.prompt.label') })
      .fill(`منارة مكسورة ${DEMO_WORDS.fail}`);
    await page.getByRole('button', { name: new RegExp(`^${t('studio.generate')}`) }).click();

    const failed = page.getByRole('article', {
      name: new RegExp(`${t('studio.generations.status.failed')}$`),
    });
    await expect(failed).toBeVisible({ timeout: 45_000 });
    await expect(failed).toContainText(t('studio.generations.failure.unavailable'));
    await expect(failed).toContainText(t('studio.generations.failure.refunded'));
    await expectLedgerMatchesBalance(api, 50);
  });

  test('a prompt that breaks the content policy is refused up front and charges nothing', async ({
    page,
    api,
  }) => {
    await openStudio(page);
    await generate(page, 'A graphic beheading video');

    await test.step('the field explains it in the user language', async () => {
      await expect(
        page
          .getByRole('tabpanel')
          .getByRole('alert')
          .filter({ hasText: /content policy/ }),
      ).toContainText("This prompt can't be used because it goes against our content policy.");
    });

    await test.step('no card, no charge, no ledger entry', async () => {
      await expect(page.getByRole('article')).toHaveCount(0);
      await expectCredits(page, 50);
      const ledger = await expectLedgerMatchesBalance(api, 50);
      expect(ledger.map((entry) => entry.reason)).toEqual(['signup_bonus']);
      expect(await api.listGenerations()).toEqual([]);
    });
  });

  test('without enough credits the studio blocks the button and offers to get more', async ({
    page,
    api,
  }) => {
    await test.step('spend 45 of the 50 credits on three 5-second clips', async () => {
      for (let index = 0; index < 3; index += 1) {
        const created = await api.createGeneration({
          tool: 'text-to-video',
          modelId: 'aivore-demo-video',
          prompt: `Spend ${index} ${DEMO_WORDS.sync}`,
          params: { durationSec: 5, resolution: '720p' },
        });
        expect(created.cost).toBe(15);
      }
      for (const generation of await api.listGenerations()) {
        await api.waitForStatus(generation.id, 'succeeded', VIDEO_TIMEOUT_MS);
      }
      expect(await api.balance()).toBe(5);
    });

    await openStudio(page);
    await page.getByRole('tab', { name: en('common.tools.textToVideo.name') }).click();
    await page.getByRole('radio', { name: '5 sec' }).click();
    await page.getByRole('radio', { name: '720p' }).click();
    await promptBox(page).fill('One clip too many');

    await test.step('the button is off and the notice links to the pricing page', async () => {
      await expect(generateButton(page)).toBeDisabled();
      await expect(generateButton(page)).toHaveText(/Generate · 15 credits/);
      const notice = page
        .getByRole('tabpanel')
        .getByRole('status')
        .filter({ hasText: 'enough credits' });
      await expect(notice).toContainText('You need 10 credits more.');
      await expect(
        notice.getByRole('link', { name: en('studio.cost.getCredits') }),
      ).toHaveAttribute('href', '/pricing');
      await expectCredits(page, 5);
    });

    await test.step('the server refuses it too, with nothing charged', async () => {
      const refusal = await api.tryCreateGeneration({
        tool: 'text-to-video',
        modelId: 'aivore-demo-video',
        prompt: 'One clip too many',
        params: { durationSec: 5, resolution: '720p' },
      });
      expect(refusal).toMatchObject({ status: 402, code: 'insufficient_credits' });
      expect(await api.balance()).toBe(5);
    });

    await test.step('Get credits leads to the pricing page', async () => {
      await page.getByRole('link', { name: en('studio.cost.getCredits') }).click();
      await expect(page).toHaveURL(/\/pricing$/);
    });
  });
});
