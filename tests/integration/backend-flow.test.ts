import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type { AssetDTO, GenerationDTO, LedgerEntryDTO, ModelDTO, UserDTO } from '@/lib/api-types';
import { register } from '@/instrumentation';
import { computeCost, getModel } from '@/lib/catalog';
import { newId } from '@/lib/id';
import { assets } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { stopWorker } from '@/server/jobs/start';
import { expectConsistentLedger } from '../helpers/credits';
import { makePng } from '../server/uploads/support';
import { dataOf, errorOf } from './helpers/api';
import {
  IMAGE_MODEL,
  VIDEO_MODEL,
  createWorld,
  runToCompletion,
  textToImage,
  textToVideo,
  waitFor,
} from './helpers/world';

// The product's first-run experience, end to end and in-process: real auth (cookies, API keys),
// real credits, the real Demo provider, real local storage in a temp directory and a real job
// runner over a real database. Route handlers are called with real Requests; nothing from
// `@/server/**` is mocked. Time runs 10x faster so a "4 s" Demo job takes under a second.

// Real image and GIF encoding, scrypt and a job loop: slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('a new user from sign-up to a viewable image', () => {
  it('registers, lists models, uploads, generates, streams the result and balances the books', async () => {
    const alice = await world.signUp('Alice');

    // -- register: a session cookie that cannot be read by scripts, 50 free credits
    expect(alice.user).toMatchObject({
      email: alice.email,
      name: 'Alice',
      role: 'user',
      locale: 'en',
      creditBalance: 50,
    });
    expect(Object.keys(alice.user).toSorted()).toEqual(
      [
        'createdAt',
        'creditBalance',
        'email',
        'emailVerificationRequired',
        'emailVerified',
        'id',
        'locale',
        'name',
        'pendingBonusCredits',
        'role',
      ].toSorted(),
    );
    // No SMTP here, so confirmation is not asked for and no bonus waits for it.
    expect(alice.user).toMatchObject({ emailVerificationRequired: false, pendingBonusCredits: 0 });
    const sessionCookie = alice.setCookies.find((line) => line.startsWith('aivore_session='));
    expect(sessionCookie).toMatch(/HttpOnly/);
    expect(sessionCookie).toMatch(/SameSite=Lax/);
    expect(sessionCookie).toMatch(/Path=\//);

    // -- who am I: the cookie works, an anonymous caller gets null (never a 401)
    const me = await alice.get<UserDTO>('/auth/me', {
      headers: { 'x-request-id': 'trace-me-123' },
    });
    expect(dataOf(me)).toEqual(alice.user);
    expect(me.headers.get('x-request-id')).toBe('trace-me-123');
    expect(me.headers.get('cache-control')).toBe('no-store');
    expect(dataOf(await world.anonymous().get<UserDTO | null>('/auth/me'))).toBeNull();

    // -- models: the Demo models are usable, every real provider is "needs a key"
    const models = dataOf(await alice.get<ModelDTO[]>('/models'));
    const byId = new Map(models.map((model) => [model.id, model]));
    expect(byId.get(IMAGE_MODEL)).toMatchObject({ provider: 'mock', available: true });
    expect(byId.get(VIDEO_MODEL)).toMatchObject({ provider: 'mock', available: true });
    expect(byId.get('fal-flux-schnell')).toMatchObject({
      provider: 'fal',
      available: false,
      unavailableReason: 'not_configured',
    });
    expect(JSON.stringify(models)).not.toContain('providerModel');

    // -- upload an input image
    const png = await makePng(64, 48);
    const uploaded = dataOf(await alice.upload<AssetDTO>(png), 201);
    expect(uploaded).toMatchObject({ kind: 'image', mimeType: 'image/png', width: 64, height: 48 });
    expect(uploaded.thumbUrl).toBe(`${uploaded.url}?variant=thumb`);
    const uploadedBack = await alice.media(uploaded.url);
    expect(uploadedBack.status).toBe(200);
    expect(await sharp(uploadedBack.bytes).metadata()).toMatchObject({
      format: 'png',
      width: 64,
      height: 48,
    });

    // -- start a text-to-image generation: debited immediately, queued
    const created = await alice.post<GenerationDTO>(
      '/generations',
      textToImage('a lighthouse at sunset', { params: { aspectRatio: '16:9', seed: 7 } }),
      { headers: { 'idempotency-key': 'first-run-1' } },
    );
    const queued = dataOf(created, 201);
    expect(created.headers.get('location')).toBe(`/api/v1/generations/${queued.id}`);
    expect(queued).toMatchObject({
      tool: 'text-to-image',
      modelId: IMAGE_MODEL,
      status: 'queued',
      progress: 0,
      cost: 1,
      outputs: [],
      isPublic: false,
    });
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);

    // -- the worker takes it from here
    const done = await runToCompletion(alice, queued.id, world.runner());
    expect(done).toMatchObject({ status: 'succeeded', progress: 100, cost: 1 });
    expect(done.error).toBeUndefined();
    expect(done.createdAt).toBeLessThanOrEqual(done.startedAt ?? 0);
    expect(done.startedAt).toBeLessThanOrEqual(done.finishedAt ?? 0);
    expect(done.outputs).toHaveLength(1);
    const [output] = done.outputs;
    expect(output).toMatchObject({
      kind: 'image',
      mimeType: 'image/webp',
      width: 1280,
      height: 720,
    });
    expect(output?.thumbUrl).toBeTruthy();
    if (!output) return;

    // -- the result streams back intact: right type, right bytes, hardened headers
    const full = await alice.media(output.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('image/webp');
    expect(full.headers.get('x-content-type-options')).toBe('nosniff');
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-disposition')).toBe('inline');
    expect(full.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(full.headers.get('content-length')).toBe(String(output.bytes));
    expect(full.bytes.byteLength).toBe(output.bytes);
    expect(await sharp(full.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 1280,
      height: 720,
    });
    const row = world.db.select().from(assets).where(eq(assets.id, output.id)).get();
    expect(row?.sha256).toBe(sha256(full.bytes));

    // range requests (what a video element or a resumable download sends)
    const head = await alice.media(output.url, { headers: { range: 'bytes=0-99' } });
    expect(head.status).toBe(206);
    expect(head.headers.get('content-range')).toBe(`bytes 0-99/${output.bytes}`);
    expect(head.bytes).toEqual(full.bytes.subarray(0, 100));
    const tail = await alice.media(output.url, { headers: { range: 'bytes=-50' } });
    expect(tail.status).toBe(206);
    expect(tail.bytes).toEqual(full.bytes.subarray(full.bytes.byteLength - 50));
    const beyond = await alice.media(output.url, {
      headers: { range: `bytes=${output.bytes + 10}-` },
    });
    expect(beyond.status).toBe(416);
    expect(beyond.headers.get('content-range')).toBe(`bytes */${output.bytes}`);

    // conditional requests and HEAD
    const etag = full.headers.get('etag');
    expect(etag).toBeTruthy();
    const notModified = await alice.media(output.url, { headers: { 'if-none-match': etag ?? '' } });
    expect(notModified.status).toBe(304);
    expect(notModified.bytes.byteLength).toBe(0);
    const headOnly = await alice.media(output.url, { method: 'HEAD' });
    expect(headOnly.status).toBe(200);
    expect(headOnly.bytes.byteLength).toBe(0);
    expect(headOnly.headers.get('content-length')).toBe(String(output.bytes));

    // download flag and thumbnail
    const download = await alice.media(`${output.url}?download=1`);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="aivore-/);
    const thumb = await alice.media(output.thumbUrl ?? '');
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    expect(thumb.headers.get('accept-ranges')).toBe('none');
    expect(thumb.bytes.byteLength).toBeLessThan(full.bytes.byteLength);
    expect(await sharp(thumb.bytes).metadata()).toMatchObject({ format: 'webp' });

    // -- the files are really on disk, under the owner's folder
    const folder = `u/${alice.user.id}`;
    expect(world.storedFiles()).toEqual(
      [
        `${folder}/uploads/${uploaded.id}.png`,
        `${folder}/uploads/${uploaded.id}.thumb.webp`,
        `${folder}/${done.id}/${output.id}.webp`,
        `${folder}/${done.id}/${output.id}.thumb.webp`,
      ].toSorted(),
    );

    // -- the books balance: one debit for the one image, nothing else
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);
    const ledger = dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger'));
    expect(
      ledger.map(({ reason, delta, balanceAfter }) => ({ reason, delta, balanceAfter })),
    ).toEqual([
      { reason: 'generation', delta: -1, balanceAfter: 49 },
      { reason: 'signup_bonus', delta: 50, balanceAfter: 50 },
    ]);
    expect(ledger[0]?.generationId).toBe(done.id);
    expectConsistentLedger(world.db, alice.user.id, 0);

    // -- and the generation shows up in the gallery listing with its output
    const listing = await alice.get<GenerationDTO[]>('/generations');
    expect(dataOf(listing).map((item) => item.id)).toEqual([done.id]);
    expect(dataOf(listing)[0]?.outputs[0]?.id).toBe(output.id);
  });

  it('serves the same request with the same seed as the same image, with different ids', async () => {
    const alice = await world.signUp('Alice');
    const runner = world.runner();
    const request = textToImage('a quiet forest', { params: { seed: 99 } });
    const first = dataOf(await alice.post<GenerationDTO>('/generations', request), 201);
    const second = dataOf(await alice.post<GenerationDTO>('/generations', request), 201);
    expect(second.id).not.toBe(first.id);

    const [a, b] = await Promise.all([
      runToCompletion(alice, first.id, runner),
      runToCompletion(alice, second.id, runner),
    ]);
    const bytesOf = async (generation: GenerationDTO) =>
      (await alice.media(generation.outputs[0]?.url ?? '')).bytes;
    expect(a.outputs[0]?.id).not.toBe(b.outputs[0]?.id);
    expect(sha256(await bytesOf(a))).toBe(sha256(await bytesOf(b)));
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(48);
  });

  it('offers real models only when their provider is configured, and never runs an unavailable one', async () => {
    const alice = await world.signUp('Alice');

    const fal = (models: ModelDTO[]) => models.filter((model) => model.provider === 'fal');
    const without = fal(dataOf(await alice.get<ModelDTO[]>('/models')));
    expect(without.length).toBeGreaterThan(0);
    expect(without.every((model) => !model.available)).toBe(true);

    // Not configured: refused before anything is debited or queued.
    const refused = await alice.post('/generations', {
      tool: 'text-to-image',
      modelId: 'fal-flux-schnell',
      prompt: 'a lighthouse',
    });
    expect(errorOf(refused, 409)).toBe('conflict');
    expect(refused.json.error?.details).toMatchObject({ reason: 'model_unavailable' });
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(50);

    // Availability follows the key (a placeholder: nothing here ever calls fal).
    vi.stubEnv('FAL_KEY', 'placeholder-not-a-real-key');
    resetEnvForTests();
    const withKey = fal(dataOf(await alice.get<ModelDTO[]>('/models')));
    expect(withKey.every((model) => model.available)).toBe(true);
    expect(withKey.every((model) => model.unavailableReason === undefined)).toBe(true);
    const mock = dataOf(await alice.get<ModelDTO[]>('/models')).find((m) => m.id === IMAGE_MODEL);
    expect(mock?.available).toBe(true);
  });

  it('hides the Demo models completely when the Demo provider is switched off', async () => {
    vi.stubEnv('ENABLE_MOCK_PROVIDER', 'false');
    resetEnvForTests();
    const alice = await world.signUp('Alice');

    const models = dataOf(await alice.get<ModelDTO[]>('/models'));
    expect(models.some((model) => model.provider === 'mock')).toBe(false);

    const reply = await alice.post('/generations', textToImage('a lighthouse'));
    expect(reply.status).toBe(422);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(50);
    expect(world.storedFiles()).toEqual([]);
  });

  it('lists the four tools', async () => {
    const tools = dataOf(await world.anonymous().get<Array<{ id: string }>>('/tools'));
    expect(tools.map((tool) => tool.id).toSorted()).toEqual([
      'image-to-image',
      'image-to-video',
      'text-to-image',
      'text-to-video',
    ]);
  });
});

