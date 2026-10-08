import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ASPECT_RATIOS } from '@/lib/catalog/types';
import { debitCredits } from '@/server/credits';
import { hashToken } from '@/server/auth/tokens';
import { sessions } from '@/server/db/schema';
import { route } from '@/server/http/route';
import { setProviderOverrides, getProvider } from '@/server/providers/registry';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { createTestDb, freshDb, type TestDb } from './db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
  createUserWithSession,
} from './factories';
import {
  TINY_GIF,
  TINY_PNG,
  fakeProvider,
  fakeProviderContext,
  fakeStorage,
  streamToBytes,
} from './fakes';
import { invokeRoute } from './http';
import { expectConsistentLedger } from './credits';

const open: TestDb[] = [];
function testDb() {
  const created = createTestDb();
  open.push(created);
  return created.db;
}

afterEach(() => {
  while (open.length) open.pop()?.close();
  setProviderOverrides(null);
});

describe('createUser', () => {
  it('inserts a usable account with 50 credits and the database defaults', () => {
    const user = createUser(testDb());
    expect(user).toMatchObject({ role: 'user', locale: 'ar', creditBalance: 50 });
    expect(user.id).toMatch(/^usr_/);
  });

  it('lowercases and trims the email like the app does and applies overrides', () => {
    const user = createUser(testDb(), {
      email: '  Layla@Example.COM ',
      role: 'admin',
      locale: 'en',
      creditBalance: 0,
    });
    expect(user).toMatchObject({
      email: 'layla@example.com',
      role: 'admin',
      locale: 'en',
      creditBalance: 0,
    });
  });
});

