import { E2E_LIMITS } from './env';
import { expect, test } from './fixtures';
import {
  DEMO_IMAGE_MODEL,
  DEMO_VIDEO_MODEL,
  DEMO_WORDS,
  createDemoImage,
  type ApiError,
} from './fixtures/api';
import { expectLedgerMatchesBalance } from './fixtures/studio';
import { uniquePrompt } from './fixtures/users';

test.use({ signedIn: true });

function isRefusal(result: unknown): result is ApiError {
  return typeof result === 'object' && result !== null && 'status' in result && 'code' in result;
}

test.describe('developer API: generations', () => {
  test('an Idempotency-Key makes a retry safe: one generation, one charge', async ({ api }) => {
    const key = `e2e-${crypto.randomUUID()}`;
    const body = {
      tool: 'text-to-image',
      modelId: DEMO_IMAGE_MODEL,
      prompt: `Retried request ${DEMO_WORDS.sync}`,
    };
    const send = (data: unknown) =>
      api.request.post('/api/v1/generations', {
        data,
        headers: { origin: api.origin, 'idempotency-key': key },
      });

    const first = await send(body);
    expect(first.status()).toBe(201);
    expect(first.headers().location).toMatch(/^\/api\/v1\/generations\/gen_/);
    const created = ((await first.json()) as { data: { id: string } }).data;

    const replay = await send(body);
    expect(replay.status()).toBe(200);
    expect(replay.headers()['idempotent-replayed']).toBe('true');
    expect(((await replay.json()) as { data: { id: string } }).data.id).toBe(created.id);

    const reused = await send({ ...body, prompt: 'Something else entirely' });
    expect(reused.status()).toBe(409);
    expect(
      ((await reused.json()) as { error: { details: { reason: string } } }).error.details.reason,
    ).toBe('idempotency_key_reused');

    await api.waitForStatus(created.id, 'succeeded');
    expect(await api.listGenerations()).toHaveLength(1);
    await expectLedgerMatchesBalance(api, 49);
  });

  test('one more than the active limit is refused, and cancelling the others refunds them all', async ({
    api,
  }) => {
    // The limit is pinned in the server's environment (e2e/env.ts), not left to its default.
    const limit = E2E_LIMITS.maxActivePerUser;
    const running = [];
    for (let index = 0; index < limit; index += 1) {
      running.push(
        await api.createGeneration({
          tool: 'text-to-image',
          modelId: DEMO_IMAGE_MODEL,
          prompt: `Slow ${index} ${DEMO_WORDS.slow}`,
        }),
      );
    }
    const left = E2E_LIMITS.signupBonusCredits - limit;
    expect(await api.balance()).toBe(left);

    const refused = await api.tryCreateGeneration({
      tool: 'text-to-image',
      modelId: DEMO_IMAGE_MODEL,
      prompt: 'One too many',
    });
    expect(isRefusal(refused) && refused).toMatchObject({ status: 429, code: 'too_many_active' });
    expect(await api.balance()).toBe(left);

    for (const generation of running) {
      expect(await api.statusOf('POST', `/api/v1/generations/${generation.id}/cancel`)).toBe(200);
      // Cancelling again is harmless.
      expect(await api.statusOf('POST', `/api/v1/generations/${generation.id}/cancel`)).toBe(200);
    }
    const ledger = await expectLedgerMatchesBalance(api, E2E_LIMITS.signupBonusCredits);
    expect(ledger.filter((entry) => entry.reason === 'refund')).toHaveLength(limit);
    expect(
      (await api.listGenerations()).every((generation) => generation.status === 'canceled'),
    ).toBe(true);
  });

  test('a finished generation cannot be cancelled, and a missing model or input is refused cleanly', async ({
    api,
  }) => {
    const done = await createDemoImage(api, uniquePrompt('Finished before the cancel'));
    expect(await api.statusOf('POST', `/api/v1/generations/${done.id}/cancel`)).toBe(409);

    const unknownModel = await api.tryCreateGeneration({
      tool: 'text-to-image',
      modelId: 'no-such-model',
      prompt: 'x',
    });
    expect(isRefusal(unknownModel) && unknownModel.status).toBe(422);

    const needsPicture = await api.tryCreateGeneration({
      tool: 'image-to-image',
      modelId: DEMO_IMAGE_MODEL,
      prompt: 'x',
    });
    expect(isRefusal(needsPicture) && needsPicture.status).toBe(422);

    const strangerPicture = await api.tryCreateGeneration({
      tool: 'image-to-video',
      modelId: DEMO_VIDEO_MODEL,
      prompt: 'x',
      inputAssetId: 'ast_00000000000000000000000000',
    });
    expect(isRefusal(strangerPicture) && strangerPicture.status).toBe(404);

    const unavailable = await api.tryCreateGeneration({
      tool: 'text-to-image',
      modelId: 'fal-flux-schnell',
      prompt: 'x',
    });
    expect(isRefusal(unavailable) && unavailable).toMatchObject({ status: 409, code: 'conflict' });
    await expectLedgerMatchesBalance(api, 49);
  });

  test('lists page by cursor without gaps or repeats, newest first', async ({ api }) => {
    const prompts: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const prompt = uniquePrompt(`Paged ${index}`);
      prompts.push(prompt);
      await createDemoImage(api, prompt);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const response = await api.request.get(`/api/v1/generations?${query}`);
      const page = (await response.json()) as {
        data: Array<{ prompt: string }>;
        nextCursor: string | null;
      };
      expect(page.data.length).toBeLessThanOrEqual(2);
      seen.push(
        ...page.data.map((generation) => generation.prompt.replace(` ${DEMO_WORDS.sync}`, '')),
      );
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([...prompts].reverse());
  });

  test('uploads accept pictures, refuse everything else and keep inputs private to their owner', async ({
    api,
    otherUser,
  }) => {
    const source = await createDemoImage(api, uniquePrompt('Picture to upload'));
    const picture = await api.bytes(source.outputs[0]?.url ?? '');

    const id = await api.uploadImage(picture, 'image/webp', 'source.webp');
    expect(id).toMatch(/^ast_/);
    expect((await api.request.get(`/api/v1/media/${id}`)).status()).toBe(200);

    const text = await api.request.post('/api/v1/uploads', {
      multipart: {
        file: { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      },
      headers: { origin: api.origin },
    });
    expect(text.status()).toBe(415);

    const disguised = await api.request.post('/api/v1/uploads', {
      multipart: {
        file: {
          name: 'evil.png',
          mimeType: 'image/png',
          buffer: Buffer.from('<svg onload="alert(1)"/>'),
        },
      },
      headers: { origin: api.origin },
    });
    expect(disguised.status()).toBe(415);

    const stranger = await otherUser();
    expect(await stranger.api.statusOf('GET', `/api/v1/media/${id}`)).toBe(404);
    const stolen = await stranger.api.tryCreateGeneration({
      tool: 'image-to-image',
      modelId: DEMO_IMAGE_MODEL,
      prompt: "Use somebody else's picture",
      inputAssetId: id,
    });
    expect(isRefusal(stolen) && stolen.status).toBe(404);
  });

  test('the model and tool catalogs describe what the studio offers', async ({ api }) => {
    const models = (await (await api.request.get('/api/v1/models')).json()) as {
      data: Array<{
        id: string;
        kind: string;
        tools: string[];
        available: boolean;
        pricing: unknown;
      }>;
    };
    const demoImage = models.data.find((model) => model.id === DEMO_IMAGE_MODEL);
    expect(demoImage).toMatchObject({
      kind: 'image',
      available: true,
      tools: ['text-to-image', 'image-to-image'],
    });
    const tools = (await (await api.request.get('/api/v1/tools')).json()) as {
      data: Array<{ id: string; needsInputImage: boolean }>;
    };
    expect(tools.data.map((tool) => tool.id).sort()).toEqual([
      'image-to-image',
      'image-to-video',
      'text-to-image',
      'text-to-video',
    ]);
    expect(
      tools.data
        .filter((tool) => tool.needsInputImage)
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(['image-to-image', 'image-to-video']);
  });
});
