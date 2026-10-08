import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/v1/explore/route';
import type { GenerationDTO, Page } from '@/lib/api-types';
import { generations, users } from '@/server/db/schema';
import { freshDb } from '../../../../helpers/db';
import { createAsset, createGeneration, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { caller, routeTestState, stubEnv, type ErrorBody } from '../generations/support';

const harness = freshDb();
routeTestState();

const BASE_TIME = 1_700_000_000_000;

type Feed = Page<GenerationDTO> & ErrorBody;

function explore(
  query: Record<string, string | number> = {},
  headers: Record<string, string> = {},
) {
  return invokeRoute<Feed>(GET, { url: '/api/v1/explore', query, headers });
}

function publish(userId: string, overrides: Partial<typeof generations.$inferInsert> = {}) {
  const row = createGeneration(harness.db, {
    userId,
    status: 'succeeded',
    isPublic: true,
    createdAt: BASE_TIME,
    ...overrides,
  });
  createAsset(harness.db, { userId, generationId: row.id, role: 'output' });
  return row;
}

describe('GET /api/v1/explore', () => {
  it("needs no account and lists public, succeeded generations with the owner's name", async () => {
    const ann = createUser(harness.db, { name: 'Ann' });
    const row = publish(ann.id, { prompt: 'a red kite' });
    const result = await explore();
    expect(result.status).toBe(200);
    expect(result.json.data).toHaveLength(1);
    expect(result.json.data[0]).toMatchObject({
      id: row.id,
      prompt: 'a red kite',
      status: 'succeeded',
      isPublic: true,
      owner: { name: 'Ann' },
    });
    expect(result.json.data[0]?.outputs[0]?.url).toMatch(/^\/api\/v1\/media\/ast_/);
    expect(result.json.nextCursor).toBeNull();
  });

  it('shows nothing that is private, unfinished or failed', async () => {
    const ann = createUser(harness.db);
    publish(ann.id, { isPublic: false });
    publish(ann.id, { status: 'failed' });
    publish(ann.id, { status: 'queued' });
    publish(ann.id, { status: 'processing' });
    publish(ann.id, { status: 'canceled' });
    const visible = publish(ann.id);
    const result = await explore();
    expect(result.json.data.map((item) => item.id)).toEqual([visible.id]);
  });

  it('never leaks anything about the owner beyond the display name', async () => {
    const ann = createUser(harness.db, { name: 'Ann', email: 'ann.private@example.com' });
    const input = createAsset(harness.db, { userId: ann.id });
    publish(ann.id, {
      isFavorite: true,
      inputAssetId: input.id,
      tool: 'image-to-image',
      workerId: 'worker-secret',
      providerJobId: 'remote-secret',
      idempotencyKey: 'idem-secret',
    });
    const result = await explore();
    const body = result.text;
    for (const secret of [
      ann.id,
      ann.email,
      'ann.private',
      input.id,
      input.storageKey,
      'worker-secret',
      'remote-secret',
      'idem-secret',
      'userId',
      'provider',
      'leaseUntil',
      'attempts',
    ]) {
      expect(body, `leaked ${secret}`).not.toContain(secret);
    }
    expect(result.json.data[0]).not.toHaveProperty('input');
    expect(result.json.data[0]?.isFavorite).toBe(false);
    expect(Object.keys(result.json.data[0]?.owner ?? {})).toEqual(['name']);
  });

  it("does not show a private generation once its owner unshares it, or a disabled account's", async () => {
    const [ann, bob] = [createUser(harness.db), createUser(harness.db)];
    const shared = publish(ann.id);
    publish(bob.id);
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, bob.id)).run();
    expect((await explore()).json.data.map((item) => item.id)).toEqual([shared.id]);
    harness.db
      .update(generations)
      .set({ isPublic: false })
      .where(eq(generations.id, shared.id))
      .run();
    expect((await explore()).json.data).toEqual([]);
  });

  it('pages newest first without repeats, even with equal timestamps', async () => {
    const ann = createUser(harness.db);
    const rows = Array.from({ length: 14 }, () => publish(ann.id));
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const result = await explore({ limit: 5, ...(cursor ? { cursor } : {}) });
      seen.push(...result.json.data.map((item) => item.id));
      if (!result.json.nextCursor) break;
      cursor = result.json.nextCursor;
    }
    expect(seen).toHaveLength(14);
    expect(new Set(seen)).toEqual(new Set(rows.map((row) => row.id)));
  });

  it('filters by kind', async () => {
    const ann = createUser(harness.db);
    const image = publish(ann.id);
    const video = publish(ann.id, { tool: 'text-to-video' });
    expect((await explore({ kind: 'image' })).json.data.map((item) => item.id)).toEqual([image.id]);
    expect((await explore({ kind: 'video' })).json.data.map((item) => item.id)).toEqual([video.id]);
  });

  it('uses a default page of 24 and allows up to 100', async () => {
    const ann = createUser(harness.db);
    for (let index = 0; index < 30; index += 1) publish(ann.id);
    expect((await explore()).json.data).toHaveLength(24);
    expect((await explore({ limit: 100 })).json.data).toHaveLength(30);
  });

  it.each([
    ['an unknown kind', { kind: 'audio' }],
    ['a zero limit', { limit: 0 }],
    ['a limit above 100', { limit: 101 }],
    ['a non-numeric limit', { limit: 'lots' }],
    ['an empty cursor', { cursor: '' }],
  ])('rejects %s with 422', async (_name, query) => {
    expect((await explore(query)).status).toBe(422);
  });

  it('rejects a cursor that is not ours with 400', async () => {
    expect((await explore({ cursor: 'AAAA' })).status).toBe(400);
  });

  it('gives everybody the same answer: credentials are neither required nor read', async () => {
    const ann = createUser(harness.db);
    publish(ann.id);
    const [bob] = [await caller(harness.db)];
    const anonymous = await explore();
    const asBob = await explore({}, bob.browser);
    const withBadKey = await explore({}, { authorization: 'Bearer avk_garbage_garbage' });
    const withBadCookie = await explore({}, { cookie: 'aivore_session=not-a-session' });
    for (const other of [asBob, withBadKey, withBadCookie]) {
      expect(other.status).toBe(200);
      expect(other.text).toBe(anonymous.text);
    }
  });

  it('may be cached for a few seconds, because it is the same for everyone', async () => {
    const result = await explore();
    expect(result.headers.get('cache-control')).toBe(
      'public, max-age=15, stale-while-revalidate=45',
    );
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  describe('rate limits', () => {
    const from = (address: string) => ({ 'x-forwarded-for': address });

    it('allows 60 requests a minute per client address and then answers 429 with Retry-After', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 60; index += 1) {
        expect((await explore({}, from('203.0.113.7'))).status).toBe(200);
      }
      const blocked = await explore({}, from('203.0.113.7'));
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.headers.get('x-ratelimit-limit')).toBe('60');
    });

    it('limits each address on its own: one visitor cannot use up the budget of the others', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 61; index += 1) await explore({}, from('203.0.113.7'));
      expect((await explore({}, from('203.0.113.7'))).status).toBe(429);
      expect((await explore({}, from('203.0.113.8'))).status).toBe(200);
      expect((await explore({}, from('2001:db8:1:2::9'))).status).toBe(200);
    });

    it('rate limits by address before anything else, so an anonymous flood never reaches the database', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 61; index += 1) await explore({}, from('203.0.113.7'));
      // Even a request with bad credentials is answered by the limiter, not by authentication.
      const flood = await explore(
        {},
        { ...from('203.0.113.7'), authorization: 'Bearer avk_garbage_garbage' },
      );
      expect(flood.status).toBe(429);
    });

    it('does not let a single caller switch the feed off for everybody when the address is unknown (no trusted proxy)', async () => {
      // TRUST_PROXY=false: every visitor is the one address "unknown", and a forwarded address is
      // never believed. 62 requests (the old per-address budget plus two) must all be served.
      for (let index = 0; index < 62; index += 1) {
        const result = await explore({}, from(`198.51.100.${index + 1}`));
        expect(result.status, `request ${index + 1}`).toBe(200);
        expect(result.headers.get('x-ratelimit-limit')).toBe('1200');
      }
      // A visitor who has not made a request yet is served as well.
      expect((await explore({}, from('198.51.100.250'))).status).toBe(200);
    });

    it('still stops a flood when the address is unknown, at the larger shared budget', async () => {
      for (let index = 0; index < 1200; index += 1) {
        expect((await explore()).status, `request ${index + 1}`).toBe(200);
      }
      const blocked = await explore();
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(blocked.headers.get('x-ratelimit-limit')).toBe('1200');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    }, 60_000); // 1201 real requests: slow only on a machine that is busy with other work
  });
});
