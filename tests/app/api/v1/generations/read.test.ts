import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as cancel } from '@/app/api/v1/generations/[id]/cancel/route';
import { DELETE, GET as getOne, PATCH } from '@/app/api/v1/generations/[id]/route';
import { GET as list, POST as create } from '@/app/api/v1/generations/route';
import { newId } from '@/lib/id';
import { getBalance } from '@/server/credits';
import { assets, generations } from '@/server/db/schema';
import { setStorageOverride } from '@/server/storage';
import { freshDb } from '../../../../helpers/db';
import { createAsset, createGeneration, fakeStorage } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { queue } from '../../../../server/generations/support';
import { IMAGE_BODY, caller, routeTestState, type ErrorBody, type Many, type One } from './support';

const harness = freshDb();
routeTestState();

const BASE_TIME = 1_700_000_000_000;

function listFor(headers: Record<string, string>, query: Record<string, string | number> = {}) {
  return invokeRoute<Many>(list, { url: '/api/v1/generations', headers, query });
}

function one(headers: Record<string, string>, id: string) {
  return invokeRoute<One, { id: string }>(getOne, {
    url: `/api/v1/generations/${id}`,
    headers,
    params: { id },
  });
}

function patch(headers: Record<string, string>, id: string, body: unknown) {
  return invokeRoute<One, { id: string }>(PATCH, {
    url: `/api/v1/generations/${id}`,
    method: 'PATCH',
    headers,
    params: { id },
    body,
  });
}

function remove(headers: Record<string, string>, id: string) {
  return invokeRoute<ErrorBody, { id: string }>(DELETE, {
    url: `/api/v1/generations/${id}`,
    method: 'DELETE',
    headers,
    params: { id },
  });
}

function cancelIt(headers: Record<string, string>, id: string) {
  return invokeRoute<One, { id: string }>(cancel, {
    url: `/api/v1/generations/${id}/cancel`,
    method: 'POST',
    headers,
    params: { id },
  });
}

function seed(
  userId: string,
  count: number,
  overrides: Partial<typeof generations.$inferInsert> = {},
) {
  return Array.from({ length: count }, (_, index) =>
    createGeneration(harness.db, {
      userId,
      createdAt: BASE_TIME + index,
      prompt: `prompt ${index}`,
      ...overrides,
    }),
  );
}

