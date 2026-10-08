import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import type {
  ApiKeyDTO,
  AssetDTO,
  CreateApiKeyResponse,
  EnhancePromptResponse,
  GenerationDTO,
  UserDTO,
} from '@/lib/api-types';
import { newId } from '@/lib/id';
import { generations, users } from '@/server/db/schema';
import { getPublicGeneration } from '@/server/generations/service';
import { resetEnvForTests } from '@/server/env';
import { createLogger, resetLoggerForTests } from '@/server/logger';
import {
  SVG,
  makeAnimatedGif,
  makeDeclaredHugePng,
  makeJpeg,
  makeNoisyPng,
  makePng,
  toFile,
} from '../server/uploads/support';
import { Client, dataOf, errorOf } from './helpers/api';
import {
  IMAGE_MODEL,
  createWorld,
  runToCompletion,
  textToImage,
  textToVideo,
  type Member,
} from './helpers/world';

// Security across module boundaries: who may see, change and spend what, with real cookies, real
// API keys, the real same-origin check and the real moderation, through the real routes.

// Real image and GIF encoding, scrypt and a job loop: slow when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();
const DAY_MS = 24 * 60 * 60 * 1000;

const balanceOf = async (member: Client) =>
  dataOf(await member.get<UserDTO>('/auth/me')).creditBalance;

const generationCount = () => world.db.select().from(generations).all().length;

async function finished(member: Member, request: unknown): Promise<GenerationDTO> {
  const queued = dataOf(await member.post<GenerationDTO>('/generations', request), 201);
  return runToCompletion(member, queued.id, world.runner());
}

/** A photo edit by `member`: an uploaded input image, an image-to-image generation, its result. */
async function photoEdit(member: Member, extra: Record<string, unknown> = {}) {
  const input = dataOf(await member.upload<AssetDTO>(await makePng(64, 48)), 201);
  const done = await finished(member, {
    tool: 'image-to-image',
    modelId: IMAGE_MODEL,
    prompt: 'make the sky a deep blue',
    inputAssetId: input.id,
    ...extra,
  });
  return { input, done };
}

describe('one user can never reach another user’s generations or files', () => {
  it('answers 404, identical to "does not exist", for read, change, cancel, delete and every media variant', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const { input, done } = await photoEdit(alice);
    const output = done.outputs[0];
    expect(output).toBeDefined();
    if (!output) return;

    const unknownGeneration = `/generations/${newId('gen')}`;
    const unknownAsset = `/media/${newId('ast')}`;
    const attempts: Array<
      [string, () => ReturnType<Client['request']>, () => ReturnType<Client['request']>]
    > = [
      ['read', () => bob.get(`/generations/${done.id}`), () => bob.get(unknownGeneration)],
      [
        'share',
        () => bob.patch(`/generations/${done.id}`, { isPublic: true }),
        () => bob.patch(unknownGeneration, { isPublic: true }),
      ],
      [
        'favorite',
        () => bob.patch(`/generations/${done.id}`, { isFavorite: true }),
        () => bob.patch(unknownGeneration, { isFavorite: true }),
      ],
      [
        'cancel',
        () => bob.post(`/generations/${done.id}/cancel`),
        () => bob.post(`${unknownGeneration}/cancel`),
      ],
      ['delete', () => bob.delete(`/generations/${done.id}`), () => bob.delete(unknownGeneration)],
    ];
    for (const [name, real, missing] of attempts) {
      const [actual, expected] = [await real(), await missing()];
      expect(actual.status, name).toBe(404);
      expect(actual.json, name).toEqual(expected.json);
    }

    const media = [output.url, output.thumbUrl ?? '', input.url, input.thumbUrl ?? ''];
    const missingMedia = await bob.media(unknownAsset);
    expect(missingMedia.status).toBe(404);
    for (const url of media) {
      for (const method of ['GET', 'HEAD'] as const) {
        const reply = await bob.media(url, { method });
        expect(reply.status, `${method} ${url}`).toBe(404);
        expect(reply.headers.get('cache-control')).toBe('no-store');
        if (method === 'GET') expect(reply.bytes).toEqual(missingMedia.bytes);
      }
    }

    // Lists, batch polls and searches never include it; creating from it is refused and free.
    expect(dataOf(await bob.get<GenerationDTO[]>('/generations'))).toEqual([]);
    expect(
      dataOf(await bob.get<GenerationDTO[]>('/generations', { query: { ids: done.id } })),
    ).toEqual([]);
    expect(
      dataOf(await bob.get<GenerationDTO[]>('/generations', { query: { q: 'deep blue' } })),
    ).toEqual([]);
    const stolen = await bob.post('/generations', {
      tool: 'image-to-image',
      modelId: IMAGE_MODEL,
      prompt: 'make the sky a deep blue',
      inputAssetId: input.id,
    });
    expect(errorOf(stolen, 404)).toBe('not_found');
    expect(await balanceOf(bob)).toBe(50);
    expect(generationCount()).toBe(1);

    // Everything of Alice's is exactly as she left it.
    const after = dataOf(await alice.get<GenerationDTO>(`/generations/${done.id}`));
    expect(after).toEqual(done);
    expect((await alice.media(output.url)).status).toBe(200);
    expect((await alice.media(input.url)).status).toBe(200);
    expect(world.storedFiles()).toHaveLength(4);
    expect(await balanceOf(alice)).toBe(49);
  });

  it('refuses anonymous callers: 401 on the private API, 404 on media', async () => {
    const alice = await world.signUp('Alice');
    const { done } = await photoEdit(alice);
    const anonymous = world.anonymous();

    for (const reply of [
      await anonymous.get('/generations'),
      await anonymous.get(`/generations/${done.id}`),
      await anonymous.post('/generations', textToImage('a lake')),
      await anonymous.delete(`/generations/${done.id}`),
      await anonymous.post(`/generations/${done.id}/cancel`),
      await anonymous.upload(await makePng(8, 8)),
      await anonymous.get('/account/ledger'),
      await anonymous.get('/keys'),
      await anonymous.post('/prompt/enhance', { prompt: 'a lake', kind: 'image' }),
    ]) {
      expect(errorOf(reply, 401)).toBe('unauthorized');
    }
    expect((await anonymous.media(done.outputs[0]?.url ?? '')).status).toBe(404);
    expect(generationCount()).toBe(1);
  });
});

