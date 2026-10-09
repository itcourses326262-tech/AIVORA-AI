import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as firebaseSignIn } from '@/app/api/v1/auth/firebase/route';
import { GET as me } from '@/app/api/v1/auth/me/route';
import { SESSION_ABSOLUTE_MAX_MS } from '@/server/auth/sessions';
import { authIdentities, sessions, users } from '@/server/db/schema';
import { getRateLimiter } from '@/server/security/rate-limit';
import { freshDb } from '../../../../helpers/db';
import { createSession, createUser } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import { firebaseKeyFixture } from '../../../../server/auth/firebase-support';
import {
  browser,
  cookieNamed,
  expectUserDTO,
  routeTestState,
  stubEnv,
  type ErrorBody,
} from './support';

const harness = freshDb();
routeTestState();
const minter = firebaseKeyFixture();

const CONFIGURED = {
  FIREBASE_API_KEY: 'k'.repeat(30),
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};
beforeEach(() => stubEnv(CONFIGURED));

function post(body: unknown, headers: Record<string, string> = browser()) {
  return invokeRoute<{ data: unknown } & ErrorBody>(firebaseSignIn, {
    url: '/api/v1/auth/firebase',
    method: 'POST',
    body,
    headers,
  });
}

const goodToken = (overrides: Record<string, unknown> = {}) => minter.mint(overrides);

