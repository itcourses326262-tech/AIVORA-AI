import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as logoutAll } from '@/app/api/v1/auth/logout-all/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { sessions } from '@/server/db/schema';
import { createApiKey } from '@/server/auth/api-keys';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { browser, cookieNamed, routeTestState, stubEnv, type ErrorBody } from './support';

const harness = freshDb();
routeTestState();

function whoami(cookie: string) {
  return invokeRoute<{ data: { id: string } | null }>(me, {
    url: '/api/v1/auth/me',
    headers: { cookie },
  });
}

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session, clears the cookie and answers 204', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    const other = createSession(harness.db, user.id);

    const result = await invokeRoute(logout, {
      url: '/api/v1/auth/logout',
      method: 'POST',
      headers: browser(session.cookie),
    });
    expect(result.status).toBe(204);
    expect(result.text).toBe('');
    const cleared = cookieNamed(result, 'aivore_session');
    expect(cleared.value).toBe('');
    expect(cleared.attributes.get('max-age')).toBe('0');
    expect(cleared.attributes.has('httponly')).toBe(true);

    expect((await whoami(session.cookie)).json.data).toBeNull();
    expect((await whoami(other.cookie)).json.data?.id).toBe(user.id); // other devices stay signed in
  });

  it('is idempotent and always clears the cookie: no session, a stale one, a garbage one', async () => {
    for (const cookie of [
      undefined,
      'aivore_session=' + 'A'.repeat(43),
      'aivore_session=garbage',
      'theme=dark',
    ]) {
      const result = await invokeRoute(logout, {
        url: '/api/v1/auth/logout',
        method: 'POST',
        headers: browser(cookie),
      });
      expect(result.status, String(cookie)).toBe(204);
      expect(cookieNamed(result, 'aivore_session').attributes.get('max-age')).toBe('0');
    }
  });

  it('is a CSRF-protected POST: a cross-site page cannot sign the user out', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    for (const headers of [
      { cookie: session.cookie },
      { cookie: session.cookie, origin: 'https://evil.example' },
    ] as Array<Record<string, string>>) {
      const result = await invokeRoute<ErrorBody>(logout, {
        url: '/api/v1/auth/logout',
        method: 'POST',
        headers,
      });
      expect(result.status).toBe(403);
    }
    expect((await whoami(session.cookie)).json.data?.id).toBe(user.id);
  });

  describe('rate limits', () => {
    const signOut = (headers: Record<string, string>) =>
      invokeRoute<ErrorBody>(logout, { url: '/api/v1/auth/logout', method: 'POST', headers });

    it('behind a trusted proxy: 30 a minute per address', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      const headers = browser(undefined, { 'x-forwarded-for': '203.0.113.7' });
      for (let index = 0; index < 30; index += 1) expect((await signOut(headers)).status).toBe(204);
      expect((await signOut(headers)).status).toBe(429);
      const other = browser(undefined, { 'x-forwarded-for': '203.0.113.8' });
      expect((await signOut(other)).status).toBe(204);
    });

    it('without a trusted proxy it is not limited: one bucket for everybody would block every sign-out', async () => {
      for (let index = 0; index < 40; index += 1) {
        const result = await signOut(browser());
        expect(result.status, `request ${index + 1}`).toBe(204);
        expect(result.headers.get('x-ratelimit-limit')).toBeNull();
      }
    });

    it('a cross-site refusal does not spend the budget', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 40; index += 1) {
        const result = await signOut({ 'x-forwarded-for': '203.0.113.7' });
        expect(result.status).toBe(403);
      }
      const ok = await signOut(browser(undefined, { 'x-forwarded-for': '203.0.113.7' }));
      expect(ok.status).toBe(204);
      expect(ok.headers.get('x-ratelimit-remaining')).toBe('29');
    });
  });

  it('exports POST only: a GET (link, image, prefetch) can never sign anybody out', async () => {
    const routeModule = await import('@/app/api/v1/auth/logout/route');
    expect(
      Object.keys(routeModule).filter((key) => /^(GET|HEAD|PUT|PATCH|DELETE)$/.test(key)),
    ).toEqual([]);
    expect(typeof routeModule.POST).toBe('function');
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  it('signs the user out of every device and nobody else', async () => {
    const user = createUser(harness.db);
    const bystander = createUser(harness.db);
    const sessionsOfUser = [
      createSession(harness.db, user.id),
      createSession(harness.db, user.id),
      createSession(harness.db, user.id),
    ];
    const theirs = createSession(harness.db, bystander.id);

    const result = await invokeRoute(logoutAll, {
      url: '/api/v1/auth/logout-all',
      method: 'POST',
      headers: browser(sessionsOfUser[0]?.cookie),
    });
    expect(result.status).toBe(204);
    expect(cookieNamed(result, 'aivore_session').attributes.get('max-age')).toBe('0');
    for (const session of sessionsOfUser)
      expect((await whoami(session.cookie)).json.data).toBeNull();
    expect((await whoami(theirs.cookie)).json.data?.id).toBe(bystander.id);
    expect(harness.db.select().from(sessions).all()).toHaveLength(1);
  });

  it('needs a session: anonymous is 401, an API key is 403, a cross-site request is 403', async () => {
    const user = createUser(harness.db);
    const session = createSession(harness.db, user.id);
    const { key } = await createApiKey(user.id, 'ci');

    expect(
      (
        await invokeRoute<ErrorBody>(logoutAll, {
          url: '/api/v1/auth/logout-all',
          method: 'POST',
          headers: browser(),
        })
      ).status,
    ).toBe(401);
    const viaKey = await invokeRoute<ErrorBody>(logoutAll, {
      url: '/api/v1/auth/logout-all',
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(viaKey.status).toBe(403);
    const crossSite = await invokeRoute<ErrorBody>(logoutAll, {
      url: '/api/v1/auth/logout-all',
      method: 'POST',
      headers: { cookie: session.cookie, origin: 'https://evil.example' },
    });
    expect(crossSite.status).toBe(403);
    expect((await whoami(session.cookie)).json.data?.id).toBe(user.id);
  });

  it('is limited per user, so it works without a trusted proxy and never shares a bucket with logout', async () => {
    const user = createUser(harness.db);
    const bystander = createUser(harness.db);
    const call = async (userId: string) => {
      const session = createSession(harness.db, userId);
      return invokeRoute<ErrorBody>(logoutAll, {
        url: '/api/v1/auth/logout-all',
        method: 'POST',
        headers: browser(session.cookie),
      });
    };
    for (let index = 0; index < 10; index += 1) {
      const result = await call(user.id);
      expect(result.status, `call ${index + 1}`).toBe(204);
      expect(result.headers.get('x-ratelimit-limit')).toBe('10');
    }
    expect((await call(user.id)).status).toBe(429);
    // Same (unknown) address, another user: unaffected.
    expect((await call(bystander.id)).status).toBe(204);
  });
});