describe('sharing a result publicly', () => {
  it('shows it on /explore and to anonymous viewers while public, and cleanly stops when it is not', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const anonymous = world.anonymous();
    const { input, done } = await photoEdit(alice);
    const output = done.outputs[0];
    if (!output) throw new Error('the edit has no output');
    const privateOne = await finished(alice, textToImage('a private lake'));

    // Private by default: not listed, not readable.
    expect(dataOf(await anonymous.get<GenerationDTO[]>('/explore'))).toEqual([]);
    expect((await anonymous.media(output.url)).status).toBe(404);
    expect((await bob.media(output.url)).status).toBe(404);

    // Alice shares one of them and bookmarks it.
    const shared = dataOf(
      await alice.patch<GenerationDTO>(`/generations/${done.id}`, {
        isPublic: true,
        isFavorite: true,
      }),
    );
    expect(shared).toMatchObject({ isPublic: true, isFavorite: true });

    const explore = await anonymous.get<GenerationDTO[]>('/explore');
    const feed = dataOf(explore);
    expect(feed.map((item) => item.id)).toEqual([done.id]);
    expect(feed[0]).toMatchObject({
      owner: { name: 'Alice' },
      isFavorite: false,
      status: 'succeeded',
    });
    expect(feed[0]?.input).toBeUndefined();
    expect(explore.headers.get('cache-control')).toMatch(/^public, max-age=\d+/);
    expect(explore.headers.get('set-cookie')).toBeNull();
    expect(explore.text).not.toMatch(
      /alice\d*@example\.com|usr_|"userId"|providerJobId|storageKey/,
    );

    // Anyone can stream the output and its thumbnail, with shared-cache headers.
    const owner = await alice.media(output.url);
    for (const viewer of [anonymous, bob]) {
      const served = await viewer.media(output.url);
      expect(served.status).toBe(200);
      expect(served.bytes).toEqual(owner.bytes);
      expect(served.headers.get('cache-control')).toBe('public, max-age=300');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(served.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect((await viewer.media(output.thumbUrl ?? '')).status).toBe(200);
      expect((await viewer.media(output.url, { headers: { range: 'bytes=0-9' } })).status).toBe(
        206,
      );
    }
    expect(owner.headers.get('cache-control')).toBe('private, max-age=3600');

    // Sharing the result never shares the photo it was made from, nor the API record.
    expect((await anonymous.media(input.url)).status).toBe(404);
    expect((await bob.media(input.url)).status).toBe(404);
    expect((await bob.get(`/generations/${done.id}`)).status).toBe(404);
    expect((await bob.patch(`/generations/${done.id}`, { isPublic: false })).status).toBe(404);
    expect((await anonymous.media(privateOne.outputs[0]?.url ?? '')).status).toBe(404);

    // Making it private again closes everything at once; the owner keeps access.
    dataOf(await alice.patch<GenerationDTO>(`/generations/${done.id}`, { isPublic: false }));
    expect(dataOf(await anonymous.get<GenerationDTO[]>('/explore'))).toEqual([]);
    expect((await anonymous.media(output.url)).status).toBe(404);
    expect((await anonymous.media(output.thumbUrl ?? '')).status).toBe(404);
    expect((await bob.media(output.url)).status).toBe(404);
    expect((await alice.media(output.url)).status).toBe(200);

    // Deleting a public generation removes it from the feed and from disk.
    dataOf(await alice.patch<GenerationDTO>(`/generations/${done.id}`, { isPublic: true }));
    expect((await anonymous.media(output.url)).status).toBe(200);
    expect((await alice.delete(`/generations/${done.id}`)).status).toBe(204);
    expect(dataOf(await anonymous.get<GenerationDTO[]>('/explore'))).toEqual([]);
    expect((await anonymous.media(output.url)).status).toBe(404);
    expect(world.storedFiles().filter((file) => file.includes(done.id))).toEqual([]);
  });

  it('lists only finished public results, newest first, across pages', async () => {
    const alice = await world.signUp('Alice');
    const anonymous = world.anonymous();
    const first = await finished(alice, textToImage('lake one', { isPublic: true }));
    const second = await finished(alice, textToImage('lake two', { isPublic: true }));
    const third = await finished(alice, textToImage('lake three', { isPublic: true }));
    await finished(alice, textToImage('lake four __fail__', { isPublic: true }));
    await finished(alice, textToImage('lake five'));

    const page1 = await anonymous.get<GenerationDTO[]>('/explore', { query: { limit: 2 } });
    expect(dataOf(page1).map((item) => item.id)).toEqual([third.id, second.id]);
    expect(page1.json.nextCursor).toBeTruthy();
    const page2 = await anonymous.get<GenerationDTO[]>('/explore', {
      query: { limit: 2, cursor: page1.json.nextCursor ?? '' },
    });
    expect(dataOf(page2).map((item) => item.id)).toEqual([first.id]);
    expect(page2.json.nextCursor).toBeNull();
    expect(
      dataOf(await anonymous.get<GenerationDTO[]>('/explore', { query: { kind: 'video' } })),
    ).toEqual([]);
  });
});