describe('GET /api/v1/generations', () => {
  it('requires authentication', async () => {
    expect((await listFor({})).status).toBe(401);
  });

  it("lists only the caller's generations, newest first, in the page envelope", async () => {
    const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
    const mine = seed(alice.userId, 3);
    seed(bob.userId, 5);
    const result = await listFor(alice.browser);
    expect(result.status).toBe(200);
    expect(result.json.data.map((item) => item.id)).toEqual(mine.map((row) => row.id).toReversed());
    expect(result.json.nextCursor).toBeNull();
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('pages with an opaque cursor and never repeats or skips a row, even with equal timestamps', async () => {
    const alice = await caller(harness.db);
    const rows = seed(alice.userId, 23);
    harness.db
      .update(generations)
      .set({ createdAt: BASE_TIME })
      .where(eq(generations.userId, alice.userId))
      .run();

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 20; pages += 1) {
      const result = await listFor(alice.bearer, { limit: 5, ...(cursor ? { cursor } : {}) });
      expect(result.status).toBe(200);
      expect(result.json.data.length).toBeLessThanOrEqual(5);
      seen.push(...result.json.data.map((item) => item.id));
      if (!result.json.nextCursor) break;
      cursor = result.json.nextCursor;
    }
    expect(seen).toHaveLength(23);
    expect(new Set(seen)).toEqual(new Set(rows.map((row) => row.id)));
  });

  it('filters by kind, status, favorite and search text', async () => {
    const alice = await caller(harness.db);
    const video = createGeneration(harness.db, {
      userId: alice.userId,
      tool: 'text-to-video',
      prompt: 'blue whale',
      createdAt: BASE_TIME,
    });
    const fav = createGeneration(harness.db, {
      userId: alice.userId,
      isFavorite: true,
      status: 'succeeded',
      prompt: 'red fox',
      createdAt: BASE_TIME + 1,
    });
    const ids = async (query: Record<string, string>) =>
      (await listFor(alice.bearer, query)).json.data.map((item) => item.id);

    expect(await ids({ kind: 'video' })).toEqual([video.id]);
    expect(await ids({ status: 'succeeded' })).toEqual([fav.id]);
    expect(await ids({ favorite: 'true' })).toEqual([fav.id]);
    expect(await ids({ favorite: '1' })).toEqual([fav.id]);
    expect(await ids({ favorite: 'false' })).toEqual([video.id]);
    expect(await ids({ favorite: '0' })).toEqual([video.id]);
    expect(await ids({ q: 'whale' })).toEqual([video.id]);
    expect(await ids({ q: '%' })).toEqual([]);
  });

  describe('batch polling with ids', () => {
    it('returns exactly the named generations, comma separated or repeated', async () => {
      const alice = await caller(harness.db);
      const rows = seed(alice.userId, 5);
      const [a, b] = [rows[1]?.id ?? '', rows[3]?.id ?? ''];
      const comma = await listFor(alice.bearer, { ids: `${a},${b}` });
      expect(comma.json.data.map((item) => item.id)).toEqual([b, a]);

      const repeated = await invokeRoute<Many>(list, {
        url: '/api/v1/generations',
        headers: alice.bearer,
        query: { ids: [a, b] },
      });
      expect(repeated.json.data.map((item) => item.id)).toEqual([b, a]);
      expect(comma.json.nextCursor).toBeNull();
    });

    it("does not return other users' generations, even when named", async () => {
      const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
      const mine = seed(alice.userId, 1)[0];
      const theirs = seed(bob.userId, 1)[0];
      const result = await listFor(alice.bearer, { ids: `${mine?.id},${theirs?.id}` });
      expect(result.json.data.map((item) => item.id)).toEqual([mine?.id]);
      expect(result.text).not.toContain(theirs?.id ?? 'x');
    });

    it('reflects status and progress changes for polling', async () => {
      const alice = await caller(harness.db);
      const [row] = seed(alice.userId, 1);
      const id = row?.id ?? '';
      harness.db
        .update(generations)
        .set({ status: 'processing', progress: 55 })
        .where(eq(generations.id, id))
        .run();
      expect((await listFor(alice.bearer, { ids: id })).json.data[0]).toMatchObject({
        status: 'processing',
        progress: 55,
      });
    });

    it('takes up to 50 ids and rejects 51 with a pointer at the field', async () => {
      const alice = await caller(harness.db);
      const ids = seed(alice.userId, 51).map((row) => row.id);
      expect(
        (await listFor(alice.bearer, { ids: ids.slice(0, 50).join(',') })).json.data,
      ).toHaveLength(50);
      const tooMany = await listFor(alice.bearer, { ids: ids.join(',') });
      expect(tooMany.status).toBe(422);
      expect(tooMany.json.error.details).toMatchObject({
        issues: [expect.objectContaining({ path: 'ids' })],
      });
    });

    it.each([
      ['an empty list', ''],
      ['a malformed id', 'gen_nope'],
      ['an id of another kind', newId('usr')],
      ['an injection attempt', "x' OR 1=1 --"],
      ['one bad id among good ones', `${newId('gen')},oops`],
    ])('rejects %s with 422', async (_name, ids) => {
      const alice = await caller(harness.db);
      expect((await listFor(alice.bearer, { ids })).status).toBe(422);
    });

    it('is not slowed down by the search limit: polling is generous', async () => {
      const alice = await caller(harness.db);
      const [row] = seed(alice.userId, 1);
      for (let index = 0; index < 150; index += 1) {
        const result = await listFor(alice.bearer, { ids: row?.id ?? '' });
        expect(result.status).toBe(200);
      }
      const last = await listFor(alice.bearer, { ids: row?.id ?? '' });
      expect(last.headers.get('x-ratelimit-limit')).toBe('600');
      expect(Number(last.headers.get('x-ratelimit-remaining'))).toBeGreaterThan(400);
    });
  });

  describe('query validation', () => {
    it.each([
      ['an unknown status', { status: 'done' }],
      ['an unknown kind', { kind: 'audio' }],
      ['a limit of zero', { limit: 0 }],
      ['a limit above 100', { limit: 101 }],
      ['a fractional limit', { limit: 2.5 }],
      ['a non-numeric limit', { limit: 'many' }],
      ['an empty search', { q: '' }],
      ['an overlong search', { q: 'x'.repeat(201) }],
      ['a bad favorite flag', { favorite: 'maybe' }],
      ['an empty cursor', { cursor: '' }],
    ])('rejects %s with 422', async (_name, query) => {
      const alice = await caller(harness.db);
      expect((await listFor(alice.bearer, query)).status).toBe(422);
    });

    it('rejects a cursor that is not ours with 400', async () => {
      const alice = await caller(harness.db);
      const result = await listFor(alice.bearer, { cursor: 'AAAA' });
      expect(result.status).toBe(400);
      expect(result.json.error.code).toBe('bad_request');
    });

    it('ignores query parameters it does not know', async () => {
      const alice = await caller(harness.db);
      seed(alice.userId, 1);
      expect(
        (await listFor(alice.bearer, { userId: 'usr_other', __proto__: 'x' })).json.data,
      ).toHaveLength(1);
    });
  });

  it('limits text searches to 60 a minute without slowing down plain reads', async () => {
    const alice = await caller(harness.db);
    seed(alice.userId, 2);
    for (let index = 0; index < 60; index += 1) {
      expect((await listFor(alice.bearer, { q: 'prompt' })).status).toBe(200);
    }
    const blocked = await listFor(alice.bearer, { q: 'prompt' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect((await listFor(alice.bearer)).status).toBe(200);
  });

  it('never exposes internal fields', async () => {
    const alice = await caller(harness.db);
    seed(alice.userId, 1, {
      workerId: 'worker-9',
      leaseUntil: 1,
      providerJobId: 'remote-1',
      idempotencyKey: 'idem-1',
      attempts: 2,
    });
    const result = await listFor(alice.bearer);
    for (const hidden of [
      'worker-9',
      'remote-1',
      'idem-1',
      'leaseUntil',
      'providerJobId',
      'userId',
      'attempts',
    ]) {
      expect(result.text).not.toContain(hidden);
    }
  });
});

describe('GET /api/v1/generations/[id]', () => {
  it("returns the caller's generation with outputs and input", async () => {
    const alice = await caller(harness.db);
    const input = createAsset(harness.db, { userId: alice.userId });
    const [row] = seed(alice.userId, 1, {
      status: 'succeeded',
      tool: 'image-to-image',
      inputAssetId: input.id,
    });
    createAsset(harness.db, { userId: alice.userId, generationId: row?.id, role: 'output' });
    const result = await one(alice.browser, row?.id ?? '');
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ id: row?.id, status: 'succeeded' });
    expect(result.json.data.outputs).toHaveLength(1);
    expect(result.json.data.input?.id).toBe(input.id);
  });

  it("answers the same 404 for someone else's generation, a missing one and garbage (no IDOR)", async () => {
    const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
    const [secret] = seed(bob.userId, 1, { prompt: "bob's private prompt" });
    const results = await Promise.all(
      [secret?.id ?? '', newId('gen'), 'junk', `gen_${'z'.repeat(26)}`].map((id) =>
        one(alice.browser, id),
      ),
    );
    for (const result of results) {
      expect(result.status).toBe(404);
      expect(result.json.error).toEqual({ code: 'not_found', message: 'Generation not found' });
      expect(result.text).not.toContain('private prompt');
    }
  });

  it('requires authentication', async () => {
    const alice = await caller(harness.db);
    const [row] = seed(alice.userId, 1);
    expect((await one({}, row?.id ?? '')).status).toBe(401);
  });
});

describe('PATCH /api/v1/generations/[id]', () => {
  it('toggles sharing and favorite', async () => {
    const alice = await caller(harness.db);
    const [row] = seed(alice.userId, 1);
    const shared = await patch(alice.browser, row?.id ?? '', { isPublic: true });
    expect(shared.status).toBe(200);
    expect(shared.json.data).toMatchObject({ isPublic: true, isFavorite: false });
    const both = await patch(alice.bearer, row?.id ?? '', { isPublic: false, isFavorite: true });
    expect(both.json.data).toMatchObject({ isPublic: false, isFavorite: true });
  });

  it.each([
    ['an empty body', {}],
    ['an unknown field', { prompt: 'rewritten' }],
    ['a field it must not touch', { status: 'succeeded', cost: 0, userId: 'usr_x' }],
    ['a wrong type', { isPublic: 'yes' }],
    ['a known field next to an unknown one', { isPublic: true, status: 'failed' }],
    ['null', null],
  ])('rejects %s with 422 and changes nothing', async (_name, body) => {
    const alice = await caller(harness.db);
    const [row] = seed(alice.userId, 1);
    const result = await patch(alice.bearer, row?.id ?? '', body);
    expect(result.status).toBe(422);
    expect(
      harness.db
        .select()
        .from(generations)
        .where(eq(generations.id, row?.id ?? ''))
        .get(),
    ).toMatchObject({
      status: 'queued',
      isPublic: false,
      cost: 1,
    });
  });

  it("cannot change someone else's generation", async () => {
    const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
    const [row] = seed(bob.userId, 1);
    const result = await patch(alice.browser, row?.id ?? '', { isPublic: true });
    expect(result.status).toBe(404);
    expect(
      harness.db
        .select()
        .from(generations)
        .where(eq(generations.id, row?.id ?? ''))
        .get()?.isPublic,
    ).toBe(false);
  });

  it('needs the same-origin header for cookie sessions', async () => {
    const alice = await caller(harness.db);
    const [row] = seed(alice.userId, 1);
    const result = await patch({ cookie: alice.browser.cookie ?? '' }, row?.id ?? '', {
      isPublic: true,
    });
    expect(result.status).toBe(403);
  });
});

describe('POST /api/v1/generations/[id]/cancel', () => {
  it('cancels a queued generation and refunds it', async () => {
    const alice = await caller(harness.db);
    const created = await invokeRoute<One>(create, {
      url: '/api/v1/generations',
      method: 'POST',
      headers: alice.browser,
      body: { ...IMAGE_BODY, params: { count: 2 } },
    });
    expect(getBalance(harness.db, alice.userId)).toBe(48);
    const result = await cancelIt(alice.browser, created.json.data.id);
    expect(result.status).toBe(200);
    expect(result.json.data.status).toBe('canceled');
    expect(getBalance(harness.db, alice.userId)).toBe(50);
  });

  it('is harmless to cancel twice and answers 409 for a finished generation', async () => {
    const alice = await caller(harness.db);
    const row = queue(harness.db, { id: alice.userId }, {});
    expect((await cancelIt(alice.bearer, row.id)).status).toBe(200);
    expect((await cancelIt(alice.bearer, row.id)).status).toBe(200);
    expect(getBalance(harness.db, alice.userId)).toBe(50);

    const finished = queue(harness.db, { id: alice.userId }, { status: 'succeeded' });
    const conflict = await cancelIt(alice.bearer, finished.id);
    expect(conflict.status).toBe(409);
    expect(conflict.json.error.code).toBe('conflict');
    expect(getBalance(harness.db, alice.userId)).toBe(49);
  });

  it("cannot cancel someone else's generation", async () => {
    const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
    const row = queue(harness.db, { id: bob.userId }, {});
    const result = await cancelIt(alice.browser, row.id);
    expect(result.status).toBe(404);
    expect(
      harness.db.select().from(generations).where(eq(generations.id, row.id)).get()?.status,
    ).toBe('queued');
    expect(getBalance(harness.db, bob.userId)).toBe(49);
  });

  it('requires authentication and a same-origin cookie', async () => {
    const alice = await caller(harness.db);
    const row = queue(harness.db, { id: alice.userId }, {});
    expect((await cancelIt({}, row.id)).status).toBe(401);
    expect((await cancelIt({ cookie: alice.browser.cookie ?? '' }, row.id)).status).toBe(403);
  });
});

describe('DELETE /api/v1/generations/[id]', () => {
  it('deletes the generation, its files and answers 204 with no body', async () => {
    const storage = fakeStorage();
    setStorageOverride(storage);
    try {
      const alice = await caller(harness.db);
      const [row] = seed(alice.userId, 1, { status: 'succeeded' });
      const output = createAsset(harness.db, {
        userId: alice.userId,
        generationId: row?.id,
        role: 'output',
      });
      await storage.put(output.storageKey, new Uint8Array([1]), { mimeType: 'image/png' });

      const result = await remove(alice.browser, row?.id ?? '');
      expect(result.status).toBe(204);
      expect(result.text).toBe('');
      expect(harness.db.select().from(generations).all()).toHaveLength(0);
      expect(harness.db.select().from(assets).all()).toHaveLength(0);
      expect(storage.objects.size).toBe(0);
      expect((await one(alice.browser, row?.id ?? '')).status).toBe(404);
      expect((await remove(alice.browser, row?.id ?? '')).status).toBe(404);
    } finally {
      setStorageOverride(null);
    }
  });

  it('refunds a generation that was still waiting', async () => {
    const alice = await caller(harness.db);
    const row = queue(harness.db, { id: alice.userId }, { cost: 4 });
    expect((await remove(alice.bearer, row.id)).status).toBe(204);
    expect(getBalance(harness.db, alice.userId)).toBe(50);
  });

  it("cannot delete someone else's generation", async () => {
    const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
    const [row] = seed(bob.userId, 1);
    expect((await remove(alice.bearer, row?.id ?? '')).status).toBe(404);
    expect(harness.db.select().from(generations).all()).toHaveLength(1);
  });

  it('needs the same-origin header for cookie sessions', async () => {
    const alice = await caller(harness.db);
    const [row] = seed(alice.userId, 1);
    expect((await remove({ cookie: alice.browser.cookie ?? '' }, row?.id ?? '')).status).toBe(403);
    expect(harness.db.select().from(generations).all()).toHaveLength(1);
  });
});
