import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/v1/generations/route';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { freshDb } from '../../../../helpers/db';
import { createAsset } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { IMAGE_BODY, caller, routeTestState, stubEnv, type One } from './support';

const harness = freshDb();
routeTestState();

function create(
  headers: Record<string, string>,
  body: unknown,
  extra: Record<string, string> = {},
) {
  return invokeRoute<One>(POST, {
    url: '/api/v1/generations',
    method: 'POST',
    headers: { ...headers, ...extra },
    body,
  });
}

describe('POST /api/v1/generations', () => {
  it('creates a queued generation with 201 and charges for it', async () => {
    const alice = await caller(harness.db);
    const result = await create(alice.browser, IMAGE_BODY);

    expect(result.status).toBe(201);
    expect(result.json.data).toMatchObject({
      id: expect.stringMatching(/^gen_/),
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
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('location')).toBe(`/api/v1/generations/${result.json.data.id}`);
    expect(getBalance(harness.db, alice.userId)).toBe(49);
  });

  it('works with an API key as well as with a browser session', async () => {
    const dev = await caller(harness.db);
    const result = await create(dev.bearer, IMAGE_BODY);
    expect(result.status).toBe(201);
    expect(getBalance(harness.db, dev.userId)).toBe(49);
  });

  it('requires authentication', async () => {
    const anonymous = await create({}, IMAGE_BODY);
    expect(anonymous.status).toBe(401);
    const badKey = await create({ authorization: 'Bearer avk_deadbeef_nope' }, IMAGE_BODY);
    expect(badKey.status).toBe(401);
    expect(harness.db.select().from(generations).all()).toHaveLength(0);
  });

  it('refuses a cookie-authenticated request that does not come from our own origin (CSRF)', async () => {
    const alice = await caller(harness.db);
    const forged = await create(
      { cookie: alice.browser.cookie ?? '', origin: 'https://evil.example' },
      IMAGE_BODY,
    );
    expect(forged.status).toBe(403);
    const noOrigin = await create({ cookie: alice.browser.cookie ?? '' }, IMAGE_BODY);
    expect(noOrigin.status).toBe(403);
    expect(harness.db.select().from(generations).all()).toHaveLength(0);
    expect(getBalance(harness.db, alice.userId)).toBe(50);
  });

  describe('Idempotency-Key', () => {
    it('replays with 200 and the original generation, charging once', async () => {
      const alice = await caller(harness.db);
      const first = await create(alice.browser, IMAGE_BODY, { 'idempotency-key': 'order-1' });
      const again = await create(alice.browser, IMAGE_BODY, { 'idempotency-key': 'order-1' });

      expect(first.status).toBe(201);
      expect(first.headers.get('idempotent-replayed')).toBeNull();
      expect(again.status).toBe(200);
      expect(again.headers.get('idempotent-replayed')).toBe('true');
      expect(again.headers.get('location')).toBe(first.headers.get('location'));
      expect(again.json.data.id).toBe(first.json.data.id);
      expect(harness.db.select().from(generations).all()).toHaveLength(1);
      expect(getBalance(harness.db, alice.userId)).toBe(49);
    });

    it('handles a burst of identical requests with exactly one creation', async () => {
      const alice = await caller(harness.db);
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          create(alice.bearer, IMAGE_BODY, { 'idempotency-key': 'burst' }),
        ),
      );
      expect(results.map((result) => result.status).toSorted()).toEqual([
        200, 200, 200, 200, 200, 201,
      ]);
      expect(new Set(results.map((result) => result.json.data.id)).size).toBe(1);
      expect(getBalance(harness.db, alice.userId)).toBe(49);
    });

    it('answers 409 when the key is reused for a different request', async () => {
      const alice = await caller(harness.db);
      await create(alice.browser, IMAGE_BODY, { 'idempotency-key': 'k' });
      const clash = await create(
        alice.browser,
        { ...IMAGE_BODY, prompt: 'something else' },
        { 'idempotency-key': 'k' },
      );
      expect(clash.status).toBe(409);
      expect(clash.json.error.code).toBe('conflict');
      expect(getBalance(harness.db, alice.userId)).toBe(49);
    });

    it('does not share keys between users', async () => {
      const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
      const a = await create(alice.bearer, IMAGE_BODY, { 'idempotency-key': 'same' });
      const b = await create(bob.bearer, IMAGE_BODY, { 'idempotency-key': 'same' });
      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.json.data.id).not.toBe(b.json.data.id);
    });

    it.each([
      ['empty', ''],
      ['blank', '   '],
      ['a space inside', 'two words'],
      ['129 characters', 'k'.repeat(129)],
      ['a control character', 'a\u0001b'],
    ])('rejects a key that is %s with 422', async (_name, key) => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, IMAGE_BODY, { 'idempotency-key': key });
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
      expect(getBalance(harness.db, alice.userId)).toBe(50);
    });

    it('accepts a 128 character key', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, IMAGE_BODY, { 'idempotency-key': 'k'.repeat(128) });
      expect(result.status).toBe(201);
    });
  });

  describe('validation', () => {
    it('answers 422 with a field-level reason for a request the model cannot serve', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.browser, {
        ...IMAGE_BODY,
        params: { aspectRatio: '21:9', count: 4 },
      });
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
      expect(result.json.error.details).toMatchObject({
        issues: [expect.objectContaining({ path: 'params.aspectRatio', code: 'not_allowed' })],
      });
      expect(getBalance(harness.db, alice.userId)).toBe(50);
    });

    it.each([
      ['a non-object body', 'just text', 'text/plain', 415],
      ['malformed JSON', '{"tool":', 'application/json', 400],
      ['an array', '[]', 'application/json', 422],
      ['null', 'null', 'application/json', 422],
      ['an empty body', '', 'application/json', 422],
    ])('rejects %s', async (_name, body, contentType, status) => {
      const alice = await caller(harness.db);
      const result = await create({ ...alice.bearer, 'content-type': contentType }, body);
      expect(result.status).toBe(status);
      expect(getBalance(harness.db, alice.userId)).toBe(50);
    });

    it('rejects unknown fields instead of ignoring them', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, {
        ...IMAGE_BODY,
        cost: 0,
        userId: 'usr_x',
        status: 'succeeded',
      });
      expect(result.status).toBe(422);
      expect(harness.db.select().from(generations).all()).toHaveLength(0);
    });

    it('rejects a body that is too large before reading it all', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, { ...IMAGE_BODY, prompt: 'x'.repeat(70 * 1024) });
      expect(result.status).toBe(413);
    });

    it('rejects an oversized prompt that fits the body limit', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, { ...IMAGE_BODY, prompt: 'x'.repeat(5000) });
      expect(result.status).toBe(422);
    });

    it('rejects a malformed input asset id as a validation error', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, {
        tool: 'image-to-image',
        modelId: 'aivore-demo-image',
        prompt: 'x',
        inputAssetId: '../../etc/passwd',
      });
      expect(result.status).toBe(422);
    });
  });

  describe('business rules', () => {
    it('answers 402 with the shortfall when the balance is too low', async () => {
      const poor = await caller(harness.db, { creditBalance: 1 });
      const result = await create(poor.bearer, { ...IMAGE_BODY, params: { count: 3 } });
      expect(result.status).toBe(402);
      expect(result.json.error).toMatchObject({
        code: 'insufficient_credits',
        details: { required: 3, balance: 1 },
      });
    });

    it('answers 422 moderation_blocked without echoing the prompt', async () => {
      stubEnv({ MODERATION_BLOCKLIST: 'zorblax' });
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, { ...IMAGE_BODY, prompt: 'a zorblax' });
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe('moderation_blocked');
      expect(result.text).not.toContain('zorblax');
      expect(getBalance(harness.db, alice.userId)).toBe(50);
    });

    it('answers 429 too_many_active at the active limit', async () => {
      stubEnv({ MAX_ACTIVE_PER_USER: '2' });
      const alice = await caller(harness.db);
      await create(alice.bearer, IMAGE_BODY);
      await create(alice.bearer, IMAGE_BODY);
      const third = await create(alice.bearer, IMAGE_BODY);
      expect(third.status).toBe(429);
      expect(third.json.error.code).toBe('too_many_active');
    });

    it("does not let one user use another user's upload as input (and does not reveal it exists)", async () => {
      const [alice, bob] = [await caller(harness.db), await caller(harness.db)];
      const bobsImage = createAsset(harness.db, { userId: bob.userId });
      const body = { tool: 'image-to-image', modelId: 'aivore-demo-image', prompt: 'x' };
      const stolen = await create(alice.bearer, { ...body, inputAssetId: bobsImage.id });
      const missing = await create(alice.bearer, {
        ...body,
        inputAssetId: 'ast_00000000000000000000000000',
      });
      expect(stolen.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(stolen.json.error).toEqual(missing.json.error);
      expect(getBalance(harness.db, alice.userId)).toBe(50);

      const own = createAsset(harness.db, { userId: alice.userId });
      expect((await create(alice.bearer, { ...body, inputAssetId: own.id })).status).toBe(201);
    });

    it('stores what it returned', async () => {
      const alice = await caller(harness.db);
      const result = await create(alice.bearer, {
        ...IMAGE_BODY,
        isPublic: true,
        params: { seed: 5 },
      });
      const row = harness.db
        .select()
        .from(generations)
        .where(eq(generations.id, result.json.data.id))
        .get();
      expect(row).toMatchObject({
        isPublic: true,
        params: { aspectRatio: '1:1', count: 1, seed: 5 },
      });
    });
  });

  describe('rate limit', () => {
    it('allows 30 requests per minute per user and then answers 429 with Retry-After', async () => {
      const alice = await caller(harness.db);
      const bob = await caller(harness.db);
      // Cheap requests that still pass through the limiter: the budget is spent before validation.
      const statuses: number[] = [];
      for (let index = 0; index < 31; index += 1) {
        statuses.push((await create(alice.bearer, { nonsense: true })).status);
      }
      expect(statuses.slice(0, 30).every((status) => status === 422)).toBe(true);
      expect(statuses[30]).toBe(429);

      const blocked = await create(alice.bearer, IMAGE_BODY);
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.headers.get('x-ratelimit-limit')).toBe('30');

      // The budget is per user: somebody else is unaffected.
      expect((await create(bob.bearer, IMAGE_BODY)).status).toBe(201);
    });

    it('counts cookie and key requests of one user in the same bucket', async () => {
      const alice = await caller(harness.db);
      for (let index = 0; index < 15; index += 1) {
        await create(alice.bearer, { nonsense: true });
        await create(alice.browser, { nonsense: true });
      }
      expect((await create(alice.bearer, { nonsense: true })).status).toBe(429);
    });
  });

  it('never leaks internal fields in the response', async () => {
    const alice = await caller(harness.db);
    const result = await create(alice.bearer, IMAGE_BODY, { 'idempotency-key': 'secret-key-1' });
    for (const hidden of [
      'provider',
      'worker',
      'lease',
      'attempts',
      'idempotency',
      'secret-key-1',
      alice.userId,
    ]) {
      expect(result.text).not.toContain(hidden);
    }
  });
});