describe('uploads through the real stack', () => {
  it('stores only re-encoded pixels: no EXIF, no embedded payload, no trace of the file name', async () => {
    const alice = await world.signUp('Alice');
    const withSecrets = await makeJpeg(48, 32, {
      exif: true,
      comment: '<script>alert("polyglot")</script>',
    });
    expect(Buffer.from(withSecrets).includes('SECRET-ARTIST')).toBe(true);

    const stored = dataOf(
      await alice.upload<AssetDTO>(withSecrets, {
        filename: '../../evil name.php.jpg',
        type: 'image/jpeg',
      }),
      201,
    );
    const served = await alice.media(stored.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    const text = Buffer.from(served.bytes).toString('latin1');
    expect(text).not.toContain('SECRET-ARTIST');
    expect(text).not.toContain('<script>');
    expect((await sharp(served.bytes).metadata()).exif).toBeUndefined();
    expect(world.storedFiles().join('\n')).not.toMatch(/evil|php/);
  });

  it('refuses what is not a PNG, JPEG or WebP picture, whatever it claims to be, and keeps nothing', async () => {
    const alice = await world.signUp('Alice');
    const refused: Array<[string, Uint8Array, number, string]> = [
      [
        'text pretending to be a PNG',
        new TextEncoder().encode('just some text, not a picture'),
        415,
        'unsupported_media_type',
      ],
      ['an SVG with a script', SVG, 415, 'unsupported_media_type'],
      ['an animated GIF', await makeAnimatedGif(), 415, 'unsupported_media_type'],
      ['an empty file', new Uint8Array(), 400, 'bad_request'],
      ['an image bomb', makeDeclaredHugePng(60_000, 60_000), 400, 'bad_request'],
    ];
    for (const [name, bytes, status, code] of refused) {
      const reply = await alice.upload(bytes, { filename: 'photo.png', type: 'image/png' });
      expect({ name, status: reply.status, code: reply.json.error?.code }).toEqual({
        name,
        status,
        code,
      });
    }
    expect(world.db.$client.prepare('select count(*) as n from assets').get()).toEqual({ n: 0 });
    expect(world.storedFiles()).toEqual([]);
  });

  it('enforces the size limit while the body streams, and wants exactly one file', async () => {
    vi.stubEnv('MAX_UPLOAD_MB', '1');
    resetEnvForTests();
    const alice = await world.signUp('Alice');

    const big = await makeNoisyPng(900); // well over 1 MB, still a valid picture
    expect(big.byteLength).toBeGreaterThan(1024 * 1024);
    expect(errorOf(await alice.upload(big), 413)).toBe('payload_too_large');
    const enormous = new Uint8Array(3 * 1024 * 1024);
    expect(errorOf(await alice.upload(enormous), 413)).toBe('payload_too_large');

    const none = await alice.post('/uploads', new FormData());
    expect(errorOf(none, 422)).toBe('validation_failed');
    const two = new FormData();
    for (const name of ['a.png', 'b.png']) two.append('file', toFile(await makePng(8, 8), name));
    expect(errorOf(await alice.post('/uploads', two), 422)).toBe('validation_failed');
    const wrongType = await alice.post('/uploads', JSON.stringify({ file: 'x' }), {
      headers: { 'content-type': 'application/json' },
    });
    expect(errorOf(wrongType, 415)).toBe('unsupported_media_type');

    expect(world.storedFiles()).toEqual([]);
    expect((await alice.upload(await makePng(8, 8))).status).toBe(201);
  });

  it('never lets a user build on someone else’s public result or their own output as an input photo', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const shared = await finished(alice, textToImage('a lake', { isPublic: true }));
    const outputId = shared.outputs[0]?.id ?? '';
    expect((await bob.media(shared.outputs[0]?.url ?? '')).status).toBe(200);

    const edit = (id: string) => ({
      tool: 'image-to-image',
      modelId: IMAGE_MODEL,
      prompt: 'make the sky a deep blue',
      inputAssetId: id,
    });
    for (const user of [bob, alice]) {
      expect(errorOf(await user.post('/generations', edit(outputId)), 404)).toBe('not_found');
    }
    expect(await balanceOf(bob)).toBe(50);
    expect(await balanceOf(alice)).toBe(49);
  });
});

