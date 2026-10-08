import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateGenerationRequest } from '@/lib/api-types';
import { getModels } from '@/lib/catalog';
import { AppError } from '@/lib/errors';
import { getBalance } from '@/server/credits';
import { assets, creditLedger, generations } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { createGeneration, cancelGeneration } from '@/server/generations/service';
import { onWake } from '@/server/jobs/wake';
import { setProviderOverrides } from '@/server/providers/registry';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import {
  createAsset,
  createGeneration as insertGeneration,
  createUser,
  fakeProvider,
} from '../../helpers/factories';

const harness = freshDb();

const IMAGE: CreateGenerationRequest = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at dawn',
};

function stubEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvForTests();
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function rows() {
  return harness.db.select().from(generations).all();
}

beforeEach(() => {
  setProviderOverrides(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  setProviderOverrides(null);
});

describe('createGeneration: the happy path', () => {
  it('queues the generation, debits the credits and returns the public DTO', async () => {
    const user = createUser(harness.db);
    const { generation, created } = await createGeneration(user.id, IMAGE);

    expect(created).toBe(true);
    expect(generation).toMatchObject({
      id: expect.stringMatching(/^gen_[0-9a-hjkmnp-tv-z]{26}$/),
      tool: 'text-to-image',
      kind: 'image',
      modelId: 'aivore-demo-image',
      prompt: 'A lighthouse at dawn',
      status: 'queued',
      progress: 0,
      cost: 1,
      outputs: [],
      isPublic: false,
      isFavorite: false,
    });
    expect(generation.params).toEqual({ aspectRatio: '1:1', count: 1 });
    expect(generation.createdAt).toBeGreaterThan(0);
    expect(getBalance(harness.db, user.id)).toBe(49);

    const ledger = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, user.id))
      .all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      delta: -1,
      reason: 'generation',
      generationId: generation.id,
    });
  });

  it("stores what validation normalized: trimmed text, defaults and the model's provider", async () => {
    const user = createUser(harness.db);
    const { generation } = await createGeneration(user.id, {
      ...IMAGE,
      prompt: '   padded prompt  ',
      negativePrompt: '  blurry ',
      params: { count: 3, seed: 42 },
      isPublic: true,
    });
    const row = rows()[0];
    expect(row).toMatchObject({
      id: generation.id,
      userId: user.id,
      provider: 'mock',
      kind: 'image',
      status: 'queued',
      prompt: 'padded prompt',
      negativePrompt: 'blurry',
      params: { aspectRatio: '1:1', count: 3, seed: 42 },
      cost: 3,
      attempts: 0,
      isPublic: true,
      isFavorite: false,
      workerId: null,
      leaseUntil: null,
      providerJobId: null,
    });
    expect(generation.cost).toBe(3);
    expect(getBalance(harness.db, user.id)).toBe(47);
  });

  it('prices a video from its duration and resolution', async () => {
    const user = createUser(harness.db);
    const { generation } = await createGeneration(user.id, {
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'waves',
      params: { durationSec: 5, resolution: '720p' },
    });
    expect(generation).toMatchObject({ kind: 'video', cost: 15, status: 'queued' });
    expect(getBalance(harness.db, user.id)).toBe(35);
  });

  it('attaches the input image of an image-to-image request', async () => {
    const user = createUser(harness.db);
    const input = createAsset(harness.db, { userId: user.id });
    const { generation } = await createGeneration(user.id, {
      tool: 'image-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'make it a watercolor',
      params: { strength: 0.5 },
      inputAssetId: input.id,
    });
    expect(generation.input?.id).toBe(input.id);
    expect(rows()[0]?.inputAssetId).toBe(input.id);
  });

  it('does not moderate the negative prompt, only the prompt', async () => {
    stubEnv({ MODERATION_BLOCKLIST: 'zorblax' });
    const user = createUser(harness.db);
    const ok = await createGeneration(user.id, { ...IMAGE, negativePrompt: 'zorblax, nsfw, nude' });
    expect(ok.created).toBe(true);
  });

  it('never exposes provider, worker, idempotency or owner fields in the DTO', async () => {
    const user = createUser(harness.db);
    const { generation } = await createGeneration(user.id, IMAGE, { idempotencyKey: 'k-1' });
    const json = JSON.stringify(generation);
    for (const secret of [
      'provider',
      'worker',
      'lease',
      'attempts',
      'idempotency',
      'k-1',
      user.id,
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('wakes the worker once the generation is committed', async () => {
    const user = createUser(harness.db);
    const queuedWhenWoken: number[] = [];
    const off = onWake(() => queuedWhenWoken.push(rows().length));
    await createGeneration(user.id, IMAGE);
    off();
    // By the time the worker is woken the job must already be claimable.
    expect(queuedWhenWoken).toEqual([1]);
  });
});

describe('createGeneration: validation', () => {
  const bad: Array<[string, CreateGenerationRequest, { path: string; code: string }]> = [
    ['an unknown model', { ...IMAGE, modelId: 'nope' }, { path: 'modelId', code: 'unknown_model' }],
    [
      'a model that does not serve the tool',
      { ...IMAGE, modelId: 'aivore-demo-video' },
      { path: 'modelId', code: 'model_tool_mismatch' },
    ],
    ['an empty prompt', { ...IMAGE, prompt: '   ' }, { path: 'prompt', code: 'required' }],
    [
      'a disallowed aspect ratio',
      { ...IMAGE, params: { aspectRatio: '21:9' } },
      { path: 'params.aspectRatio', code: 'not_allowed' },
    ],
    [
      'too many images',
      { ...IMAGE, params: { count: 9 } },
      { path: 'params.count', code: 'out_of_range' },
    ],
    [
      'a missing input image',
      { ...IMAGE, tool: 'image-to-image' },
      { path: 'inputAssetId', code: 'required' },
    ],
    [
      'an input image for a text tool',
      { ...IMAGE, inputAssetId: 'ast_00000000000000000000000000' },
      { path: 'inputAssetId', code: 'unsupported' },
    ],
    [
      'an unsupported option',
      { tool: 'text-to-video', modelId: 'aivore-demo-video', prompt: 'x', params: { strength: 1 } },
      { path: 'params.strength', code: 'unsupported' },
    ],
  ];

  it.each(bad)(
    'rejects %s with a field-level 422 and charges nothing',
    async (_name, request, issue) => {
      const user = createUser(harness.db);
      const error = await failure(createGeneration(user.id, request));
      expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
      expect((error.details as { issues: unknown[] }).issues).toContainEqual(
        expect.objectContaining(issue),
      );
      expect(getBalance(harness.db, user.id)).toBe(50);
      expect(rows()).toHaveLength(0);
      expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
    },
  );

  it('reports every problem at once', async () => {
    const user = createUser(harness.db);
    const error = await failure(
      createGeneration(user.id, {
        ...IMAGE,
        prompt: '',
        params: { count: 99, aspectRatio: '21:9' },
      }),
    );
    const issues = (error.details as { issues: Array<{ path: string }> }).issues.map(
      (issue) => issue.path,
    );
    expect(issues).toEqual(
      expect.arrayContaining(['prompt', 'params.count', 'params.aspectRatio']),
    );
  });

  it('survives hostile input without throwing anything but a validation error', async () => {
    const user = createUser(harness.db);
    const hostile = [
      { ...IMAGE, prompt: 'x'.repeat(2_000_000) },
      { ...IMAGE, prompt: 12 },
      { ...IMAGE, params: 'big' },
      { ...IMAGE, params: { count: '2; DROP TABLE users' } },
      { ...IMAGE, modelId: { toString: () => 'aivore-demo-image' } },
      { ...IMAGE, __proto__: { admin: true }, extra: 1 },
      null,
      'a string',
    ] as unknown as CreateGenerationRequest[];
    for (const request of hostile) {
      expect(await failure(createGeneration(user.id, request))).toMatchObject({
        code: 'validation_failed',
      });
    }
    expect(rows()).toHaveLength(0);
    expect(getBalance(harness.db, user.id)).toBe(50);
  });

  it('rejects a Demo model when the demo provider is switched off', async () => {
    stubEnv({ ENABLE_MOCK_PROVIDER: 'false' });
    const user = createUser(harness.db);
    expect(await failure(createGeneration(user.id, IMAGE))).toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('createGeneration: moderation', () => {
  it('blocks a prompt on the blocklist before anything is charged', async () => {
    stubEnv({ MODERATION_BLOCKLIST: 'zorblax' });
    const user = createUser(harness.db);
    const error = await failure(
      createGeneration(user.id, { ...IMAGE, prompt: 'a zorblax in a field' }),
    );
    expect(error).toMatchObject({ code: 'moderation_blocked', status: 422 });
    expect(error.details).toEqual({ category: 'blocklist' });
    expect(JSON.stringify(error)).not.toContain('zorblax');
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(rows()).toHaveLength(0);
  });

  it('blocks look-alike spellings too (the shared moderation rules apply)', async () => {
    stubEnv({ MODERATION_BLOCKLIST: 'zorblax' });
    const user = createUser(harness.db);
    expect(
      await failure(createGeneration(user.id, { ...IMAGE, prompt: 'z o r b l a x' })),
    ).toMatchObject({ code: 'moderation_blocked' });
  });
});

describe('createGeneration: model availability', () => {
  const falModel = getModels().find(
    (model) => model.provider === 'fal' && model.tools.includes('text-to-image'),
  );

  it('refuses a model whose provider is not configured, with a clear reason', async () => {
    expect(falModel).toBeDefined();
    setProviderOverrides({ fal: fakeProvider({ id: 'fal', configured: false }) });
    const user = createUser(harness.db);
    const error = await failure(
      createGeneration(user.id, { ...IMAGE, modelId: falModel?.id ?? '', prompt: 'x' }),
    );
    expect(error).toMatchObject({ code: 'conflict', status: 409 });
    expect(error.details).toEqual({ reason: 'model_unavailable', modelId: falModel?.id });
    expect(getBalance(harness.db, user.id)).toBe(50);
  });

  it('accepts the same model once its provider is configured', async () => {
    setProviderOverrides({ fal: fakeProvider({ id: 'fal', configured: true }) });
    const user = createUser(harness.db, { creditBalance: 500 });
    const { generation } = await createGeneration(user.id, {
      ...IMAGE,
      modelId: falModel?.id ?? '',
      prompt: 'x',
    });
    expect(generation.status).toBe('queued');
    expect(rows()[0]?.provider).toBe('fal');
  });
});

describe('createGeneration: the input image', () => {
  const request = (inputAssetId: string): CreateGenerationRequest => ({
    tool: 'image-to-image',
    modelId: 'aivore-demo-image',
    prompt: 'restyle',
    inputAssetId,
  });

  it("answers the same not_found for a missing asset and for somebody else's", async () => {
    const user = createUser(harness.db);
    const stranger = createUser(harness.db);
    const theirs = createAsset(harness.db, { userId: stranger.id });

    const missing = await failure(
      createGeneration(user.id, request('ast_00000000000000000000000000')),
    );
    const foreign = await failure(createGeneration(user.id, request(theirs.id)));
    expect(missing).toMatchObject({ code: 'not_found', status: 404 });
    expect(foreign.code).toBe(missing.code);
    expect(foreign.message).toBe(missing.message);
    expect(foreign.details).toEqual(missing.details);
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(rows()).toHaveLength(0);
  });

  it('refuses an output image as input', async () => {
    const user = createUser(harness.db);
    const source = insertGeneration(harness.db, { userId: user.id, status: 'succeeded' });
    const output = createAsset(harness.db, {
      userId: user.id,
      role: 'output',
      generationId: source.id,
    });
    expect(await failure(createGeneration(user.id, request(output.id)))).toMatchObject({
      code: 'not_found',
    });
  });

  it('treats a malformed asset id like any other id that matches nothing', async () => {
    const user = createUser(harness.db);
    expect(await failure(createGeneration(user.id, request('../../etc/passwd')))).toMatchObject({
      code: 'not_found',
    });
  });
});

describe('createGeneration: credits and limits', () => {
  it('refuses when the balance is too low and leaves everything untouched', async () => {
    const user = createUser(harness.db, { creditBalance: 2 });
    const error = await failure(createGeneration(user.id, { ...IMAGE, params: { count: 4 } }));
    expect(error).toMatchObject({ code: 'insufficient_credits', status: 402 });
    expect(error.details).toEqual({ required: 4, balance: 2 });
    expect(getBalance(harness.db, user.id)).toBe(2);
    expect(rows()).toHaveLength(0);
  });

  it('can spend the very last credit and then refuses the next one', async () => {
    const user = createUser(harness.db, { creditBalance: 1 });
    await createGeneration(user.id, IMAGE);
    expect(getBalance(harness.db, user.id)).toBe(0);
    expect(await failure(createGeneration(user.id, IMAGE))).toMatchObject({
      code: 'insufficient_credits',
    });
    expect(rows()).toHaveLength(1);
    expectConsistentLedger(harness.db, user.id, 1);
  });

  it('rolls the debit back when the insert fails (one transaction)', async () => {
    const user = createUser(harness.db);
    harness.db.$client.exec(
      "CREATE TRIGGER block_generations BEFORE INSERT ON generations BEGIN SELECT RAISE(ABORT, 'insert refused'); END;",
    );
    await expect(createGeneration(user.id, IMAGE)).rejects.toThrow(/insert refused/);
    expect(getBalance(harness.db, user.id)).toBe(50);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
  });

  it('limits the generations a user can have running, and only counts running ones', async () => {
    stubEnv({ MAX_ACTIVE_PER_USER: '2' });
    const user = createUser(harness.db);
    const other = createUser(harness.db);
    const first = await createGeneration(user.id, IMAGE);
    await createGeneration(user.id, IMAGE);

    const error = await failure(createGeneration(user.id, IMAGE));
    expect(error).toMatchObject({ code: 'too_many_active', status: 429 });
    expect(error.details).toEqual({ limit: 2 });
    expect(getBalance(harness.db, user.id)).toBe(48);

    // Somebody else is not affected, and finishing a job frees a slot.
    expect((await createGeneration(other.id, IMAGE)).created).toBe(true);
    await cancelGeneration(user.id, first.generation.id);
    expect((await createGeneration(user.id, IMAGE)).created).toBe(true);
  });

  it('counts processing jobs but not finished ones', async () => {
    stubEnv({ MAX_ACTIVE_PER_USER: '1' });
    const user = createUser(harness.db);
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      insertGeneration(harness.db, { userId: user.id, status });
    }
    insertGeneration(harness.db, {
      userId: user.id,
      status: 'processing',
      workerId: 'w',
      leaseUntil: 1,
    });
    expect(await failure(createGeneration(user.id, IMAGE))).toMatchObject({
      code: 'too_many_active',
    });
  });

  it('keeps the ledger consistent when requests race inside one process', async () => {
    stubEnv({ MAX_ACTIVE_PER_USER: '100' });
    const user = createUser(harness.db, { creditBalance: 5 });
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => createGeneration(user.id, IMAGE)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5);
    expect(getBalance(harness.db, user.id)).toBe(0);
    expect(rows()).toHaveLength(5);
    expectConsistentLedger(harness.db, user.id, 5);
  });
});

describe('createGeneration: idempotency', () => {
  it('returns the original generation for a replay and charges only once', async () => {
    const user = createUser(harness.db);
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: 'abc-123' });
    const again = await createGeneration(user.id, IMAGE, { idempotencyKey: 'abc-123' });

    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.generation.id).toBe(first.generation.id);
    expect(rows()).toHaveLength(1);
    expect(getBalance(harness.db, user.id)).toBe(49);
    expect(ledgerInOrder(harness.db, user.id)).toHaveLength(1);
  });

  it('does not mind parameters that were left undefined', async () => {
    const user = createUser(harness.db);
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: 'u' });
    const again = await createGeneration(
      user.id,
      { ...IMAGE, params: { seed: undefined, count: 1, strength: undefined } },
      { idempotencyKey: 'u' },
    );
    expect(again).toMatchObject({ created: false, generation: { id: first.generation.id } });
  });

  it('treats an equivalent request (defaults spelled out, padding) as the same request', async () => {
    const user = createUser(harness.db);
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: 'same' });
    const again = await createGeneration(
      user.id,
      { ...IMAGE, prompt: '  A lighthouse at dawn ', params: { aspectRatio: '1:1', count: 1 } },
      { idempotencyKey: 'same' },
    );
    expect(again.generation.id).toBe(first.generation.id);
  });

  it('reflects the current state in the replay (a finished generation stays finished)', async () => {
    const user = createUser(harness.db);
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    await cancelGeneration(user.id, first.generation.id);
    const again = await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    expect(again).toMatchObject({ created: false, generation: { status: 'canceled' } });
    expect(getBalance(harness.db, user.id)).toBe(50);
  });

  it('refuses to reuse a key for a different request instead of returning the wrong generation', async () => {
    const user = createUser(harness.db);
    await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    for (const different of [
      { ...IMAGE, prompt: 'something else' },
      { ...IMAGE, params: { count: 2 } },
      { ...IMAGE, negativePrompt: 'blurry' },
      { ...IMAGE, params: { seed: 5 } },
    ]) {
      const error = await failure(createGeneration(user.id, different, { idempotencyKey: 'k' }));
      expect(error).toMatchObject({ code: 'conflict', status: 409 });
      expect(error.details).toEqual({ reason: 'idempotency_key_reused' });
    }
    expect(rows()).toHaveLength(1);
    expect(getBalance(harness.db, user.id)).toBe(49);
  });

  it('scopes keys to the user', async () => {
    const [a, b] = [createUser(harness.db), createUser(harness.db)];
    const first = await createGeneration(a.id, IMAGE, { idempotencyKey: 'shared' });
    const second = await createGeneration(b.id, IMAGE, { idempotencyKey: 'shared' });
    expect(second.created).toBe(true);
    expect(second.generation.id).not.toBe(first.generation.id);
    expect(getBalance(harness.db, a.id)).toBe(49);
    expect(getBalance(harness.db, b.id)).toBe(49);
  });

  it('answers a replay even if the user is now at the active limit or out of credits', async () => {
    stubEnv({ MAX_ACTIVE_PER_USER: '1' });
    const user = createUser(harness.db, { creditBalance: 1 });
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    const again = await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    expect(again).toMatchObject({ created: false, generation: { id: first.generation.id } });
  });

  it('does not wake the worker for a replay', async () => {
    const user = createUser(harness.db);
    await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    const wake = vi.fn();
    const off = onWake(wake);
    await createGeneration(user.id, IMAGE, { idempotencyKey: 'k' });
    off();
    expect(wake).not.toHaveBeenCalled();
  });

  it('creates exactly one generation when the same request arrives many times at once', async () => {
    const user = createUser(harness.db);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        createGeneration(user.id, IMAGE, { idempotencyKey: 'burst' }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.generation.id)).size).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(getBalance(harness.db, user.id)).toBe(49);
    expectConsistentLedger(harness.db, user.id, 50);
  });

  it.each(['', ' ', 'has space', 'x'.repeat(129), 'café', 'tab\tkey', 'new\nline'])(
    'rejects the malformed key %j',
    async (key) => {
      const user = createUser(harness.db);
      const error = await failure(createGeneration(user.id, IMAGE, { idempotencyKey: key }));
      expect(error).toMatchObject({ code: 'validation_failed' });
      expect(rows()).toHaveLength(0);
    },
  );

  it('accepts the longest allowed key', async () => {
    const user = createUser(harness.db);
    const key = 'k'.repeat(128);
    const first = await createGeneration(user.id, IMAGE, { idempotencyKey: key });
    expect(first.created).toBe(true);
    expect(rows()[0]?.idempotencyKey).toBe(key);
  });

  it('survives an input asset that was deleted after the first request', async () => {
    const user = createUser(harness.db);
    const input = createAsset(harness.db, { userId: user.id });
    const request: CreateGenerationRequest = {
      tool: 'image-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'restyle',
      inputAssetId: input.id,
    };
    const first = await createGeneration(user.id, request, { idempotencyKey: 'k' });
    harness.db.delete(assets).where(eq(assets.id, input.id)).run();
    // The foreign key sets the column to null; a replay is still the same request.
    await expect(
      createGeneration(user.id, request, { idempotencyKey: 'k' }),
    ).resolves.toMatchObject({
      created: false,
      generation: { id: first.generation.id },
    });
  });
});
