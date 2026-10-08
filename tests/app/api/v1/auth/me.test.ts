import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { sessions, users } from '@/server/db/schema';
import { createApiKey } from '@/server/auth/api-keys';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { expectUserDTO, routeTestState, stubEnv } from './support';

const harness = freshDb();
routeTestState();

function get(headers: Record<string, string> = {}) {
  return invokeRoute<{ data: unknown }>(me, { url: '/api/v1/auth/me', headers });
}

describe('GET /api/v1/auth/me', () => {
  it('is { data: null } for visitors, never an error', async () => {
    for (const headers of [
      {},
      { cookie: 'theme=dark' },
      { cookie: 'aivore_session=garbage' },
      { cookie: `aivore_session=${'A'.repeat(43)}` },
      { authorization: 'Bearer avk_zzzzzzzz_' + 'z'.repeat(43) },
    ] as Array<Record<string, string>>) {
      const result = await get(headers);
      expect(result.status).toBe(200);
      expect(result.json).toEqual({ data: null });
    }
  });

  it('returns the UserDTO of a session', async () => {
    const user = createUser(harness.db, {
      name: 'Noor',
      role: 'admin',
      locale: 'en',
      creditBalance: 17,
    });
    const session = createSession(harness.db, user.id);
    const result = await get({ cookie: session.cookie });
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({
      id: user.id,
      name: 'Noor',
      role: 'admin',
      locale: 'en',
      creditBalance: 17,
      createdAt: user.createdAt,
    });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });

  it('returns the live credit balance', async () => {
    const user = createUser(harness.db, { creditBalance: 5 });
    const session = createSession(harness.db, user.id);
    harness.db.update(users).set({ creditBalance: 99 }).where(eq(users.id, user.id)).run();
    expect((await get({ cookie: session.cookie })).json.data).toMatchObject({ creditBalance: 99 });
  });

  it('also answers for an API key', async () => {
    const user = createUser(harness.db);
    const { key } = await createApiKey(user.id, 'ci');
    const result = await get({ authorization: `Bearer ${key}` });
    expect(result.json.data).toMatchObject({ id: user.id });
  });

  it('is null for a disabled user and for an expired session', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect((await get({ cookie: session.cookie })).json).toEqual({ data: null });

    const other = createUser(harness.db);
    const expired = createSession(harness.db, other.id, { expiresAt: Date.now() - 1000 });
    expect((await get({ cookie: expired.cookie })).json).toEqual({ data: null });
  });

  describe('session cookie', () => {
    it('is never touched: the cookie is issued once, at login, and outlasts the sliding session', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      // Fresh, and 2 h later (when the database row is extended): no Set-Cookie either way.
      expect((await get({ cookie: session.cookie })).headers.getSetCookie()).toEqual([]);
      const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
      harness.db
        .update(sessions)
        .set({ lastSeenAt: twoHoursAgo })
        .where(eq(sessions.id, session.id))
        .run();

      const extended = await get({ cookie: session.cookie });
      expect(extended.json.data).toMatchObject({ id: user.id });
      expect(extended.headers.getSetCookie()).toEqual([]);
      const row = harness.db.select().from(sessions).where(eq(sessions.id, session.id)).get();
      expect(row?.lastSeenAt).toBeGreaterThan(twoHoursAgo); // the database did slide
    });

    it('never sets a session cookie for API key callers', async () => {
      const user = createUser(harness.db);
      const { key } = await createApiKey(user.id, 'ci');
      expect((await get({ authorization: `Bearer ${key}` })).headers.getSetCookie()).toEqual([]);
    });
  });

  describe('rate limits', () => {
    it('signed-in callers have their own budget of 120 a minute, with or without a trusted proxy', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      const other = createUser(harness.db);
      const otherSession = createSession(harness.db, other.id);
      stubEnv({ TRUST_PROXY: 'true' });
      const headers = { cookie: session.cookie, 'x-forwarded-for': '203.0.113.7' };
      for (let index = 0; index < 120; index += 1) {
        const result = await get(headers);
        expect(result.status, `request ${index + 1}`).toBe(200);
        expect(result.headers.get('x-ratelimit-limit')).toBe('120');
      }
      expect((await get(headers)).status).toBe(429);
      // Same address, another user: another bucket.
      expect(
        (await get({ cookie: otherSession.cookie, 'x-forwarded-for': '203.0.113.7' })).status,
      ).toBe(200);
    });

    it('anonymous callers behind a trusted proxy: 120 a minute per address', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 120; index += 1) {
        expect((await get({ 'x-forwarded-for': '203.0.113.7' })).status).toBe(200);
      }
      expect((await get({ 'x-forwarded-for': '203.0.113.7' })).status).toBe(429);
      expect((await get({ 'x-forwarded-for': '203.0.113.8' })).status).toBe(200);
    });

    it('anonymous callers without a trusted proxy share a roomy bucket, not 120 a minute for the whole site', async () => {
      for (let index = 0; index < 130; index += 1) {
        const result = await get({ 'x-forwarded-for': `198.51.100.${(index % 250) + 1}` });
        expect(result.status, `request ${index + 1}`).toBe(200);
      }
      expect((await get()).headers.get('x-ratelimit-limit')).toBe('1200');
    });
  });
});