describe('a disabled account', () => {
  it('takes its shared results offline everywhere: feed, share page and media URLs', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const anonymous = world.anonymous();
    const shared = await finished(alice, textToImage('a lake', { isPublic: true }));
    const output = shared.outputs[0];
    if (!output) throw new Error('no output');
    expect(dataOf(await anonymous.get<GenerationDTO[]>('/explore')).map((g) => g.id)).toEqual([
      shared.id,
    ]);
    expect(getPublicGeneration(shared.id)?.id).toBe(shared.id);
    expect((await anonymous.media(output.url)).status).toBe(200);

    world.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, alice.user.id)).run();

    expect(dataOf(await anonymous.get<GenerationDTO[]>('/explore'))).toEqual([]);
    expect(getPublicGeneration(shared.id)).toBeNull();
    for (const viewer of [anonymous, bob, alice]) {
      expect((await viewer.media(output.url)).status, 'media').toBe(404);
      expect((await viewer.media(output.thumbUrl ?? '')).status, 'thumbnail').toBe(404);
    }
    expect(errorOf(await alice.get('/generations'), 401)).toBe('unauthorized');
  });
});

describe('API keys', () => {
  async function issueKey(
    member: Member,
    name = 'ci',
  ): Promise<{ key: string; record: ApiKeyDTO }> {
    return dataOf(await member.post<CreateApiKeyResponse>('/keys', { name }), 201);
  }

  it('lets a key run the whole generation flow, but never manage credentials', async () => {
    const alice = await world.signUp('Alice');
    const { key, record } = await issueKey(alice);
    expect(key).toMatch(/^avk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);

    // The secret is shown once: the list holds only the display prefix.
    const listed = await alice.get<ApiKeyDTO[]>('/keys');
    expect(dataOf(listed).map((item) => item.id)).toEqual([record.id]);
    expect(listed.text).not.toContain(key);

    const script = new Client({ apiKey: key }); // no cookie, no Origin: a script
    const input = dataOf(await script.upload<AssetDTO>(await makePng(32, 32)), 201);
    const queued = dataOf(
      await script.post<GenerationDTO>('/generations', textToImage('a lake from a script')),
      201,
    );
    expect(await balanceOf(script)).toBe(49);
    const done = await runToCompletion(script, queued.id, world.runner());
    expect(done.status).toBe('succeeded');
    expect((await script.media(done.outputs[0]?.url ?? '')).status).toBe(200);
    expect((await script.media(input.url)).status).toBe(200);
    expect(dataOf(await script.get<GenerationDTO[]>('/generations')).map((g) => g.id)).toEqual([
      done.id,
    ]);
    expect((await script.get('/account')).status).toBe(200);
    expect((await script.get('/account/ledger')).status).toBe(200);

    // The same data through the browser session.
    expect(dataOf(await alice.get<GenerationDTO>(`/generations/${done.id}`)).id).toBe(done.id);

    // Credential management needs a browser session.
    for (const reply of [
      await script.get('/keys'),
      await script.post('/keys', { name: 'more' }),
      await script.delete(`/keys/${record.id}`),
      await script.post('/account/password', {
        currentPassword: alice.password,
        newPassword: 'Another-passphrase-77',
      }),
      await script.post('/auth/logout-all'),
    ]) {
      expect(errorOf(reply, 403)).toBe('forbidden');
    }
    expect(dataOf(await alice.get<ApiKeyDTO[]>('/keys'))).toHaveLength(1);
  });

  it('treats a presented key as authoritative and stops a revoked key at once', async () => {
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const { key, record } = await issueKey(alice);
    const bobKey = await issueKey(bob, 'bobs');
    const created = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('a lake')),
      201,
    );

    // A wrong key is anonymous even next to a good cookie.
    const wrong = alice.as({ apiKey: `avk_abcd1234_${'A'.repeat(43)}` });
    expect(errorOf(await wrong.get('/generations'), 401)).toBe('unauthorized');
    expect(errorOf(await wrong.post('/generations', textToImage('a lake')), 401)).toBe(
      'unauthorized',
    );

    // Bob's key reaches only Bob's data; Bob cannot revoke Alice's key.
    const asBob = new Client({ apiKey: bobKey.key });
    expect((await asBob.get(`/generations/${created.id}`)).status).toBe(404);
    expect((await bob.delete(`/keys/${record.id}`)).status).toBe(404);
    expect((await new Client({ apiKey: key }).get(`/generations/${created.id}`)).status).toBe(200);

    // Alice revokes it: the very next call fails, her session still works, revoking twice is fine.
    expect((await alice.delete(`/keys/${record.id}`)).status).toBe(204);
    const revoked = new Client({ apiKey: key });
    expect(errorOf(await revoked.get(`/generations/${created.id}`), 401)).toBe('unauthorized');
    expect(errorOf(await revoked.post('/generations', textToImage('a lake')), 401)).toBe(
      'unauthorized',
    );
    expect((await alice.get(`/generations/${created.id}`)).status).toBe(200);
    expect((await alice.delete(`/keys/${record.id}`)).status).toBe(204);
    expect(await balanceOf(alice)).toBe(49);
  });
});