describe('every tool with the Demo models', () => {
  it('shows a job moving through queued, processing and succeeded, with progress that only goes forward', async () => {
    const alice = await world.signUp('Alice');
    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('a slowly forming lake')),
      201,
    );
    const running = world.runner().tick();
    const seen: Array<{ status: string; progress: number }> = [];
    for (;;) {
      const current = dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`));
      seen.push({ status: current.status, progress: current.progress });
      if (current.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await running;

    const progress = seen.map((sample) => sample.progress);
    expect(progress).toEqual([...progress].toSorted((a, b) => a - b));
    expect(seen.at(-1)).toEqual({ status: 'succeeded', progress: 100 });
    expect(seen.some((s) => s.status === 'processing' && s.progress > 0 && s.progress < 100)).toBe(
      true,
    );
    expect(new Set(seen.map((sample) => sample.status))).toEqual(
      new Set(['processing', 'succeeded']),
    );
  });

  it('image-to-image keeps the input proportions and records the input image', async () => {
    const alice = await world.signUp('Alice');
    const input = dataOf(await alice.upload<AssetDTO>(await makePng(96, 64)), 201);

    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', {
        tool: 'image-to-image',
        modelId: IMAGE_MODEL,
        prompt: 'make it warmer',
        params: { strength: 0.7 },
        inputAssetId: input.id,
      }),
      201,
    );
    expect(created.input?.id).toBe(input.id);

    const done = await runToCompletion(alice, created.id, world.runner());
    expect(done).toMatchObject({ status: 'succeeded', tool: 'image-to-image', cost: 1 });
    expect(done.input?.id).toBe(input.id);
    expect(done.outputs).toHaveLength(1);
    expect(done.outputs[0]).toMatchObject({ kind: 'image', mimeType: 'image/webp' });
    expect(done.outputs[0]).toMatchObject({ width: 96, height: 64 });

    const result = await alice.media(done.outputs[0]?.url ?? '');
    const original = await alice.media(input.url);
    expect(result.status).toBe(200);
    expect(sha256(result.bytes)).not.toBe(sha256(original.bytes));
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);
  });

  it('text-to-video makes a valid looping GIF and charges per second', async () => {
    const alice = await world.signUp('Alice');
    const params = { durationSec: 3, resolution: '480p' } as const;
    const model = getModel(VIDEO_MODEL);
    if (!model) throw new Error('the Demo video model is missing from the catalog');
    const expectedCost = computeCost(model, { aspectRatio: '16:9', count: 1, ...params });
    expect(expectedCost).toBe(6);

    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', textToVideo('waves on a beach', { params })),
      201,
    );
    expect(created.cost).toBe(expectedCost);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(50 - expectedCost);

    const done = await runToCompletion(alice, created.id, world.runner());
    expect(done.status).toBe('succeeded');
    const [clip] = done.outputs;
    expect(clip).toMatchObject({ kind: 'video', mimeType: 'image/gif', durationMs: 3000 });
    if (!clip) return;

    const served = await alice.media(clip.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/gif');
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new TextDecoder().decode(served.bytes.subarray(0, 6))).toMatch(/^GIF8[79]a$/);
    const meta = await sharp(served.bytes, { animated: true }).metadata();
    expect(meta.format).toBe('gif');
    expect(meta.pages).toBeGreaterThan(1);
    expect(Math.max(meta.width ?? 0, meta.pageHeight ?? 0)).toBeLessThanOrEqual(480);

    const partial = await alice.media(clip.url, { headers: { range: 'bytes=0-9' } });
    expect(partial.status).toBe(206);
    expect(partial.bytes).toEqual(served.bytes.subarray(0, 10));
    // A video card gets a still preview (the first frame) like every picture does, so a gallery
    // grid does not have to download every clip.
    expect(clip.thumbUrl).toBeTruthy();
    const still = await alice.media(clip.thumbUrl ?? '');
    expect(still.status).toBe(200);
    expect(still.headers.get('content-type')).toBe('image/webp');
    expect(still.bytes.byteLength).toBeLessThan(served.bytes.byteLength / 4);
    const download = await alice.media(`${clip.url}?download=1`);
    expect(download.headers.get('content-disposition')).toMatch(
      /^attachment; filename="aivore-video-\w+\.gif"$/,
    );

    expectConsistentLedger(world.db, alice.user.id, 0);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(50 - expectedCost);
  });

  it('image-to-video animates an uploaded image, priced for its duration and resolution', async () => {
    const alice = await world.signUp('Alice');
    const input = dataOf(await alice.upload<AssetDTO>(await makePng(80, 60)), 201);
    const params = { durationSec: 5, resolution: '720p' } as const;
    const model = getModel(VIDEO_MODEL);
    if (!model) throw new Error('the Demo video model is missing from the catalog');
    const expectedCost = computeCost(model, { aspectRatio: '16:9', count: 1, ...params });
    expect(expectedCost).toBe(15);

    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', {
        tool: 'image-to-video',
        modelId: VIDEO_MODEL,
        prompt: 'a slow push in',
        params,
        inputAssetId: input.id,
      }),
      201,
    );
    expect(created.cost).toBe(expectedCost);

    const done = await runToCompletion(alice, created.id, world.runner());
    expect(done).toMatchObject({ status: 'succeeded', tool: 'image-to-video' });
    expect(done.input?.id).toBe(input.id);
    expect(done.outputs[0]).toMatchObject({
      kind: 'video',
      mimeType: 'image/gif',
      durationMs: 5000,
    });

    const served = await alice.media(done.outputs[0]?.url ?? '');
    const meta = await sharp(served.bytes, { animated: true }).metadata();
    expect(meta.pages).toBeGreaterThan(1);
    // The clip keeps the picture's 4:3 proportions.
    expect((meta.width ?? 0) / (meta.pageHeight ?? 1)).toBeCloseTo(80 / 60, 1);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(50 - expectedCost);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('several images in one request: one price, ordered distinct outputs', async () => {
    const alice = await world.signUp('Alice');
    const created = dataOf(
      await alice.post<GenerationDTO>(
        '/generations',
        textToImage('three moons', { params: { count: 3, aspectRatio: '1:1' } }),
      ),
      201,
    );
    expect(created.cost).toBe(3);

    const done = await runToCompletion(alice, created.id, world.runner());
    expect(done.status).toBe('succeeded');
    expect(done.outputs).toHaveLength(3);
    const hashes = new Set<string>();
    for (const output of done.outputs) {
      const served = await alice.media(output.url);
      expect(await sharp(served.bytes).metadata()).toMatchObject({ width: 1024, height: 1024 });
      hashes.add(sha256(served.bytes));
    }
    expect(hashes.size).toBe(3);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(47);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('a running worker picks up a new generation as soon as it is queued (wake), with no tick', async () => {
    const alice = await world.signUp('Alice');
    // An idle poll of 10 minutes of (warped) time: only the wake-up can start this job in time.
    const runner = world.runner({ tuning: { idleMs: 600_000 } });
    runner.start();
    // Let the loop reach its idle wait first.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('a quick sketch')),
      201,
    );
    const done = await waitFor('the woken worker to finish the job', async () => {
      const current = dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`));
      return current.status === 'succeeded' ? current : undefined;
    });
    expect(done.outputs).toHaveLength(1);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);
  });
});

