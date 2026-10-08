import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as login } from '@/app/api/v1/auth/login/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { sessions, users } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { SESSION_ABSOLUTE_MAX_MS } from '@/server/auth/sessions';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import {
  PASSWORD,
  browser,
  cookieNamed,
  expectUserDTO,
  setCookies,
  stubEnv,
  routeTestState,
  type ErrorBody,
} from './support';
import { beforeAll } from 'vitest';

const harness = freshDb();
routeTestState();

let passwordHash = '';
beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

function post(body: unknown, headers: Record<string, string> = browser()) {
  return invokeRoute<{ data: unknown } & ErrorBody>(login, {
    url: '/api/v1/auth/login',
    method: 'POST',
    body,
    headers,
  });
}

function member(overrides: Parameters<typeof createUser>[1] = {}) {
  return createUser(harness.db, {
    email: 'member@example.com',
    name: 'Member',
    passwordHash,
    locale: 'en',
    ...overrides,
  });
}

function other() {
  return createUser(harness.db, {
    email: 'second@example.com',
    name: 'Second',
    passwordHash,
    locale: 'en',
  });
}

describe('POST /api/v1/auth/login', () => {
  it('signs in: UserDTO, session cookie and the locale cookie of the account', async () => {
    const user = member({ locale: 'en', creditBalance: 33 });
    const result = await post({ email: 'MEMBER@example.com', password: PASSWORD });

    expect(result.status).toBe(200);
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({ id: user.id, creditBalance: 33, locale: 'en' });
    expect(result.text).not.toMatch(/scrypt|passwordHash/);
    const session = cookieNamed(result, 'aivore_session');
    expect(session.attributes.has('httponly')).toBe(true);
    expect(session.attributes.get('samesite')).toBe('Lax');
    // Lasts until the session's absolute cap, so the browser never drops it before the server would.
    const maxAge = Number(session.attributes.get('max-age'));
    expect(Math.abs(maxAge - SESSION_ABSOLUTE_MAX_MS / 1000)).toBeLessThan(10);
    expect(cookieNamed(result, 'aivore_locale').value).toBe('en');

    const whoami = await invokeRoute<{ data: { id: string } }>(me, {
      url: '/api/v1/auth/me',
      headers: { cookie: `aivore_session=${session.value}` },
    });
    expect(whoami.json.data.id).toBe(user.id);
  });

  it('sets the cookie locale from the account, not from the request', async () => {
    member({ locale: 'ar' });
    const result = await post(
      { email: 'member@example.com', password: PASSWORD },
      browser(undefined, { 'accept-language': 'en' }),
    );
    expect(cookieNamed(result, 'aivore_locale').value).toBe('ar');
  });

  it('returns the identical 401 for a wrong password, an unknown email and a malformed email', async () => {
    member();
    const attempts = [
      { email: 'member@example.com', password: 'wrong-wrong-1' },
      { email: 'ghost@example.com', password: PASSWORD },
      { email: 'not an email', password: PASSWORD },
    ];
    const bodies = [];
    for (const attempt of attempts) {
      const result = await post(attempt);
      expect(result.status).toBe(401);
      expect(result.headers.getSetCookie()).toEqual([]);
      bodies.push(result.json);
    }
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
    expect(bodies[0]).toEqual({
      error: { code: 'unauthorized', message: 'Invalid email or password' },
    });
  });

  it('blocks disabled accounts with 403 and no cookie', async () => {
    const user = member();
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    const result = await post({ email: user.email, password: PASSWORD });
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('forbidden');
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('validates the body', async () => {
    for (const body of [
      undefined,
      {},
      { email: 'a@example.com' },
      { email: 5, password: 'x' },
      { email: 'a@example.com', password: '' },
      { email: 'a@example.com', password: 'x'.repeat(2000) },
    ]) {
      const result = await post(body);
      expect(result.status, JSON.stringify(body)).toBe(422);
    }
  });

  describe('rate limits', () => {
    const fromAddress = (ip: string) => browser(undefined, { 'x-forwarded-for': ip });
    // Failing validation is cheap and still counts as an attempt against the address budget.
    const junk = (headers: Record<string, string>) => post({ email: 'a@example.com' }, headers);

    it('behind a trusted proxy: 10 attempts a minute per address, the 11th is 429 even with the right password', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      member();
      for (let index = 0; index < 10; index += 1) {
        const result = await junk(fromAddress('203.0.113.7'));
        expect(result.status).toBe(422);
        expect(result.headers.get('x-ratelimit-limit')).toBe('10');
      }
      const blocked = await post(
        { email: 'member@example.com', password: PASSWORD },
        fromAddress('203.0.113.7'),
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(Number(blocked.headers.get('retry-after'))).toBeLessThanOrEqual(60);
      expect(blocked.headers.getSetCookie()).toEqual([]);
      // Another address is a different budget.
      const other = await post(
        { email: 'member@example.com', password: PASSWORD },
        fromAddress('203.0.113.8'),
      );
      expect(other.status).toBe(200);
    });

    it('behind a trusted proxy: also limits per address AND email', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      member();
      const attempt = (ip: string) =>
        post({ email: 'member@example.com', password: 'wrong-wrong-1' }, fromAddress(ip));
      for (let index = 0; index < 10; index += 1)
        expect((await attempt('203.0.113.7')).status).toBe(401);
      expect((await attempt('203.0.113.7')).status).toBe(429);
      // Another address is a different budget.
      expect((await attempt('203.0.113.8')).status).toBe(401);
    });

    it('without a trusted proxy there is no address to count: the cap is not a site-wide switch', async () => {
      member();
      // Fifteen requests, with a different spoofed address each time, from "everybody".
      for (let index = 0; index < 15; index += 1) {
        const result = await junk(fromAddress(`198.51.100.${index + 1}`));
        expect(result.status, `request ${index + 1}`).toBe(422);
        expect(result.headers.get('x-ratelimit-limit')).toBeNull();
      }
      // So a real user can still sign in.
      const real = await post({ email: 'member@example.com', password: PASSWORD });
      expect(real.status).toBe(200);
    });

    it('without a trusted proxy the per-account limit still stops guessing, whatever the headers claim', async () => {
      member();
      other();
      const guess = (index: number) =>
        post(
          { email: 'member@example.com', password: 'wrong-wrong-1' },
          fromAddress(`198.51.100.${index + 1}`),
        );
      for (let index = 0; index < 10; index += 1) expect((await guess(index)).status).toBe(401);
      const blocked = await post(
        { email: 'member@example.com', password: PASSWORD },
        fromAddress('198.51.100.99'),
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(blocked.headers.getSetCookie()).toEqual([]);
      // Another account is untouched.
      const second = await post({ email: 'second@example.com', password: PASSWORD });
      expect(second.status).toBe(200);
    });

    it('a request refused as cross-site does not spend the address budget', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      member();
      for (const headers of [
        { 'x-forwarded-for': '203.0.113.7' },
        { 'x-forwarded-for': '203.0.113.7', origin: 'https://evil.example' },
        { 'x-forwarded-for': '203.0.113.7', origin: 'null' },
      ] as Array<Record<string, string>>) {
        for (let index = 0; index < 5; index += 1) {
          const result = await post({ email: 'member@example.com', password: PASSWORD }, headers);
          expect(result.status).toBe(403);
          expect(result.headers.get('x-ratelimit-limit')).toBeNull();
          expect(result.headers.get('x-request-id')).toBeTruthy();
          expect(result.headers.get('cache-control')).toBe('no-store');
        }
      }
      // Fifteen refusals later the visitor still has the whole budget: this is attempt 1 of 10.
      const ok = await post(
        { email: 'member@example.com', password: PASSWORD },
        fromAddress('203.0.113.7'),
      );
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-ratelimit-remaining')).toBe('9');
    });
  });

  it('requires a same-origin browser request', async () => {
    member();
    for (const headers of [{}, { origin: 'https://evil.example' }] as Array<
      Record<string, string>
    >) {
      const result = await post({ email: 'member@example.com', password: PASSWORD }, headers);
      expect(result.status).toBe(403);
      expect(result.headers.getSetCookie()).toEqual([]);
    }
  });

  it('issues a new token and revokes the one the request came with (no session fixation)', async () => {
    const user = member();
    const planted = createSession(harness.db, user.id);
    const result = await post({ email: user.email, password: PASSWORD }, browser(planted.cookie));
    expect(result.status).toBe(200);
    const issued = cookieNamed(result, 'aivore_session').value;
    expect(issued).not.toBe(planted.token);
    expect(
      harness.db.select().from(sessions).where(eq(sessions.id, planted.id)).get(),
    ).toBeUndefined();
    expect(harness.db.select().from(sessions).all()).toHaveLength(1);
    expect(setCookies(result)).toHaveLength(2);
  });

  it('a session cookie sent with the login request is not authentication: wrong password stays 401', async () => {
    const user = member();
    const existing = createSession(harness.db, user.id);
    const result = await post(
      { email: user.email, password: 'wrong-wrong-1' },
      browser(existing.cookie),
    );
    expect(result.status).toBe(401);
    expect(
      harness.db.select().from(sessions).where(eq(sessions.id, existing.id)).get(),
    ).toBeDefined();
  });
});
