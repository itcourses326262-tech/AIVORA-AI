import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { POST as register } from '@/app/api/v1/auth/register/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { creditLedger, sessions, users } from '@/server/db/schema';
import { freshDb } from '../../../../helpers/db';
import { invokeRoute } from '../../../../helpers/http';
import { createUser, createSession } from '../../../../helpers/factories';
import {
  APP_URL,
  PASSWORD,
  browser,
  cookieNamed,
  expectUserDTO,
  setCookies,
  stubEnv,
  routeTestState,
  type ErrorBody,
} from './support';

const harness = freshDb();
routeTestState();

const URL_ = '/api/v1/auth/register';
const valid = { email: 'Lina@Example.com', password: PASSWORD, name: 'Lina Hassan', locale: 'en' };

function post(body: unknown, headers: Record<string, string> = browser()) {
  return invokeRoute<{ data: unknown } & ErrorBody>(register, {
    url: URL_,
    method: 'POST',
    body,
    headers,
  });
}

describe('POST /api/v1/auth/register', () => {
  it('creates the account: 201, UserDTO, bonus credits, session and locale cookies', async () => {
    const result = await post(valid);

    expect(result.status).toBe(201);
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({
      email: 'lina@example.com',
      name: 'Lina Hassan',
      role: 'user',
      locale: 'en',
      creditBalance: 50,
    });
    expect(result.text).not.toMatch(/passwordHash|scrypt|password/i);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-ratelimit-limit')).toBe('5');

    const session = cookieNamed(result, 'aivore_session');
    expect(session.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(session.attributes.has('httponly')).toBe(true);
    expect(session.attributes.get('samesite')).toBe('Lax');
    expect(session.attributes.get('path')).toBe('/');
    expect(Number(session.attributes.get('max-age'))).toBeGreaterThan(29 * 24 * 3600);
    const locale = cookieNamed(result, 'aivore_locale');
    expect(locale.value).toBe('en');
    expect(locale.attributes.has('httponly')).toBe(false); // readable by the UI on purpose

    // The cookie really is a working session, and the bonus is in the ledger.
    const whoami = await invokeRoute<{ data: { id: string } }>(me, {
      url: '/api/v1/auth/me',
      headers: { cookie: `aivore_session=${session.value}` },
    });
    expect(whoami.json.data.id).toBe((result.json.data as { id: string }).id);
    expect(harness.db.select().from(creditLedger).all()).toMatchObject([
      { delta: 50, balanceAfter: 50, reason: 'signup_bonus' },
    ]);
  });

  it('takes the language from Accept-Language when none is given, and the body wins when it is', async () => {
    const inferred = await post(
      { email: 'a@example.com', password: PASSWORD, name: 'A' },
      browser(undefined, { 'accept-language': 'en-GB,en;q=0.9' }),
    );
    expect(inferred.json.data).toMatchObject({ locale: 'en' });
    expect(cookieNamed(inferred, 'aivore_locale').value).toBe('en');

    const fallback = await post({ email: 'b@example.com', password: PASSWORD, name: 'B' });
    expect(fallback.json.data).toMatchObject({ locale: 'ar' });

    const explicit = await post(
      { email: 'c@example.com', password: PASSWORD, name: 'C', locale: 'ar' },
      browser(undefined, { 'accept-language': 'en' }),
    );
    expect(explicit.json.data).toMatchObject({ locale: 'ar' });
  });

  it('is closed with SIGNUP_ENABLED=false', async () => {
    stubEnv({ SIGNUP_ENABLED: 'false' });
    const result = await post(valid);
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('signup_disabled');
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(harness.db.select().from(users).all()).toHaveLength(0);
  });

  it('makes ADMIN_EMAILS addresses admins', async () => {
    stubEnv({ ADMIN_EMAILS: 'lina@example.com' });
    const result = await post(valid);
    expect(result.json.data).toMatchObject({ role: 'admin' });
  });

  it('answers a taken email with a generic 409 and sets no cookie', async () => {
    await post(valid);
    const again = await post({ ...valid, name: 'Someone else' });
    expect(again.status).toBe(409);
    expect(again.json.error.code).toBe('conflict');
    expect(again.json.error.message).not.toMatch(/email|exist|taken|already/i);
    expect(again.headers.getSetCookie()).toEqual([]);
    expect(harness.db.select().from(users).all()).toHaveLength(1);
  });

  it('reports validation problems per field with 422', async () => {
    stubEnv({ RATE_LIMIT_DISABLED: 'true' }); // ten attempts, more than the hourly budget
    const cases: Array<[unknown, string]> = [
      [{ ...valid, email: 'nope' }, 'email'],
      [{ ...valid, password: 'short' }, 'password'],
      [{ ...valid, password: 'password123' }, 'password'],
      [{ ...valid, name: '' }, 'name'],
      [{ ...valid, locale: 'fr' }, 'locale'],
      [{ ...valid, email: undefined }, 'email'],
      [{ email: 'x@example.com', name: 'X' }, 'password'],
      [{ ...valid, password: 12345678 }, 'password'],
      [{ ...valid, password: 'p'.repeat(300) }, 'password'],
      [{ ...valid, name: 'n'.repeat(500) }, 'name'],
    ];
    for (const [body, path] of cases) {
      const result = await post(body);
      expect(result.status, JSON.stringify(body)).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
      expect(result.json.error.details).toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ path })]),
      });
    }
    expect(harness.db.select().from(users).all()).toHaveLength(0);
  });

  it('rejects an empty or malformed body and the wrong content type', async () => {
    expect((await post(undefined)).status).toBe(422);
    expect(
      (
        await invokeRoute(register, {
          url: URL_,
          method: 'POST',
          body: '{broken',
          headers: { ...browser(), 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await invokeRoute(register, {
          url: URL_,
          method: 'POST',
          body: 'email=a',
          headers: { ...browser(), 'content-type': 'application/x-www-form-urlencoded' },
        })
      ).status,
    ).toBe(415);
  });

  it('caps the body at 8 KiB', async () => {
    const result = await post({ ...valid, name: 'x'.repeat(9000) });
    expect(result.status).toBe(413);
  });

  it('allows 5 registrations per hour per address and then answers 429 with Retry-After', async () => {
    for (let index = 0; index < 5; index += 1) {
      const result = await post({ ...valid, email: `user${index}@example.com` });
      expect(result.status).toBe(201);
      expect(result.headers.get('x-ratelimit-remaining')).toBe(String(4 - index));
    }
    const blocked = await post({ ...valid, email: 'user6@example.com' });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(3000);
    expect(harness.db.select().from(users).all()).toHaveLength(5);
  });

  it('counts failed attempts against the budget too (enumeration stays expensive)', async () => {
    await post(valid);
    for (let index = 0; index < 4; index += 1) expect((await post(valid)).status).toBe(409);
    expect((await post(valid)).status).toBe(429);
  });

  it('is not limited when RATE_LIMIT_DISABLED=true (end-to-end tests)', async () => {
    stubEnv({ RATE_LIMIT_DISABLED: 'true' });
    for (let index = 0; index < 7; index += 1) {
      expect((await post({ ...valid, email: `bulk${index}@example.com` })).status).toBe(201);
    }
  });

  it('requires a same-origin browser request (login CSRF protection)', async () => {
    for (const headers of [
      {},
      { origin: 'https://evil.example' },
      { origin: 'null' },
      { referer: 'https://evil.example/' },
    ] as Array<Record<string, string>>) {
      const result = await post(valid, headers);
      expect(result.status, JSON.stringify(headers)).toBe(403);
      expect(result.json.error.code).toBe('forbidden');
    }
    expect((await post(valid, { referer: `${APP_URL}/register` })).status).toBe(201);
    expect(harness.db.select().from(users).all()).toHaveLength(1);
  });

  it('replaces the session the request came with, so old cookies do not pile up', async () => {
    const existing = createUser(harness.db);
    const old = createSession(harness.db, existing.id);
    const result = await post({ ...valid, email: 'fresh@example.com' }, browser(old.cookie));
    expect(result.status).toBe(201);
    expect(harness.db.select().from(sessions).where(eq(sessions.id, old.id)).get()).toBeUndefined();
    expect(cookieNamed(result, 'aivore_session').value).not.toBe(old.token);
    expect(setCookies(result)).toHaveLength(2);
  });
});
