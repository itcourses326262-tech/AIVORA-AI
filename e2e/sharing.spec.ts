import type { APIRequestContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  ApiClient,
  DEMO_IMAGE_MODEL,
  DEMO_WORDS,
  createDemoImage,
  createDemoVideo,
} from './fixtures/api';
import { expectImagesLoaded } from './fixtures/media';
import { newAccountDetails, uniquePrompt, uniqueTag } from './fixtures/users';
import { en } from './fixtures/i18n';

/** The `<meta>` tags of a page as `property or name -> content`. */
async function metaTags(page: Page): Promise<Map<string, string>> {
  const tags = await page.evaluate(() =>
    [...document.querySelectorAll('meta')].map((meta) => [
      meta.getAttribute('property') ?? meta.getAttribute('name') ?? '',
      meta.getAttribute('content') ?? '',
    ]),
  );
  return new Map(tags.filter((pair): pair is [string, string] => pair[0] !== ''));
}

async function status(request: APIRequestContext, url: string): Promise<number> {
  return (await request.get(url)).status();
}

test.describe('public sharing', () => {
  test('a shared creation is public everywhere, shows the first name only and carries Open Graph tags', async ({
    account,
    api,
    freshContext,
    baseURL,
  }) => {
    const sharedPrompt = uniquePrompt('Alpine lake at sunrise');
    const hiddenPrompt = uniquePrompt('Secret garden at night');
    const shared = await createDemoImage(api, sharedPrompt);
    const hidden = await createDemoImage(api, hiddenPrompt);
    await api.patchGeneration(shared.id, { isPublic: true });
    const emailLocalPart = account.email.split('@')[0] ?? '';

    const visitorContext = await freshContext();
    const visitor = await visitorContext.newPage();
    const everythingSeen: string[] = [];
    visitor.on('response', async (response) => {
      if (
        response.url().startsWith(baseURL ?? '') &&
        /json|html|text/.test(response.headers()['content-type'] ?? '')
      ) {
        everythingSeen.push(await response.text().catch(() => ''));
      }
    });

    await test.step('Explore lists it for a visitor, with the first name and without the private one', async () => {
      await visitor.goto('/explore');
      await expect(visitor.getByRole('heading', { level: 1, name: 'Explore' })).toBeVisible();
      const link = visitor.getByRole('link', { name: sharedPrompt });
      await expect(link).toBeVisible();
      await expect(visitor.getByRole('article').filter({ has: link })).toContainText(
        `by ${account.firstName}`,
      );
      await expect(visitor.getByText(hiddenPrompt)).toHaveCount(0);
    });

    await test.step('the public feed API has the first name only', async () => {
      const feed = await visitorContext.request.get('/api/v1/explore');
      expect(feed.status()).toBe(200);
      const body = await feed.text();
      expect(body).toContain(sharedPrompt);
      expect(body).not.toContain(hiddenPrompt);
      expect(body).not.toContain(account.surname);
      expect(body).not.toContain(account.email);
      const items = (JSON.parse(body) as { data: Array<{ id: string; owner?: { name: string } }> })
        .data;
      expect(items.find((item) => item.id === shared.id)?.owner?.name).toBe(account.firstName);
      for (const item of items) expect(item.owner?.name ?? '').not.toContain(' ');
    });

    await test.step('opening the card leads to the share page with the real picture', async () => {
      await visitor.getByRole('link', { name: sharedPrompt }).click();
      await expect(visitor).toHaveURL(new RegExp(`/s/${shared.id}$`));
      await expect(visitor.getByRole('heading', { level: 1, name: sharedPrompt })).toBeVisible();
      await expect(visitor.getByText(`by ${account.firstName}`)).toBeVisible();
      await expectImagesLoaded(visitor.getByRole('img', { name: /^Generated image 1/ }), 1);
    });

    await test.step('Open Graph and Twitter tags describe the page and point at an absolute, public picture', async () => {
      const tags = await metaTags(visitor);
      const asset = shared.outputs[0];
      expect(tags.get('og:title')).toContain(sharedPrompt);
      expect(tags.get('og:type')).toBe('website');
      expect(tags.get('og:url')).toBe(`${baseURL}/s/${shared.id}`);
      expect(tags.get('og:image')).toBe(`${baseURL}${asset?.url}`);
      expect(tags.get('og:image:type')).toBe('image/webp');
      expect(Number(tags.get('og:image:width'))).toBeGreaterThan(0);
      expect(tags.get('og:image:alt')).toContain(sharedPrompt);
      expect(tags.get('og:description')).toContain('AIVORE Demo Image');
      expect(tags.get('twitter:card')).toBe('summary_large_image');
      expect(tags.get('twitter:image')).toBe(tags.get('og:image'));
      expect(tags.get('robots')).toBe('index, follow');
      await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        `${baseURL}/s/${shared.id}`,
      );

      const picture = await visitorContext.request.get(tags.get('og:image') ?? '');
      expect(picture.status()).toBe(200);
      expect(picture.headers()['content-type']).toBe('image/webp');
    });

    await test.step('structured data names the first name only', async () => {
      const jsonLd = await visitor.locator('script[type="application/ld+json"]').allTextContents();
      const parsed = jsonLd.map(
        (text) => JSON.parse(text) as { '@type': string; creator?: { name: string } },
      );
      const image = parsed.find((item) => item['@type'] === 'ImageObject');
      expect(image?.creator?.name).toBe(account.firstName);
    });

    await test.step('a link-preview crawler gets the tags in the HTML head', async () => {
      const crawl = await visitorContext.request.get(`/s/${shared.id}`, {
        headers: {
          'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        },
      });
      expect(crawl.status()).toBe(200);
      const html = await crawl.text();
      const head = html.slice(0, html.indexOf('</head>'));
      expect(head).toContain('property="og:image"');
      expect(head).toContain('name="twitter:card"');
    });

    await test.step('the private creation has no public page and no public picture', async () => {
      const notFound = await visitorContext.request.get(`/s/${hidden.id}`);
      expect(notFound.status()).toBe(404);
      expect(await status(visitorContext.request, hidden.outputs[0]?.url ?? '')).toBe(404);
      expect(await status(visitorContext.request, hidden.outputs[0]?.thumbUrl ?? '')).toBe(404);
    });

    await test.step('nothing a visitor was sent contains the surname or the email', async () => {
      expect(everythingSeen.length).toBeGreaterThan(0);
      const joined = everythingSeen.join('\n');
      expect(joined).toContain(account.firstName);
      expect(joined).not.toContain(account.surname);
      expect(joined).not.toContain(account.email);
      expect(joined).not.toContain(emailLocalPart);
      expect(await visitor.content()).not.toContain(account.surname);
    });
  });

  test('a shared Demo video has a still for previews and structured data that match its GIF', async ({
    api,
    freshContext,
    baseURL,
  }) => {
    const prompt = uniquePrompt('Ocean waves at dusk');
    const video = await createDemoVideo(api, prompt);
    await api.patchGeneration(video.id, { isPublic: true });

    const visitor = await (await freshContext()).newPage();
    await visitor.goto(`/s/${video.id}`);
    await expect(visitor.getByRole('heading', { level: 1, name: prompt })).toBeVisible();
    await expect(
      visitor.getByRole('heading', { level: 2, name: en('gallery.public.about') }),
    ).toBeVisible();

    const tags = await metaTags(visitor);
    expect(tags.get('og:image')).toBe(`${baseURL}${video.outputs[0]?.url}?variant=thumb`);
    // The Demo "video" is an animated GIF, so schema.org gets an ImageObject for it (a real MP4 gets a VideoObject).
    const jsonLd = await visitor.locator('script[type="application/ld+json"]').allTextContents();
    const parsed = jsonLd.map(
      (text) => JSON.parse(text) as { '@type': string; encodingFormat?: string },
    );
    expect(parsed).toEqual([
      expect.objectContaining({ '@type': 'ImageObject', encodingFormat: 'image/gif' }),
    ]);
  });

  test('unsharing takes the page, the feed entry and the picture offline at once', async ({
    api,
    freshContext,
  }) => {
    const prompt = uniquePrompt('Quiet harbour at dawn');
    const creation = await createDemoImage(api, prompt);
    await api.patchGeneration(creation.id, { isPublic: true });
    const visitor = await freshContext();
    const picture = creation.outputs[0]?.url ?? '';

    expect(await status(visitor.request, `/s/${creation.id}`)).toBe(200);
    expect(await status(visitor.request, picture)).toBe(200);

    await api.patchGeneration(creation.id, { isPublic: false });

    expect(await status(visitor.request, `/s/${creation.id}`)).toBe(404);
    expect(await status(visitor.request, picture)).toBe(404);
    const feed = await visitor.request.get('/api/v1/explore');
    expect(await feed.text()).not.toContain(prompt);
  });

  test('a share page for a missing creation is a friendly 404 with a way back', async ({
    freshContext,
  }) => {
    const page = await (await freshContext()).newPage();
    const response = await page.goto('/s/gen_00000000000000000000000000');
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: en('gallery.public.notFound.title') }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Explore creations' }).click();
    await expect(page).toHaveURL(/\/explore$/);
  });

  test('the Explore type filters are real addresses', async ({ api, freshContext }) => {
    const imagePrompt = uniquePrompt('Desert dunes at noon');
    const videoPrompt = uniquePrompt('Fireflies in a dark forest');
    const image = await createDemoImage(api, imagePrompt);
    const video = await createDemoVideo(api, videoPrompt);
    await api.patchGeneration(image.id, { isPublic: true });
    await api.patchGeneration(video.id, { isPublic: true });

    const visitor = await (await freshContext()).newPage();
    await visitor.goto('/explore?kind=video');
    await expect(visitor.getByRole('link', { name: videoPrompt })).toBeVisible();
    await expect(visitor.getByRole('link', { name: imagePrompt })).toHaveCount(0);
    await expect(
      visitor.getByRole('link', { name: en('gallery.list.filters.kind.video') }),
    ).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('what a public page may say about its owner', () => {
  test('an Arabic name shows its first word only', async ({ context, baseURL, freshContext }) => {
    const owner = new ApiClient(context.request, baseURL ?? '');
    const details = newAccountDetails();
    await owner.register({ ...details, name: `ليلى الحسن${uniqueTag()}`, locale: 'ar' });
    const prompt = uniquePrompt('Arabic owner picture');
    const created = await createDemoImage(owner, prompt);
    await owner.patchGeneration(created.id, { isPublic: true });

    const visitor = await (await freshContext()).newPage();
    await visitor.goto(`/s/${created.id}`);
    await expect(visitor.getByText('ليلى').first()).toBeVisible();
    const html = await visitor.content();
    expect(html).not.toContain('الحسن');
    expect(html).not.toContain(details.email);
  });

  test('a name that is really an email address is never shown', async ({
    context,
    baseURL,
    freshContext,
  }) => {
    const owner = new ApiClient(context.request, baseURL ?? '');
    const details = newAccountDetails();
    // Short on purpose: a public first name is cut at 24 characters, and an address longer than that
    // would never appear whole even if the guard were gone, so a test that looked for the whole
    // address could not fail. At 16 characters a leak shows up complete.
    const tag = uniqueTag();
    const leaked = `e${tag}@x.co`;
    expect(leaked.length).toBeLessThan(24);
    await owner.register({ ...details, name: `${leaked} Smith` });
    expect((await owner.me())?.name, 'the account really carries that name').toBe(
      `${leaked} Smith`,
    );
    const created = await createDemoImage(owner, uniquePrompt('Email as a name'));
    await owner.patchGeneration(created.id, { isPublic: true });

    const visitor = await freshContext();
    const feedResponse = await visitor.request.get('/api/v1/explore');
    const feed = await feedResponse.text();
    const entry = (
      JSON.parse(feed) as { data: Array<{ id: string; owner?: { name: string } }> }
    ).data.find((item) => item.id === created.id);

    await test.step('Explore lists the creation without a name that could be an address', async () => {
      expect(entry, 'the creation is in the public feed').toBeDefined();
      expect(entry?.owner?.name ?? '').not.toContain('@');
      expect(JSON.stringify(entry)).not.toContain(tag);
      expect(feed).not.toContain(leaked);
      expect(feed).not.toContain('Smith');
    });

    await test.step('the share page does not carry it in any form either', async () => {
      const page = await visitor.newPage();
      await page.goto(`/s/${created.id}`);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const html = await page.content();
      expect(html).not.toContain(tag);
      expect(html).not.toContain(leaked);
      expect(html).not.toContain('Smith');
      await expect(page.getByText(/\bby e[0-9a-f]{10}/)).toHaveCount(0);
    });
  });
});

test.describe("privacy of other people's creations", () => {
  test('another account and a visitor get 404 for a private creation and its files', async ({
    api,
    otherUser,
    freshContext,
  }) => {
    const mine = await createDemoImage(api, uniquePrompt('My private lighthouse'));
    const output = mine.outputs[0];
    expect(output).toBeDefined();
    const media = output?.url ?? '';
    const thumb = output?.thumbUrl ?? '';

    const stranger = await otherUser();
    const visitor = await freshContext();

    await test.step('the owner can load the picture', async () => {
      expect(await status(api.request, media)).toBe(200);
    });

    for (const [who, request] of [
      ['another account', stranger.context.request],
      ['a visitor', visitor.request],
    ] as const) {
      await test.step(`${who} gets the same 404 for the file, the thumbnail and the record`, async () => {
        expect(await status(request, media)).toBe(404);
        expect(await status(request, thumb)).toBe(404);
        expect(await status(request, `/api/v1/generations/${mine.id}`)).toBe(
          who === 'a visitor' ? 401 : 404,
        );
        expect(await status(request, `/s/${mine.id}`)).toBe(404);
      });
    }

    await test.step('another account cannot change or delete it either', async () => {
      expect(
        await stranger.api.statusOf('PATCH', `/api/v1/generations/${mine.id}`, { isPublic: true }),
      ).toBe(404);
      expect(await stranger.api.statusOf('DELETE', `/api/v1/generations/${mine.id}`)).toBe(404);
      expect(await stranger.api.statusOf('POST', `/api/v1/generations/${mine.id}/cancel`)).toBe(
        404,
      );
      const unchanged = await api.getGeneration(mine.id);
      expect(unchanged.isPublic).toBe(false);
      expect(unchanged.status).toBe('succeeded');
    });
  });

  test('a picture used as the input of a shared creation stays private', async ({
    api,
    freshContext,
  }) => {
    const source = await createDemoImage(api, uniquePrompt('Private source picture'));
    const inputId = await api.uploadImage(
      await api.bytes(source.outputs[0]?.url ?? ''),
      'image/webp',
      'source.webp',
    );

    const edit = await api.createGeneration({
      tool: 'image-to-image',
      modelId: DEMO_IMAGE_MODEL,
      prompt: `Make it golden ${DEMO_WORDS.sync}`,
      inputAssetId: inputId,
      isPublic: true,
    });
    const finished = await api.waitForStatus(edit.id, 'succeeded');
    expect(finished.input?.id).toBe(inputId);

    const visitor = await freshContext();
    expect(await status(visitor.request, `/s/${edit.id}`)).toBe(200);
    expect(await status(visitor.request, finished.outputs[0]?.url ?? '')).toBe(200);
    expect(await status(visitor.request, `/api/v1/media/${inputId}`)).toBe(404);
    const publicFeed = (await (await visitor.request.get('/api/v1/explore')).json()) as {
      data: Array<{ id: string; input?: unknown }>;
    };
    const entry = publicFeed.data.find((item) => item.id === edit.id);
    expect(entry).toBeDefined();
    expect(entry?.input).toBeUndefined();
  });
});