describe('cross-site request forgery', () => {
  it('refuses every mutating cookie request without a same-site Origin and changes nothing', async () => {
    const alice = await world.signUp('Alice');
    const done = await finished(alice, textToImage('a lake'));
    const queued = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('another lake')),
      201,
    );
    const balance = await balanceOf(alice);
    const png = await makePng(16, 16);

    const forgeries: Array<[string, Record<string, string>]> = [
      ['no Origin at all', {}],
      ['a foreign Origin', { origin: 'https://evil.example' }],
      ['an opaque Origin', { origin: 'null' }],
      ['a foreign Referer', { referer: 'https://evil.example/page' }],
      ['a cross-site fetch', { 'sec-fetch-site': 'cross-site', origin: 'http://localhost:3000' }],
    ];
    for (const [name, headers] of forgeries) {
      const browser = alice.as({ origin: false });
      const send = (method: string, path: string, body?: unknown) =>
        browser.request(method, path, { body, headers });
      const replies = [
        await send('POST', '/generations', textToImage('forged')),
        await send('PATCH', `/generations/${done.id}`, { isPublic: true }),
        await send('POST', `/generations/${queued.id}/cancel`),
        await send('DELETE', `/generations/${done.id}`),
        await send('POST', '/keys', { name: 'forged' }),
        await send('PATCH', '/account', { name: 'Mallory' }),
        await send('POST', '/account/password', {
          currentPassword: alice.password,
          newPassword: 'Forged-passphrase-1',
        }),
        await browser.upload(png, { headers }),
      ];
      for (const reply of replies) expect(errorOf(reply, 403), name).toBe('forbidden');
    }

    // Nothing happened: no charge, no new rows, nothing shared, nothing canceled or deleted.
    expect(await balanceOf(alice)).toBe(balance);
    expect(generationCount()).toBe(2);
    const after = dataOf(await alice.get<GenerationDTO>(`/generations/${done.id}`));
    expect(after.isPublic).toBe(false);
    expect(dataOf(await alice.get<GenerationDTO>(`/generations/${queued.id}`)).status).toBe(
      'queued',
    );
    expect(dataOf(await alice.get<ApiKeyDTO[]>('/keys'))).toEqual([]);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).name).toBe('Alice');
    expect(world.storedFiles()).toHaveLength(2);
  });

  it('allows safe reads without an Origin, a same-site Referer instead of an Origin, and keys without either', async () => {
    const alice = await world.signUp('Alice');
    const script = alice.as({ origin: false });
    expect((await script.get('/generations')).status).toBe(200);
    expect((await script.get('/auth/me')).status).toBe(200);

    const viaReferer = await script.post('/generations', textToImage('a lake'), {
      headers: { referer: 'http://localhost:3000/studio' },
    });
    expect(viaReferer.status).toBe(201);
  });

  it('requires a same-site Origin to register or log in, before any account or session exists', async () => {
    const stranger = new Client({ origin: false });
    const body = {
      email: 'mallory@example.com',
      password: 'Correct-horse-battery-9',
      name: 'Mallory',
    };
    expect(errorOf(await stranger.post('/auth/register', body), 403)).toBe('forbidden');
    expect(
      errorOf(
        await stranger.post('/auth/register', body, {
          headers: { origin: 'https://evil.example' },
        }),
        403,
      ),
    ).toBe('forbidden');
    expect(world.db.$client.prepare('select count(*) as n from users').get()).toEqual({ n: 0 });

    const alice = await world.signUp('Alice');
    const login = { email: alice.email, password: alice.password };
    expect(errorOf(await stranger.post('/auth/login', login), 403)).toBe('forbidden');
    const ok = await new Client().post<UserDTO>('/auth/login', login);
    expect(dataOf(ok).id).toBe(alice.user.id);
    expect(ok.headers.getSetCookie().some((line) => line.startsWith('aivore_session='))).toBe(true);
  });
});

