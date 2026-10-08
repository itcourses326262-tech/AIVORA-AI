import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { hashPassword } from '@/server/auth/password';
import { SESSION_ABSOLUTE_MAX_MS, SESSION_TTL_MS } from '@/server/auth/sessions';
import { freshDb } from '../../../../helpers/db';
import { createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { PASSWORD, browser, cookieNamed, routeTestState, type ParsedCookie } from './support';

// A server component asks `cookies()` for the session; the test plays the browser's cookie jar.
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
routeTestState();

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2031, 0, 5, 8, 0, 0);

let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

afterEach(() => {
  vi.useRealTimers();
  cookieStore.value = undefined;
});

/** What a browser does with the session cookie: keep it until its Expires, send it while it lives. */
class CookieJar {
  private stored: { value: string; expiresAt: number } | undefined;

  accept(cookie: ParsedCookie): void {
    const maxAgeMs = Number(cookie.attributes.get('max-age')) * 1000;
    this.stored = { value: cookie.value, expiresAt: Date.now() + maxAgeMs };
  }

  /** The `Cookie` header the browser would send now, or undefined once the cookie has expired. */
  header(): string | undefined {
    return this.stored && Date.now() < this.stored.expiresAt
      ? `aivore_session=${this.stored.value}`
      : undefined;
  }

  get token(): string {
    if (!this.stored) throw new Error('no cookie');
    return this.stored.value;
  }
}

async function signIn(jar: CookieJar): Promise<string> {
  const user = createUser(harness.db, { email: 'daily@example.com', passwordHash });
  const result = await invokeRoute(login, {
    url: '/api/v1/auth/login',
    method: 'POST',
    body: { email: user.email, password: PASSWORD },
    headers: browser(),
  });
  expect(result.status).toBe(200);
  jar.accept(cookieNamed(result, 'aivore_session'));
  return user.id;
}

function whoami(cookie: string | undefined) {
  return invokeRoute<{ data: { id: string } | null }>(me, {
    url: '/api/v1/auth/me',
    headers: cookie ? { cookie } : {},
  });
}

describe('session cookie lifetime in a browser', () => {
  it('keeps an active user signed in far beyond 30 days, whichever request extends the session first', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    const jar = new CookieJar();
    const userId = await signIn(jar);

    for (let day = 1; day <= 120; day += 1) {
      vi.setSystemTime(START + day * DAY + 9 * 3600 * 1000);
      const header = jar.header();
      expect(header, `the browser dropped the cookie on day ${day}`).toBeDefined();

      // A page navigation runs on the server first. It extends the database session (at most
      // hourly) but a server component cannot set a cookie ...
      cookieStore.value = jar.token;
      expect((await getCurrentUser())?.id, `page, day ${day}`).toBe(userId);
      // ... so by the time the client asks /auth/me there is nothing left to extend, and nothing
      // may depend on that call to keep the cookie alive.
      const result = await whoami(header);
      expect(result.json.data?.id, `/auth/me, day ${day}`).toBe(userId);
      expect(result.headers.getSetCookie()).toEqual([]);
    }
  });

  it('issues the cookie for the absolute cap while the database enforces the 30 day idle expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    const jar = new CookieJar();
    await signIn(jar);

    // The browser still holds the cookie after 31 idle days, but the server no longer honours it.
    vi.setSystemTime(START + SESSION_TTL_MS + DAY);
    const header = jar.header();
    expect(header).toBeDefined();
    expect((await whoami(header)).json.data).toBeNull();
  });

  it('ends at the absolute cap in the browser and on the server alike', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(START);
    const jar = new CookieJar();
    const userId = await signIn(jar);

    // Used every 25 days: well inside the idle window, so only the absolute cap can end it.
    for (let elapsed = 25 * DAY; elapsed < SESSION_ABSOLUTE_MAX_MS; elapsed += 25 * DAY) {
      vi.setSystemTime(START + elapsed);
      expect((await whoami(jar.header())).json.data?.id, `day ${elapsed / DAY}`).toBe(userId);
    }
    const stolenToken = jar.token;
    vi.setSystemTime(START + SESSION_ABSOLUTE_MAX_MS + DAY);
    expect(jar.header()).toBeUndefined();
    // A copy of the cookie held outside the browser is refused too.
    expect((await whoami(`aivore_session=${stolenToken}`)).json.data).toBeNull();
  });
});
