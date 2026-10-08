import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { users } from '@/server/db/schema';
import { createApiKey, revokeApiKey } from '@/server/auth/api-keys';
import { authenticate } from '@/server/auth/context';
import { openSession } from '@/server/auth/sessions';

const cookieStore = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'aivore_session' && cookieStore.value !== undefined
        ? { name, value: cookieStore.value }
        : undefined,
  }),
}));

import { getCurrentUser } from '@/server/auth';

const harness = freshDb();

beforeEach(() => {
  cookieStore.value = undefined;
});

function request(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/v1/account', { headers });
}

describe('authenticate', () => {
  it('is null without credentials', async () => {
    expect(await authenticate(request())).toBeNull();
    expect(await authenticate(request({ cookie: 'theme=dark' }))).toBeNull();
  });

  it('authenticates a session cookie and reports the session', async () => {
    const user = createUser(harness.db, { name: 'Sara', role: 'admin', locale: 'en' });
    const session = openSession(harness.db, user.id);
    const auth = await authenticate(
      request({ cookie: `theme=dark; aivore_session=${session.token}` }),
    );
    expect(auth).toMatchObject({
      via: 'session',
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt,
      sessionRefreshed: false,
      user: {
        id: user.id,
        email: user.email,
        name: 'Sara',
        role: 'admin',
        locale: 'en',
        creditBalance: 50,
      },
    });
    expect(auth?.user).not.toHaveProperty('passwordHash');
  });

  it('authenticates a Bearer API key', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'ci');
    const auth = await authenticate(request({ authorization: `Bearer ${key}` }));
    expect(auth).toMatchObject({ via: 'api_key', apiKeyId: record.id, user: { id: user.id } });
    expect(auth).not.toHaveProperty('sessionId');
    // Scheme is case-insensitive, extra spaces tolerated.
    expect((await authenticate(request({ authorization: `bearer   ${key}  ` })))?.via).toBe(
      'api_key',
    );
  });

  it('rejects revoked, unknown and malformed keys, and keys of disabled users', async () => {
    const user = createUser(harness.db);
    const { key, record } = await createApiKey(user.id, 'ci');
    const live = await createApiKey(user.id, 'live');

    expect(
      await authenticate(request({ authorization: `Bearer ${key.slice(0, -2)}xx` })),
    ).toBeNull();
    expect(await authenticate(request({ authorization: 'Bearer avk_' }))).toBeNull();
    await revokeApiKey(user.id, record.id);
    expect(await authenticate(request({ authorization: `Bearer ${key}` }))).toBeNull();

    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(await authenticate(request({ authorization: `Bearer ${live.key}` }))).toBeNull();
  });

  it('treats a presented API key as authoritative: a bad key plus a good cookie is anonymous', async () => {
    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id);
    const auth = await authenticate(
      request({
        authorization: `Bearer avk_${'a'.repeat(8)}_${'b'.repeat(43)}`,
        cookie: `aivore_session=${session.token}`,
      }),
    );
    expect(auth).toBeNull();
  });

  it('falls back to the cookie when the Authorization header is not an API key', async () => {
    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id);
    const cookie = `aivore_session=${session.token}`;
    expect(
      (await authenticate(request({ authorization: 'Basic dXNlcjpwYXNz', cookie })))?.via,
    ).toBe('session');
    expect(
      (await authenticate(request({ authorization: 'Bearer something-else', cookie })))?.via,
    ).toBe('session');
    // A session token is not accepted as a Bearer credential.
    expect(await authenticate(request({ authorization: `Bearer ${session.token}` }))).toBeNull();
  });

  it('does not accept an API key in the cookie, or a session token as an API key', async () => {
    const user = createUser(harness.db);
    const { key } = await createApiKey(user.id, 'ci');
    expect(await authenticate(request({ cookie: `aivore_session=${key}` }))).toBeNull();
  });

  it('is null for a disabled user, an expired session and a revoked session', async () => {
    const user = createUser(harness.db);
    const expired = openSession(harness.db, user.id, {}, Date.now() - 31 * 24 * 3600 * 1000);
    expect(await authenticate(request({ cookie: `aivore_session=${expired.token}` }))).toBeNull();

    const live = openSession(harness.db, user.id);
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(await authenticate(request({ cookie: `aivore_session=${live.token}` }))).toBeNull();
  });

  it('reports a session whose expiry was extended by this request', async () => {
    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id, {}, Date.now() - 2 * 3600 * 1000);
    const auth = await authenticate(request({ cookie: `aivore_session=${session.token}` }));
    expect(auth?.sessionRefreshed).toBe(true);
    expect(auth?.sessionExpiresAt).toBeGreaterThan(session.expiresAt);
  });
});

describe('getCurrentUser', () => {
  it('returns the user of the request cookie', async () => {
    const user = createUser(harness.db, { name: 'Omar' });
    cookieStore.value = openSession(harness.db, user.id).token;
    expect(await getCurrentUser()).toMatchObject({ id: user.id, name: 'Omar' });
  });

  it('is null without a cookie, with a bad cookie, for a disabled user and after logout', async () => {
    expect(await getCurrentUser()).toBeNull();
    cookieStore.value = 'not-a-token';
    expect(await getCurrentUser()).toBeNull();

    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id);
    cookieStore.value = session.token;
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(await getCurrentUser()).toBeNull();

    harness.db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id)).run();
    expect(await getCurrentUser()).not.toBeNull();
    const { logout } = await import('@/server/auth/sessions');
    await logout(session.token);
    expect(await getCurrentUser()).toBeNull();
  });

  it('is null for an expired session', async () => {
    const user = createUser(harness.db);
    cookieStore.value = openSession(
      harness.db,
      user.id,
      {},
      Date.now() - 40 * 24 * 3600 * 1000,
    ).token;
    expect(await getCurrentUser()).toBeNull();
  });
});