describe('sessions across the stack', () => {
  function sessionTokenOf(reply: { headers: Headers }): string {
    const line = reply.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('aivore_session='));
    const token = /^aivore_session=([^;]+)/.exec(line ?? '')?.[1];
    if (!token) throw new Error('no session cookie in the response');
    return token;
  }

  it('signing out ends that session everywhere, and leaves other sessions alone', async () => {
    const alice = await world.signUp('Alice');
    const done = await finished(alice, textToImage('a lake'));
    const second = await new Client().post<UserDTO>('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    const otherDevice = new Client({ token: sessionTokenOf(second) });
    expect((await otherDevice.get(`/generations/${done.id}`)).status).toBe(200);

    const out = await alice.post('/auth/logout');
    expect(out.status).toBe(204);
    expect(out.headers.getSetCookie().join(';')).toMatch(/aivore_session=;.*Max-Age=0/);
    expect(errorOf(await alice.get('/generations'), 401)).toBe('unauthorized');
    expect((await alice.media(done.outputs[0]?.url ?? '')).status).toBe(404);
    expect(dataOf(await alice.get<UserDTO | null>('/auth/me'))).toBeNull();
    expect((await otherDevice.get(`/generations/${done.id}`)).status).toBe(200);

    expect((await otherDevice.post('/auth/logout-all')).status).toBe(204);
    expect(errorOf(await otherDevice.get('/generations'), 401)).toBe('unauthorized');
  });

  it('expires after 30 idle days but slides while the account is used', async () => {
    const alice = await world.signUp('Alice');
    const done = await finished(alice, textToImage('a lake'));
    const busy = new Client({ token: alice.token });

    // Used every 20 days for 60 days: still signed in, each use renews the 30 days.
    for (let round = 0; round < 3; round += 1) {
      world.time.skip(20 * DAY_MS);
      expect(dataOf(await busy.get<UserDTO | null>('/auth/me'))?.id).toBe(alice.user.id);
    }
    expect((await busy.get(`/generations/${done.id}`)).status).toBe(200);

    // Left alone for 31 days: gone, for the API and for media alike.
    world.time.skip(31 * DAY_MS);
    expect(dataOf(await busy.get<UserDTO | null>('/auth/me'))).toBeNull();
    expect(errorOf(await busy.get('/generations'), 401)).toBe('unauthorized');
    expect((await busy.media(done.outputs[0]?.url ?? '')).status).toBe(404);
  });

  it('changing the password signs out every other session and keeps the current one', async () => {
    const alice = await world.signUp('Alice');
    const other = await new Client().post<UserDTO>('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    const otherDevice = new Client({ token: sessionTokenOf(other) });
    expect((await otherDevice.get('/generations')).status).toBe(200);

    const next = 'A-brand-new-passphrase-42';
    const changed = await alice.post('/account/password', {
      currentPassword: alice.password,
      newPassword: next,
    });
    expect(changed.status).toBe(204);
    expect((await alice.get('/generations')).status).toBe(200);
    expect(errorOf(await otherDevice.get('/generations'), 401)).toBe('unauthorized');

    const relogin = new Client();
    expect(
      errorOf(
        await relogin.post('/auth/login', { email: alice.email, password: alice.password }),
        401,
      ),
    ).toBe('unauthorized');
    expect((await relogin.post('/auth/login', { email: alice.email, password: next })).status).toBe(
      200,
    );
  });
});

describe('moderation in front of the credits', () => {
  it('blocks a prompt on the list with 422, before anything is debited, queued or stored', async () => {
    vi.stubEnv('MODERATION_BLOCKLIST', 'zorblax, ممنوع');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const bobKey = dataOf(await bob.post<CreateApiKeyResponse>('/keys', { name: 'script' }), 201);

    const prompts = [
      'a zorblax on the moon',
      'ZORBLAX!',
      'a zor​blax in a field', // zero-width space inside the word
      'صورة شيء ممنوع على الشاطئ', // Arabic
    ];
    for (const prompt of prompts) {
      const reply = await alice.post('/generations', textToImage(prompt));
      expect(errorOf(reply, 422), prompt).toBe('moderation_blocked');
      expect(reply.json.error?.details).toEqual({ category: 'blocklist' });
      expect(reply.text).not.toContain('zorblax');
    }
    const video = await alice.post('/generations', textToVideo('a zorblax flying'));
    expect(errorOf(video, 422)).toBe('moderation_blocked');
    const viaKey = await new Client({ apiKey: bobKey.key }).post(
      '/generations',
      textToImage('a zorblax'),
    );
    expect(errorOf(viaKey, 422)).toBe('moderation_blocked');

    expect(await balanceOf(alice)).toBe(50);
    expect(await balanceOf(bob)).toBe(50);
    expect(generationCount()).toBe(0);
    expect(world.storedFiles()).toEqual([]);

    // The same words are fine as a negative prompt, and the neighbouring prompt still works.
    const accepted = await alice.post<GenerationDTO>(
      '/generations',
      textToImage('a lake', { negativePrompt: 'zorblax, nsfw, nude, gore' }),
    );
    expect(dataOf(accepted, 201)).toMatchObject({ negativePrompt: 'zorblax, nsfw, nude, gore' });
    expect(await balanceOf(alice)).toBe(49);
  });

  it('does not let the prompt enhancer launder a blocked prompt, and feeds an accepted one into a generation', async () => {
    vi.stubEnv('MODERATION_BLOCKLIST', 'zorblax');
    resetEnvForTests();
    const alice = await world.signUp('Alice');

    const blocked = await alice.post('/prompt/enhance', { prompt: 'a zorblax', kind: 'image' });
    expect(errorOf(blocked, 422)).toBe('moderation_blocked');

    const enhanced = dataOf(
      await alice.post<EnhancePromptResponse>('/prompt/enhance', {
        prompt: 'a cat on the moon',
        kind: 'image',
      }),
    );
    expect(enhanced.engine).toBe('heuristic');
    expect(enhanced.prompt.length).toBeGreaterThan('a cat on the moon'.length);
    const done = await finished(alice, textToImage(enhanced.prompt));
    expect(done.status).toBe('succeeded');
    expect(done.prompt).toBe(enhanced.prompt);
  });

  it('blocks a photo edit that asks to undress the person in it, before any charge', async () => {
    const alice = await world.signUp('Alice');
    const input = dataOf(await alice.upload<AssetDTO>(await makePng(64, 48)), 201);

    for (const prompt of ['nude', 'make this naked', 'عارية']) {
      const reply = await alice.post('/generations', {
        tool: 'image-to-image',
        modelId: IMAGE_MODEL,
        prompt,
        inputAssetId: input.id,
      });
      expect(errorOf(reply, 422), prompt).toBe('moderation_blocked');
      expect(reply.json.error?.details).toEqual({ category: 'non_consensual_sexual' });
    }
    expect(await balanceOf(alice)).toBe(50);
    expect(generationCount()).toBe(0);

    // Ordinary edits, and the same words for a text-only picture, are not affected.
    const edit = await alice.post('/generations', {
      tool: 'image-to-image',
      modelId: IMAGE_MODEL,
      prompt: 'turn this photo into an oil painting',
      inputAssetId: input.id,
    });
    expect(edit.status).toBe(201);
    const textOnly = await alice.post('/generations', textToImage('a naked mole rat'));
    expect(textOnly.status).toBe(201);
  });

  it('blocks a negative prompt that steers a portrait toward nudity by excluding clothing', async () => {
    const alice = await world.signUp('Alice');
    const steering = await alice.post(
      '/generations',
      textToImage('portrait of a woman on a beach', {
        negativePrompt: 'clothes, clothing, dressed, bikini, swimsuit, underwear',
      }),
    );
    expect(errorOf(steering, 422)).toBe('moderation_blocked');
    expect(await balanceOf(alice)).toBe(50);
    expect(generationCount()).toBe(0);

    const ordinary = await alice.post(
      '/generations',
      textToImage('portrait of a woman on a beach', {
        negativePrompt: 'blurry, watermark, extra fingers',
      }),
    );
    expect(ordinary.status).toBe(201);
  });
});

describe('client addresses and rate limits', () => {
  const via = (address: string) => ({ 'x-forwarded-for': address });

  it('behind a trusted proxy each client address has its own budget and spoofed entries do not help', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const anonymous = world.anonymous();
    const feed = (address: string) => anonymous.get('/explore', { headers: via(address) });

    for (let request = 0; request < 60; request += 1) {
      expect((await feed('198.51.100.7')).status).toBe(200);
    }
    const limited = await feed('198.51.100.7');
    expect(errorOf(limited, 429)).toBe('rate_limited');
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    // The client controls everything left of the proxy's own entry: rotating it changes nothing.
    expect((await feed('203.0.113.99, 198.51.100.7')).status).toBe(429);
    expect((await feed('203.0.113.98, 198.51.100.7')).status).toBe(429);
    // Another client, and the same client a minute later, are served.
    expect((await feed('198.51.100.8')).status).toBe(200);
    world.time.skip(61_000);
    expect((await feed('198.51.100.7')).status).toBe(200);
  });

  it('limits sign-ups to five an hour per client address, failed attempts included', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const stranger = new Client();
    const attempt = (address: string) =>
      stranger.post(
        '/auth/register',
        { email: 'not-an-email', password: 'Correct-horse-battery-9', name: 'Mallory' },
        { headers: via(address) },
      );
    for (let request = 0; request < 5; request += 1)
      expect((await attempt('198.51.100.20')).status).toBe(422);
    expect(errorOf(await attempt('198.51.100.20'), 429)).toBe('rate_limited');
    expect((await attempt('198.51.100.21')).status).toBe(422);
    world.time.skip(61 * 60 * 1000);
    expect((await attempt('198.51.100.20')).status).toBe(422);
  });

  it('without a trusted proxy the forwarded header is ignored, so it can neither dodge nor trigger a budget', async () => {
    const anonymous = world.anonymous();
    // Every caller is the same unknown address with a larger shared budget: 60 requests from
    // "different" clients do not exhaust a per-client budget they could never be told apart by.
    for (let request = 0; request < 70; request += 1) {
      const reply = await anonymous.get('/explore', { headers: via(`203.0.113.${request}`) });
      expect(reply.status).toBe(200);
      expect(reply.headers.get('x-ratelimit-limit')).toBe('1200');
    }
  });
});

