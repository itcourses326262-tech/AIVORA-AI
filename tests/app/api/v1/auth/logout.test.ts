import { describe, expect, it } from 'vitest';
import { POST as logout } from '@/app/api/v1/auth/logout/route';
import { POST as logoutAll } from '@/app/api/v1/auth/logout-all/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { sessions } from '@/server/db/schema';
import { createApiKey } from '@/server/auth/api-keys';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { browser, cookieNamed, useRouteTestState, type ErrorBody } from './support';

const harness = freshDb();
useRouteTestState();

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
    ]) {
      const result = await invokeRoute<ErrorBody>(logout, {
        url: '/api/v1/auth/logout',
        method: 'POST',
        headers,
      });
      expect(result.status).toBe(403);
    }
    expect((await whoami(session.cookie)).json.data?.id).toBe(user.id);
  });

  it('exports POST only: a GET (link, image, prefetch) can never sign anybody out', async () => {
    const module = await import('@/app/api/v1/auth/logout/route');
    expect(Object.keys(module).filter((key) => /^(GET|HEAD|PUT|PATCH|DELETE)$/.test(key))).toEqual(
      [],
    );
    expect(typeof module.POST).toBe('function');
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
});
