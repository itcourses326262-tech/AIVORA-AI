import { expect, test } from './fixtures';
import { createDemoImage } from './fixtures/api';
import { expectImagesLoaded } from './fixtures/media';
import {
  card,
  expectCredits,
  generate,
  generateButton,
  openStudio,
  promptBox,
} from './fixtures/studio';
import { uniquePrompt } from './fixtures/users';
import { en } from './fixtures/i18n';

// Every journey here starts signed in.
test.use({ signedIn: true });

test.describe('studio: prompt tools', () => {
  test('Enhance improves the prompt and Undo brings the original back', async ({ page }) => {
    await openStudio(page);
    await promptBox(page).fill('a cat on a roof');
    await page.getByRole('button', { name: en('studio.prompt.enhance') }).click();

    await expect(page.getByText(en('studio.prompt.enhanced')).first()).toBeVisible();
    await expect(promptBox(page)).not.toHaveValue('a cat on a roof');
    expect((await promptBox(page).inputValue()).length).toBeGreaterThan('a cat on a roof'.length);
    expect(await promptBox(page).inputValue()).toContain('a cat on a roof');

    await page.getByRole('button', { name: en('studio.prompt.undo') }).click();
    await expect(promptBox(page)).toHaveValue('a cat on a roof');
  });

  test('Enhance asks for text first, and Surprise me and the examples fill the prompt', async ({
    page,
  }) => {
    await openStudio(page);

    await page.getByRole('button', { name: en('studio.prompt.enhance') }).click();
    await expect(page.getByText(en('studio.prompt.enhanceNeedsText')).first()).toBeVisible();

    await page.getByRole('button', { name: en('studio.prompt.surprise') }).click();
    await expect(promptBox(page)).not.toHaveValue('');

    const example = page
      .getByRole('button', { name: 'A cozy cabin in an enchanted forest with glowing mushrooms' })
      .first();
    const label = (await example.textContent()) ?? '';
    await example.click();
    expect(
      (await promptBox(page).inputValue()).startsWith(label.replace('…', '').slice(0, 30)),
    ).toBe(true);
    await expect(page.getByText(/^\d+ of 2000 characters$/)).toBeVisible();
  });

  test('an empty prompt is refused before anything is sent', async ({ page, api }) => {
    await openStudio(page);
    await generateButton(page).click();
    await expect(page.getByText(en('studio.prompt.required'))).toBeVisible();
    await expect(page.getByRole('article')).toHaveCount(0);
    expect(await api.listGenerations()).toEqual([]);
    await expectCredits(page, 50);
  });

  test('Ctrl+Enter generates and moves focus to the new card', async ({ page }) => {
    const prompt = uniquePrompt('A keyboard only lighthouse');
    await openStudio(page);
    await promptBox(page).fill(prompt);
    await promptBox(page).press('Control+Enter');

    const running = page.getByRole('article', { name: new RegExp(prompt) });
    await expect(running).toBeVisible();
    await expect(running).toBeFocused();
    await expect(card(page, 'Ready', prompt)).toBeVisible({ timeout: 45_000 });
  });
});

test.describe('studio: input pictures, results and remembered settings', () => {
  test('uploading a picture through the dropzone feeds image-to-image', async ({ page, api }) => {
    const source = await createDemoImage(api, uniquePrompt('Source picture for an upload'));
    const picture = await api.bytes(source.outputs[0]?.url ?? '');
    const prompt = uniquePrompt('Make it a watercolor');

    await openStudio(page, '?tool=image-to-image');
    await expect(
      page.getByText(en('studio.image.required')).or(page.getByText(en('studio.image.drop.title'))),
    ).toBeVisible();

    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: picture });
    const preview = page.getByRole('img', { name: en('studio.image.preview') });
    await expectImagesLoaded(preview);
    await expect(page.getByText('1024 × 1024 px')).toBeVisible();

    await generate(page, prompt);
    const ready = card(page, 'Ready', prompt);
    await expect(ready).toBeVisible({ timeout: 45_000 });
    await expectImagesLoaded(ready.getByRole('img', { name: /^Generated image/ }), 1);

    const [edit] = await api.listGenerations();
    expect(edit?.tool).toBe('image-to-image');
    expect(edit?.input?.kind).toBe('image');
    expect(edit?.input?.id).not.toBe(source.outputs[0]?.id);
  });

  test('a file that is not a picture is refused with a reason, and the old picture stays', async ({
    page,
  }) => {
    await openStudio(page, '?tool=image-to-image');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a picture'),
    });
    await expect(page.getByText(en('studio.image.errors.type'))).toBeVisible();
    await expect(page.getByRole('img', { name: en('studio.image.preview') })).toHaveCount(0);
  });

  test('a result opens in the viewer, which pages through the pictures and gives focus back', async ({
    page,
    api,
  }) => {
    const prompt = uniquePrompt('Two pictures in a viewer');
    await createDemoImage(api, prompt, { count: 2 });
    await openStudio(page);

    const first = page.getByRole('button', {
      name: new RegExp(`^View larger: Generated image 1: ${prompt}`),
    });
    await first.click();
    const viewer = page.getByRole('dialog');
    await expect(viewer).toBeVisible();
    await expect(viewer.getByText('1 of 2')).toBeVisible();
    await expectImagesLoaded(viewer.getByRole('img').first());

    await viewer.getByRole('button', { name: en('studio.generations.viewer.next') }).click();
    await expect(viewer.getByText('2 of 2')).toBeVisible();
    await viewer.getByRole('button', { name: en('studio.generations.viewer.previous') }).click();
    await expect(viewer.getByText('1 of 2')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(first).toBeFocused();
  });

  test('the last tool and its settings come back on the next visit; a link can prefill the prompt', async ({
    page,
  }) => {
    await openStudio(page);
    await page.getByRole('tab', { name: en('common.tools.textToVideo.name') }).click();
    await page.getByRole('radio', { name: '5 sec' }).click();
    await page.getByRole('radio', { name: '720p' }).click();
    await expect(generateButton(page)).toHaveText(/Generate · 15 credits/);

    await page.goto('/studio');
    await expect(
      page.getByRole('tab', { name: en('common.tools.textToVideo.name'), selected: true }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: '5 sec' })).toBeChecked();
    await expect(page.getByRole('radio', { name: '720p' })).toBeChecked();

    await page.goto('/studio?tool=text-to-image&prompt=A%20prefilled%20idea');
    await expect(
      page.getByRole('tab', { name: en('common.tools.textToImage.name'), selected: true }),
    ).toBeVisible();
    await expect(promptBox(page)).toHaveValue('A prefilled idea');
    await expect(page).not.toHaveURL(/prompt=/);
  });

  test('the model picker disables models this server does not have', async ({ page }) => {
    await openStudio(page);
    await expect(page.getByRole('radio', { name: /AIVORE Demo Image/ })).toBeEnabled();
    for (const name of [/FLUX\.1 Schnell/, /FLUX\.2 Pro/, /Nano Banana Pro/]) {
      const model = page.getByRole('radio', { name }).first();
      await expect(model).toBeDisabled();
      await expect(model).toContainText(en('studio.model.notConfigured'));
    }
  });
});