describe('the gallery over real generations', () => {
  it('filters, searches (Arabic too), pages by cursor and batch-polls', async () => {
    vi.stubEnv('MAX_ACTIVE_PER_USER', '10');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    const runner = world.runner();
    const make = async (body: unknown) =>
      dataOf(await alice.post<GenerationDTO>('/generations', body), 201);

    const sunset = await runToCompletion(
      alice,
      (await make(textToImage('غروب الشمس على البحر'))).id,
      runner,
    );
    const lake = await runToCompletion(alice, (await make(textToImage('a quiet lake'))).id, runner);
    const broken = await runToCompletion(
      alice,
      (await make(textToImage('a broken lake __fail__'))).id,
      runner,
    );
    const waiting = await make(textToImage('a waiting lake'));
    const clip = await make(textToVideo('waves for later'));
    dataOf(await alice.patch<GenerationDTO>(`/generations/${lake.id}`, { isFavorite: true }));

    const ids = (reply: { json: { data?: GenerationDTO[] } }) => reply.json.data?.map((g) => g.id);
    const list = (query: Record<string, string | number>) =>
      alice.get<GenerationDTO[]>('/generations', { query });

    // Newest first; the prompt survives byte for byte, Arabic included.
    const all = await list({});
    expect(ids(all)).toEqual([clip.id, waiting.id, broken.id, lake.id, sunset.id]);
    expect(all.json.data?.at(-1)?.prompt).toBe('غروب الشمس على البحر');

    expect(ids(await list({ status: 'succeeded' }))).toEqual([lake.id, sunset.id]);
    expect(ids(await list({ status: 'failed' }))).toEqual([broken.id]);
    expect(ids(await list({ status: 'queued' }))).toEqual([clip.id, waiting.id]);
    expect(ids(await list({ kind: 'video' }))).toEqual([clip.id]);
    expect(ids(await list({ favorite: 'true' }))).toEqual([lake.id]);
    expect(ids(await list({ q: 'lake' }))).toEqual([waiting.id, broken.id, lake.id]);
    expect(ids(await list({ q: 'الشمس' }))).toEqual([sunset.id]);
    expect(ids(await list({ q: '100%' }))).toEqual([]);

    // Cursor pages cover everything once, in order.
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const reply = await list({ limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...(ids(reply) ?? []));
      cursor = reply.json.nextCursor ?? undefined;
      if (!cursor) break;
    }
    expect(seen).toEqual([clip.id, waiting.id, broken.id, lake.id, sunset.id]);

    // The studio polls just the running ones, by id.
    const polled = await list({ ids: `${clip.id},${waiting.id}` });
    expect(ids(polled)?.toSorted()).toEqual([clip.id, waiting.id].toSorted());
    expect(polled.json.data?.every((g) => g.status === 'queued')).toBe(true);
    expect(ids(await list({ ids: newId('gen') }))).toEqual([]); // unknown ids simply drop out
    expect((await list({ ids: 'not-an-id' })).status).toBe(422);
    const tooMany = Array.from({ length: 51 }, () => newId('gen')).join(',');
    expect((await list({ ids: tooMany })).status).toBe(422);

    // Bad queries are 422, not a silent default.
    expect((await list({ limit: 0 })).status).toBe(422);
    expect((await list({ status: 'finished' })).status).toBe(422);
    expect((await list({ cursor: 'garbage' })).status).toBe(400);
  });
});

describe('the inline worker started by the server', () => {
  it('runs jobs created through the API once instrumentation has started it', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('WORKER_MODE', 'inline');
    resetEnvForTests();
    try {
      await register();
      const alice = await world.signUp('Alice');
      const created = dataOf(
        await alice.post<GenerationDTO>('/generations', textToImage('started by the server')),
        201,
      );
      const done = await waitFor('the inline worker to finish', async () => {
        const current = dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`));
        return current.status === 'succeeded' ? current : undefined;
      });
      expect(done.outputs).toHaveLength(1);
      expect((await alice.media(done.outputs[0]?.url ?? '')).status).toBe(200);
      expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);
    } finally {
      await stopWorker();
    }
  });
});
