import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { sessions, users } from '@/server/db/schema';
import { createApiKey } from '@/server/auth/api-keys';
import { SESSION_TTL_MS } from '@/server/auth/sessions';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { expectUserDTO, setCookies, useRouteTestState } from './support';

const harness = freshDb();
useRouteTestState();

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
    ]) {
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

  describe('cookie refresh (sliding sessions)', () => {
    it('sends no Set-Cookie while the session was touched recently', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      const result = await get({ cookie: session.cookie });
      expect(result.headers.getSetCookie()).toEqual([]);
    });

    it('re-sends the cookie with the new expiry once the session was extended', async () => {
      const user = createUser(harness.db);
      const session = createSession(harness.db, user.id);
      const twoHoursAgo = Date.now() - 2 * 3600 * 1000;
      harness.db
        .update(sessions)
        .set({ lastSeenAt: twoHoursAgo })
        .where(eq(sessions.id, session.id))
        .run();

      const result = await get({ cookie: session.cookie });
      const [cookie] = setCookies(result);
      expect(setCookies(result)).toHaveLength(1);
      expect(cookie?.name).toBe('aivore_session');
      expect(cookie?.value).toBe(session.token);
      const maxAge = Number(cookie?.attributes.get('max-age'));
      expect(Math.abs(maxAge - SESSION_TTL_MS / 1000)).toBeLessThan(10);
      expect(cookie?.attributes.has('httponly')).toBe(true);

      // And the next request in the same hour does not repeat it.
      expect((await get({ cookie: session.cookie })).headers.getSetCookie()).toEqual([]);
    });

    it('never sets a session cookie for API key callers', async () => {
      const user = createUser(harness.db);
      const { key } = await createApiKey(user.id, 'ci');
      expect((await get({ authorization: `Bearer ${key}` })).headers.getSetCookie()).toEqual([]);
    });
  });
});