describe('POST /api/v1/auth/firebase', () => {
  it('signs in: UserDTO, session cookie with the same flags as login, locale cookie, no-store', async () => {
    const result = await post({ idToken: await goodToken({ name: 'Layla' }), locale: 'en' });

    expect(result.status).toBe(200);
    expectUserDTO(result.json.data);
    expect(result.json.data).toMatchObject({
      email: 'layla@example.com',
      name: 'Layla',
      locale: 'en',
      creditBalance: 50,
      emailVerified: true,
      hasPassword: false,
    });
    expect(result.text).not.toMatch(/scrypt|passwordHash|unusable|firebase-uid-1/);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-request-id')).toBeTruthy();

    const session = cookieNamed(result, 'aivore_session');
    expect(session.attributes.has('httponly')).toBe(true);
    expect(session.attributes.get('samesite')).toBe('Lax');
    expect(session.attributes.get('path')).toBe('/');
    const maxAge = Number(session.attributes.get('max-age'));
    expect(Math.abs(maxAge - SESSION_ABSOLUTE_MAX_MS / 1000)).toBeLessThan(10);
    expect(cookieNamed(result, 'aivore_locale').value).toBe('en');

    const whoami = await invokeRoute<{ data: { email: string } }>(me, {
      url: '/api/v1/auth/me',
      headers: { cookie: `aivore_session=${session.value}` },
    });
    expect(whoami.json.data.email).toBe('layla@example.com');
  });

  it('marks the cookie Secure in production', async () => {
    stubEnv({
      NODE_ENV: 'production',
      SESSION_SECRET: 's'.repeat(40),
      APP_URL: 'https://x.example',
    });
    const result = await post(
      { idToken: await goodToken() },
      browser(undefined, { origin: 'https://x.example' }),
    );
    expect(result.status).toBe(200);
    expect(cookieNamed(result, 'aivore_session').attributes.has('secure')).toBe(true);
  });

  it('takes the language of the visitor from the request when the body names none', async () => {
    const result = await post(
      { idToken: await goodToken() },
      browser(undefined, { 'accept-language': 'en-GB,en;q=0.9' }),
    );
    expect(result.json.data).toMatchObject({ locale: 'en' });
    const fallback = await post({
      idToken: await goodToken({ sub: 'u2', email: 'b@example.com' }),
    });
    expect(fallback.json.data).toMatchObject({ locale: 'ar' });
  });

  it('uses the stored language of an existing account for the cookie, not the request', async () => {
    createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now(),
      locale: 'ar',
    });
    const result = await post(
      { idToken: await goodToken(), locale: 'en' },
      browser(undefined, { 'accept-language': 'en' }),
    );
    expect(cookieNamed(result, 'aivore_locale').value).toBe('ar');
  });

  it('issues a new token and revokes the one the request came with (no session fixation)', async () => {
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now(),
    });
    const planted = createSession(harness.db, user.id);
    const result = await post({ idToken: await goodToken() }, browser(planted.cookie));
    expect(result.status).toBe(200);
    expect(cookieNamed(result, 'aivore_session').value).not.toBe(planted.token);
    expect(
      harness.db.select().from(sessions).where(eq(sessions.id, planted.id)).get(),
    ).toBeUndefined();
    expect(harness.db.select().from(sessions).all()).toHaveLength(1);
  });

  describe('when Google sign-in is not configured', () => {
    const OFF: Array<[string, Record<string, string>]> = [
      [
        'nothing is set',
        { FIREBASE_API_KEY: '', FIREBASE_AUTH_DOMAIN: '', FIREBASE_PROJECT_ID: '' },
      ],
      ['FIREBASE_AUTH=off', { FIREBASE_AUTH: 'off' }],
    ];

    it.each(OFF)(
      'answers 404 when %s: no cookie, no account, nothing counted',
      async (_label, env) => {
        const token = await goodToken();
        stubEnv(env);
        const result = await post({ idToken: token });
        expect(result.status).toBe(404);
        expect(result.json.error.code).toBe('not_found');
        expect(result.headers.getSetCookie()).toEqual([]);
        expect(result.headers.get('cache-control')).toBe('no-store');
        expect(result.headers.get('x-request-id')).toBeTruthy();
        expect(result.headers.get('x-ratelimit-limit')).toBeNull();
        expect(harness.db.select().from(users).all()).toHaveLength(0);
      },
    );

    it.each(OFF)(
      'answers 404 for a cross-site request or a broken body too when %s: nothing can probe it',
      async (_label, env) => {
        stubEnv(env);
        for (const [body, headers] of [
          [{ idToken: 'x' }, {}],
          [{ idToken: 'x' }, { origin: 'https://evil.example' }],
          [{}, browser()],
          ['{not json', browser()],
        ] as Array<[unknown, Record<string, string>]>) {
          expect((await post(body, headers)).status).toBe(404);
        }
      },
    );
  });

  describe('request validation', () => {
    it.each([
      ['no body', undefined],
      ['an empty object', {}],
      ['a numeric token', { idToken: 12345 }],
      ['an empty token', { idToken: '' }],
      ['a null token', { idToken: null }],
      ['an array', [{ idToken: 'x' }]],
      ['an unsupported locale', { idToken: 'x', locale: 'fr' }],
    ])('answers 422 for %s', async (_label, body) => {
      const result = await post(body);
      expect(result.status).toBe(422);
      expect(result.json.error.code).toBe('validation_failed');
      expect(result.headers.getSetCookie()).toEqual([]);
    });

    it('answers 400 for malformed JSON', async () => {
      const result = await post('{not json', { ...browser(), 'content-type': 'application/json' });
      expect(result.status).toBe(400);
    });

    it('answers 413 above the body cap', async () => {
      const result = await post({ idToken: 'a'.repeat(20_000) });
      expect(result.status).toBe(413);
    });
  });

  describe('a token that cannot be trusted', () => {
    it('is the same 401 for every kind of problem, with no cookie and no account', async () => {
      const now = Math.floor(Date.now() / 1000);
      const bad = [
        await goodToken({ aud: 'other-project' }),
        await goodToken({ iss: 'https://securetoken.google.com/other' }),
        await goodToken({ exp: now - 3600, iat: now - 7200, auth_time: now - 7200 }),
        await goodToken({ email_verified: false }),
        await goodToken({ firebase: { sign_in_provider: 'password' } }),
        await goodToken({ firebase: { sign_in_provider: 'anonymous' } }),
        await goodToken({ sub: undefined }),
        await minter.mintWithStrangerKey(),
        'not.a.jwt',
        'a'.repeat(5000),
      ];
      const bodies: unknown[] = [];
      for (const idToken of bad) {
        const result = await post({ idToken });
        expect(result.status, idToken.slice(0, 30)).toBe(401);
        expect(result.headers.getSetCookie()).toEqual([]);
        bodies.push(result.json);
      }
      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(bodies[0]).toEqual({
        error: { code: 'unauthorized', message: 'The Google sign-in could not be verified' },
      });
      expect(harness.db.select().from(users).all()).toHaveLength(0);
      expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
    });

    it('does not echo the token back, in the body or the headers', async () => {
      const token = await goodToken({ aud: 'other-project' });
      const result = await post({ idToken: token });
      expect(result.text).not.toContain(token);
      expect([...result.headers.values()].join('\n')).not.toContain(token);
    });
  });

  it('refuses a disabled account with 403 and no cookie', async () => {
    createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now(),
      disabledAt: Date.now(),
    });
    const result = await post({ idToken: await goodToken() });
    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('forbidden');
    expect(result.headers.getSetCookie()).toEqual([]);
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('answers the sign-up rules like registration does', async () => {
    const disposable = await post({
      idToken: await goodToken({ email: 'burner@mailinator.com' }),
    });
    expect(disposable.status).toBe(422);
    expect(disposable.json.error.code).toBe('email_not_allowed');
    stubEnv({ SIGNUP_ENABLED: 'false' });
    const closed = await post({ idToken: await goodToken() });
    expect(closed.status).toBe(403);
    expect(closed.json.error.code).toBe('signup_disabled');
    expect(harness.db.select().from(users).all()).toHaveLength(0);
  });

  it('requires a same-origin browser request', async () => {
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin: 'null' }] as Array<
      Record<string, string>
    >) {
      const result = await post({ idToken: await goodToken() }, headers);
      expect(result.status).toBe(403);
      expect(result.headers.getSetCookie()).toEqual([]);
    }
    expect(harness.db.select().from(users).all()).toHaveLength(0);
  });

  describe('rate limits', () => {
    const fromAddress = (ip: string) => browser(undefined, { 'x-forwarded-for': ip });

    it('behind a trusted proxy: 10 attempts a minute per address, then 429 with Retry-After', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 10; index += 1) {
        const result = await post({}, fromAddress('203.0.113.7'));
        expect(result.status).toBe(422);
        expect(result.headers.get('x-ratelimit-limit')).toBe('10');
      }
      const blocked = await post({ idToken: await goodToken() }, fromAddress('203.0.113.7'));
      expect(blocked.status).toBe(429);
      expect(blocked.json.error.code).toBe('rate_limited');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.headers.getSetCookie()).toEqual([]);
      // Another address is its own budget, and the budget is this route's, not login's.
      const other = await post({ idToken: await goodToken() }, fromAddress('203.0.113.8'));
      expect(other.status).toBe(200);
    });

    it('a request refused as cross-site does not spend the address budget', async () => {
      stubEnv({ TRUST_PROXY: 'true' });
      for (let index = 0; index < 12; index += 1) {
        const result = await post(
          { idToken: 'x' },
          { 'x-forwarded-for': '203.0.113.7', origin: 'https://evil.example' },
        );
        expect(result.status).toBe(403);
        expect(result.headers.get('x-ratelimit-limit')).toBeNull();
      }
      const ok = await post({ idToken: await goodToken() }, fromAddress('203.0.113.7'));
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-ratelimit-remaining')).toBe('9');
    });

    describe('the hourly sign-up budget of an unknown address (no trusted proxy)', () => {
      // The bucket password registration spends too: both ways of making an account share it.
      const BUCKET = 'auth-register-shared:ip:unknown';
      const fill = (hits: number) => {
        for (let hit = 0; hit < hits; hit += 1) getRateLimiter().hit(BUCKET, 60, 3600);
      };
      const newAccount = async (index: number) =>
        post({
          idToken: await goodToken({ sub: `uid-${index}`, email: `person${index}@example.com` }),
        });

      it('stops new accounts at 60 an hour for the whole site, with Retry-After and nothing created', async () => {
        fill(59);
        expect((await newAccount(1)).status).toBe(200);
        const blocked = await newAccount(2);
        expect(blocked.status).toBe(429);
        expect(blocked.json.error.code).toBe('rate_limited');
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(3000);
        expect(blocked.headers.getSetCookie()).toEqual([]);
        expect(harness.db.select().from(users).all()).toHaveLength(1);
        expect(harness.db.select().from(authIdentities).all()).toHaveLength(1);
        expect(harness.db.select().from(sessions).all()).toHaveLength(1);
      });

      it('is spent by new accounts only: returning people, refusals and failures never use it up', async () => {
        fill(58);
        const first = await newAccount(1);
        expect(first.status).toBe(200);
        // Returning sign-ins of the same person, many times over.
        for (let again = 0; again < 5; again += 1) expect((await newAccount(1)).status).toBe(200);
        // A garbage token, a throwaway mailbox, a closed sign-up and a bad body.
        expect((await post({ idToken: 'not.a.jwt' })).status).toBe(401);
        expect(
          (await post({ idToken: await goodToken({ sub: 'x', email: 'a@mailinator.com' }) }))
            .status,
        ).toBe(422);
        expect((await post({})).status).toBe(422);
        stubEnv({ SIGNUP_ENABLED: 'false' });
        expect((await newAccount(9)).status).toBe(403);
        stubEnv({ SIGNUP_ENABLED: 'true' });

        // One place is left: 58 earlier hits plus the first account make 59 of 60.
        expect((await newAccount(2)).status).toBe(200);
        expect((await newAccount(3)).status).toBe(429);
        // And a person who has an account is never turned away by the full budget.
        expect((await newAccount(1)).status).toBe(200);
        expect(harness.db.select().from(users).all()).toHaveLength(2);
      });

      it('gives the hit back when the account could not be stored after the budget was spent', async () => {
        fill(59);
        // The 500 below is the point of the test; the logged stack would only clutter the output.
        vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        harness.db.$client.exec(
          "CREATE TRIGGER fail_ledger BEFORE INSERT ON credit_ledger BEGIN SELECT RAISE(ABORT, 'disk full'); END",
        );
        const failed = await newAccount(1);
        expect(failed.status).toBe(500);
        expect(harness.db.select().from(users).all()).toHaveLength(0);
        harness.db.$client.exec('DROP TRIGGER fail_ledger');

        // The place is still there: the failed attempt did not eat it.
        expect((await newAccount(1)).status).toBe(200);
        expect((await newAccount(2)).status).toBe(429);
      });

      it('is the same bucket as registration: a budget used up there refuses Google sign-ups too', async () => {
        fill(60);
        const blocked = await newAccount(1);
        expect(blocked.status).toBe(429);
        expect(harness.db.select().from(users).all()).toHaveLength(0);
      });

      it('is not used behind a trusted proxy: there every address has its own budget and daily cap', async () => {
        stubEnv({ TRUST_PROXY: 'true' });
        fill(60);
        const result = await post(
          { idToken: await goodToken() },
          { ...browser(), 'x-forwarded-for': '203.0.113.7' },
        );
        expect(result.status).toBe(200);
      });
    });

    it('without a trusted proxy there is no address to count: the cap is not a site-wide switch', async () => {
      for (let index = 0; index < 15; index += 1) {
        const result = await post({}, fromAddress(`198.51.100.${index + 1}`));
        expect(result.status, `request ${index + 1}`).toBe(422);
        expect(result.headers.get('x-ratelimit-limit')).toBeNull();
      }
      expect((await post({ idToken: await goodToken() })).status).toBe(200);
    });
  });
});