describe('createSession', () => {
  it('stores only the hash of the token and hands back a ready cookie and headers', () => {
    const db = testDb();
    const user = createUser(db);
    const session = createSession(db, user.id);

    const row = db.select().from(sessions).where(eq(sessions.id, session.id)).get();
    expect(row?.userId).toBe(user.id);
    expect(row?.tokenHash).toBe(hashToken(session.token));
    expect(JSON.stringify(row)).not.toContain(session.token);

    expect(session.cookie).toBe(`aivore_session=${session.token}`);
    expect(session.headers).toEqual({ cookie: session.cookie, origin: 'http://localhost:3000' });
    expect(session.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it('gives every session its own token, and honours expiresAt and client details', () => {
    const db = testDb();
    const user = createUser(db);
    const a = createSession(db, user.id, { expiresAt: 5, userAgent: 'vitest', ip: '203.0.113.9' });
    const b = createSession(db, user.id);
    expect(a.token).not.toBe(b.token);
    expect(a.row).toMatchObject({ expiresAt: 5, userAgent: 'vitest', ip: '203.0.113.9' });
  });

  it('createUserWithSession returns both', () => {
    const db = testDb();
    const { user, session } = createUserWithSession(db, { name: 'Sara' });
    expect(user.name).toBe('Sara');
    expect(session.userId).toBe(user.id);
  });
});

describe('createGeneration and createAsset', () => {
  it('defaults to a queued Demo text-to-image generation', () => {
    const db = testDb();
    const user = createUser(db);
    const generation = createGeneration(db, { userId: user.id });
    expect(generation).toMatchObject({
      tool: 'text-to-image',
      kind: 'image',
      modelId: 'aivore-demo-image',
      provider: 'mock',
      status: 'queued',
      cost: 1,
      attempts: 0,
      isPublic: false,
    });
    expect(generation.params).toEqual({ aspectRatio: '1:1', count: 1 });
    expect(ASPECT_RATIOS).toContain(generation.params.aspectRatio);
  });

  it('derives kind, model and params from a video tool', () => {
    const db = testDb();
    const user = createUser(db);
    const generation = createGeneration(db, { userId: user.id, tool: 'image-to-video' });
    expect(generation).toMatchObject({ kind: 'video', modelId: 'aivore-demo-video' });
    expect(generation.params).toMatchObject({ durationSec: 3, resolution: '480p' });
  });

  it('accepts overrides such as status and a charge made through the credits module', () => {
    const db = testDb();
    const user = createUser(db, { creditBalance: 10 });
    const generation = createGeneration(db, { userId: user.id, status: 'processing', cost: 4 });
    debitCredits(db, { userId: user.id, amount: 4, generationId: generation.id });
    expectConsistentLedger(db, user.id, 10);
    expect(generation.status).toBe('processing');
  });

  it('creates input and output assets with storage keys the storage contract accepts', () => {
    const db = testDb();
    const user = createUser(db);
    const generation = createGeneration(db, { userId: user.id });
    const input = createAsset(db, { userId: user.id });
    const output = createAsset(db, {
      userId: user.id,
      generationId: generation.id,
      role: 'output',
      index: 2,
    });
    expect(input).toMatchObject({ role: 'input', kind: 'image', generationId: null });
    expect(output).toMatchObject({ role: 'output', index: 2, generationId: generation.id });
    expect(input.storageKey).toBe(`u/${user.id}/uploads/${input.id}.png`);
    expect(output.storageKey).toBe(`u/${user.id}/${generation.id}/${output.id}.png`);
  });
});

describe('freshDb', () => {
  const fresh = freshDb();

  it('gives code that calls getDb() an empty migrated database (first test)', () => {
    expect(fresh.db.$client.open).toBe(true);
    createUser(fresh.db);
    expect(fresh.db.$client.prepare('select count(*) as n from users').get()).toEqual({ n: 1 });
  });

  it('and a different, empty one in the next test', () => {
    expect(fresh.db.$client.prepare('select count(*) as n from users').get()).toEqual({ n: 0 });
  });
});

describe('invokeRoute', () => {
  const echo = route<{ id: string }>({ auth: 'none' }, async (ctx) => ({
    method: ctx.req.method,
    path: new URL(ctx.req.url).pathname,
    query: Object.fromEntries(new URL(ctx.req.url).searchParams),
    params: ctx.params,
    contentType: ctx.req.headers.get('content-type'),
    custom: ctx.req.headers.get('x-custom'),
  }));

  const create = route({ auth: 'none' }, async (ctx) =>
    ctx.body(z.object({ name: z.string().min(1) })),
  );

  it('sends a GET to an absolute path on APP_URL and returns status, headers and JSON', async () => {
    const result = await invokeRoute<{ data: Record<string, unknown> }, { id: string }>(echo, {
      url: '/api/v1/things',
      query: { a: '1', b: ['x', 'y'], skipped: undefined, n: 2 },
      headers: { 'x-custom': 'yes' },
    });
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({
      method: 'GET',
      path: '/api/v1/things',
      query: { a: '1', b: 'y', n: '2' },
      custom: 'yes',
    });
    expect(result.headers.get('x-request-id')).toBeTruthy();
    expect(result.text).toContain('"data"');
  });

  it('delivers dynamic params the way Next.js does', async () => {
    const result = await invokeRoute<{ data: { params: unknown } }, { id: string }>(echo, {
      params: { id: 'gen_1' },
    });
    expect(result.json.data.params).toEqual({ id: 'gen_1' });
  });

  it('serializes plain bodies as JSON and defaults the method to POST', async () => {
    const result = await invokeRoute<{ data: { name: string } }>(create, {
      body: { name: 'Layla' },
    });
    expect(result.status).toBe(200);
    expect(result.json.data).toEqual({ name: 'Layla' });
  });

  it('sends strings untouched so malformed JSON can be tested', async () => {
    const result = await invokeRoute<{ error: { code: string } }>(create, {
      body: '{"name":',
      headers: { 'content-type': 'application/json' },
    });
    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('bad_request');
  });

  it('reports validation errors and undefined JSON for empty responses', async () => {
    const invalid = await invokeRoute<{ error: { code: string } }>(create, { body: { name: '' } });
    expect(invalid.status).toBe(422);
    expect(invalid.json.error.code).toBe('validation_failed');

    const empty = await invokeRoute(
      route({ auth: 'none' }, async () => undefined),
      { method: 'DELETE' },
    );
    expect(empty.status).toBe(204);
    expect(empty.json).toBeUndefined();
    expect(empty.text).toBe('');
  });

  it('passes multipart bodies through', async () => {
    const form = new FormData();
    form.set('file', new File([TINY_PNG], 'a.png', { type: 'image/png' }));
    const upload = route({ auth: 'none' }, async (ctx) => {
      const data = await ctx.req.formData();
      return { name: (data.get('file') as File).name };
    });
    const result = await invokeRoute<{ data: { name: string } }>(upload, { body: form });
    expect(result.json.data.name).toBe('a.png');
  });
});

describe('fakeStorage', () => {
  it('stores bytes and streams, and reports size and type', async () => {
    const storage = fakeStorage();
    expect(await storage.put('u/a/uploads/x.png', TINY_PNG, { mimeType: 'image/png' })).toEqual({
      bytes: TINY_PNG.byteLength,
    });
    const { Readable } = await import('node:stream');
    await storage.put('u/a/uploads/y.bin', Readable.from([Buffer.from([1, 2]), Buffer.from([3])]), {
      mimeType: 'application/octet-stream',
    });

    expect(await storage.head('u/a/uploads/x.png')).toEqual({
      size: TINY_PNG.byteLength,
      mimeType: 'image/png',
    });
    expect(await storage.head('u/a/missing.png')).toBeNull();
    const read = await storage.get('u/a/uploads/y.bin');
    expect(await streamToBytes(read.stream)).toEqual(Uint8Array.from([1, 2, 3]));
    expect(read).toMatchObject({ size: 3, mimeType: 'application/octet-stream' });
    expect(read.range).toBeUndefined();
  });

  it('copies what it stores', async () => {
    const storage = fakeStorage();
    const bytes = Uint8Array.from([1, 2, 3]);
    await storage.put('k/a.bin', bytes, { mimeType: 'application/octet-stream' });
    bytes[0] = 9;
    expect(storage.objects.get('k/a.bin')?.bytes[0]).toBe(1);
  });

  it('serves inclusive ranges, open-ended ranges and refuses unsatisfiable ones', async () => {
    const storage = fakeStorage();
    await storage.put('k/a.bin', Uint8Array.from([0, 1, 2, 3, 4, 5]), { mimeType: 'video/mp4' });

    const middle = await storage.get('k/a.bin', { start: 1, end: 3 });
    expect(await streamToBytes(middle.stream)).toEqual(Uint8Array.from([1, 2, 3]));
    expect(middle).toMatchObject({ size: 6, range: { start: 1, end: 3 } });

    const tail = await storage.get('k/a.bin', { start: 4 });
    expect(await streamToBytes(tail.stream)).toEqual(Uint8Array.from([4, 5]));
    expect(tail.range).toEqual({ start: 4, end: 5 });

    const clamped = await storage.get('k/a.bin', { start: 4, end: 99 });
    expect(clamped.range).toEqual({ start: 4, end: 5 });

    await expect(storage.get('k/a.bin', { start: 6 })).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('answers not_found for missing objects and tolerates deleting them', async () => {
    const storage = fakeStorage();
    await expect(storage.get('k/none.bin')).rejects.toMatchObject({ code: 'not_found' });
    await expect(storage.delete('k/none.bin')).resolves.toBeUndefined();
    await storage.put('k/a.bin', TINY_PNG, { mimeType: 'image/png' });
    await storage.delete('k/a.bin');
    expect(await storage.head('k/a.bin')).toBeNull();
  });

  it.each(['../etc/passwd', '/abs/key', 'u/a/../b', 'UPPER/case.png', 'has space.png', ''])(
    'rejects the unsafe key %j like the real drivers must',
    async (key) => {
      const storage = fakeStorage();
      await expect(storage.put(key, TINY_PNG, { mimeType: 'image/png' })).rejects.toMatchObject({
        code: 'bad_request',
      });
    },
  );

  it('only offers signed URLs when asked to', async () => {
    expect(fakeStorage().signedUrl).toBeUndefined();
    const storage = fakeStorage({ signedUrls: true });
    await storage.put('k/a.png', TINY_PNG, { mimeType: 'image/png' });
    expect(await storage.signedUrl?.('k/a.png', 60)).toBe('https://storage.test/k/a.png?ttl=60');
    expect(await storage.signedUrl?.('k/missing.png', 60)).toBeNull();
  });
});

describe('fakeProvider', () => {
  const model = (kind: 'image' | 'video', count = 1) =>
    ({
      generationId: 'gen_1',
      tool: kind === 'image' ? 'text-to-image' : 'text-to-video',
      model: { kind },
      prompt: 'p',
      params: { aspectRatio: '1:1', count },
    }) as unknown as Parameters<ReturnType<typeof fakeProvider>['submit']>[0];

  it('answers synchronously with one decodable output per requested image', async () => {
    const provider = fakeProvider();
    const result = await provider.submit(model('image', 3), fakeProviderContext());
    expect(result.mode).toBe('sync');
    if (result.mode !== 'sync') return;
    expect(result.outputs).toHaveLength(3);
    const meta = await sharp(result.outputs[0]?.bytes).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 1, height: 1 });
    expect(provider.submit).toHaveBeenCalledOnce();
  });

  it('produces a decodable GIF for video models', async () => {
    const result = await fakeProvider().submit(model('video'), fakeProviderContext());
    if (result.mode !== 'sync') throw new Error('expected a sync result');
    expect(result.outputs[0]).toMatchObject({ kind: 'video', mimeType: 'image/gif' });
    expect((await sharp(TINY_GIF).metadata()).format).toBe('gif');
  });

  it('can be scripted, made unconfigured and given cancel support', async () => {
    const provider = fakeProvider({
      id: 'fal',
      configured: (env) => env.ENABLE_MOCK_PROVIDER,
      submit: () => ({ mode: 'async', providerJobId: 'job_1' }),
      poll: () => ({ status: 'running', progress: 40 }),
      cancel: vi.fn(),
    });
    const ctx = fakeProviderContext();
    expect(provider.id).toBe('fal');
    expect(provider.isConfigured(ctx.env)).toBe(true);
    expect(await provider.submit(model('image'), ctx)).toEqual({
      mode: 'async',
      providerJobId: 'job_1',
    });
    expect(await provider.poll('job_1', model('image'), ctx)).toEqual({
      status: 'running',
      progress: 40,
    });
    await provider.cancel?.('job_1', ctx);
    expect(fakeProvider({ configured: false }).isConfigured(ctx.env)).toBe(false);
    expect(fakeProvider().cancel).toBeUndefined();
  });

  it('plugs into the registry through setProviderOverrides', () => {
    const provider = fakeProvider();
    setProviderOverrides({ mock: provider });
    expect(getProvider('mock')).toBe(provider);
  });

  it('succeeds in polling by default', async () => {
    const result = await fakeProvider().poll('job', model('image'), fakeProviderContext());
    expect(result.status).toBe('succeeded');
  });
});

describe('fakeProviderContext', () => {
  it('has an unaborted signal, the test env and a silent logger, and fails loudly on fetch', async () => {
    const ctx = fakeProviderContext();
    expect(ctx.signal.aborted).toBe(false);
    expect(ctx.env.ENABLE_MOCK_PROVIDER).toBe(true);
    expect(ctx.log.level).toBe('silent');
    await expect(ctx.fetch('https://example.com')).rejects.toThrow('no fetch stub');
  });

  it('accepts overrides', () => {
    const controller = new AbortController();
    controller.abort();
    expect(fakeProviderContext({ signal: controller.signal }).signal.aborted).toBe(true);
  });
});