describe('secrets stay out of the logs', () => {
  it('never logs a session token, API key, password or prompt, even at debug level', async () => {
    vi.stubEnv('LOG_LEVEL', 'debug');
    resetEnvForTests();
    resetLoggerForTests();
    const lines: string[] = [];
    const capture = (chunk: unknown): boolean => {
      lines.push(String(chunk));
      return true;
    };
    // The runner keeps its own logger for as long as it lives, so it writes into the same list.
    const runnerLog = createLogger({ level: 'debug', sink: (_level, line) => lines.push(line) });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);

    const prompt = 'a very distinctive prompt about glassblowers in tundra';
    const alice = await world.signUp('Alice');
    const login = await new Client().post<UserDTO>('/auth/login', {
      email: alice.email,
      password: alice.password,
    });
    const { key } = dataOf(await alice.post<CreateApiKeyResponse>('/keys', { name: 'ci' }), 201);
    const script = new Client({ apiKey: key });
    await script.upload(await makePng(16, 16));
    const done = await runToCompletion(
      script,
      dataOf(await script.post<GenerationDTO>('/generations', textToImage(prompt)), 201).id,
      world.runner({ log: runnerLog }),
    );
    await script.media(done.outputs[0]?.url ?? '');
    await alice.post('/generations', textToImage('blocked? no'), {
      headers: { origin: 'https://evil.example' },
    });
    await alice.post('/auth/login', { email: alice.email, password: 'wrong-password-123' });
    stdout.mockRestore();
    stderr.mockRestore();
    resetLoggerForTests();

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0); // the capture works: debug lines were written
    const loginToken = login.headers
      .getSetCookie()
      .map((line) => /^aivore_session=([^;]+)/.exec(line)?.[1])
      .find(Boolean);
    for (const secret of [
      alice.token,
      loginToken,
      key,
      key.split('_')[2],
      alice.password,
      'wrong-password-123',
      prompt,
    ]) {
      expect(secret).toBeTruthy();
      expect(output).not.toContain(secret ?? '');
    }
    expect(
      world.db.select().from(generations).where(eq(generations.id, done.id)).get()?.prompt,
    ).toBe(prompt);
  });
});
