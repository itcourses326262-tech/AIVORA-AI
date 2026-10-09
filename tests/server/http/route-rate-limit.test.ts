import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getMe } from '@/app/api/v1/auth/me/route';
import { POST as postLogin } from '@/app/api/v1/auth/login/route';
import { POST as postRegister } from '@/app/api/v1/auth/register/route';
import { GET as getPlans } from '@/app/api/v1/billing/plans/route';
import { GET as getReturn } from '@/app/api/v1/billing/return/route';
import { GET as getExplore } from '@/app/api/v1/explore/route';
import { GET as getModels } from '@/app/api/v1/models/route';
import { GET as getTools } from '@/app/api/v1/tools/route';
import { AppError } from '@/lib/errors';
import { createApiKey } from '@/server/auth';
import { resetEnvForTests } from '@/server/env';
import { ANONYMOUS_UNKNOWN_FACTOR, route } from '@/server/http/route';
import { resetLoggerForTests } from '@/server/logger';
import {
  InMemoryRateLimiter,
  getRateLimiter,
  setRateLimiter,
  type RateLimiter,
} from '@/server/security/rate-limit';
import { createUser, createUserWithSession } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { invokeRoute } from '../../helpers/http';
import { GOOD_PASSWORD, passwordFixture } from '../auth/support';

/*
 * The availability bug of the integration run: with TRUST_PROXY unset every caller is the address
 * `unknown`, so all anonymous callers shared one bucket per route class and, after 240 anonymous
 * GET /models, a signed-in user got 429 too. Everything here goes through the real `route()`, the
 * real limiter, the real session lookup and the real client-address logic; nothing is mocked.
 */

const database = freshDb();
const hash = passwordFixture();
vi.setConfig({ testTimeout: 60_000 });

const CATALOG_LIMIT = 240;
const MODELS = { url: '/api/v1/models' };
const TOOLS = { url: '/api/v1/tools' };

beforeEach(() => {
  vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
  vi.stubEnv('TRUST_PROXY', 'false');
  vi.stubEnv('TRUSTED_PROXY_HOPS', '1');
  resetEnvForTests();
  setRateLimiter(new InMemoryRateLimiter());
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
  setRateLimiter(null);
});

async function flood(
  count: number,
  headers: (index: number) => Record<string, string> = () => ({}),
) {
  let last = 0;
  let rejected = 0;
  for (let index = 0; index < count; index += 1) {
    const result = await invokeRoute(getModels, { ...MODELS, headers: headers(index) });
    last = result.status;
    if (result.status === 429) rejected += 1;
  }
  return { last, rejected };
}

describe('anonymous traffic without a trusted proxy', () => {
  it('1000 anonymous requests do not touch a signed-in user (cookie)', async () => {
    const { session } = createUserWithSession(database.db);
    const { rejected } = await flood(1000);
    expect(rejected).toBe(0); // a dedicated, larger budget: the flood itself is not throttled yet

    const signedIn = await invokeRoute(getModels, { ...MODELS, headers: session.headers });
    expect(signedIn.status).toBe(200);
    // The user's own bucket, untouched by the 1000 anonymous hits.
    expect(signedIn.headers.get('x-ratelimit-limit')).toBe(String(CATALOG_LIMIT));
    expect(signedIn.headers.get('x-ratelimit-remaining')).toBe(String(CATALOG_LIMIT - 1));
    // /tools shares the catalog bucket of /models: still the user's.
    const tools = await invokeRoute(getTools, { ...TOOLS, headers: session.headers });
    expect(tools.status).toBe(200);
    expect(tools.headers.get('x-ratelimit-remaining')).toBe(String(CATALOG_LIMIT - 2));
  });

  it('1000 anonymous requests do not touch a signed-in user (API key)', async () => {
    const { user } = createUserWithSession(database.db);
    const { key } = await createApiKey(user.id, 'ci');
    await flood(1000);
    const result = await invokeRoute(getModels, {
      ...MODELS,
      headers: { authorization: `Bearer ${key}` },
    });
    expect(result.status).toBe(200);
    expect(result.headers.get('x-ratelimit-remaining')).toBe(String(CATALOG_LIMIT - 1));
  });

  it('a script that exhausts the anonymous budget still cannot lock out a signed-in user', async () => {
    const { session } = createUserWithSession(database.db);
    const budget = CATALOG_LIMIT * ANONYMOUS_UNKNOWN_FACTOR;
    const first = await invokeRoute(getModels, MODELS);
    expect(first.headers.get('x-ratelimit-limit')).toBe(String(budget));

    const { last, rejected } = await flood(budget + 5);
    expect(last).toBe(429); // the script itself is throttled ...
    expect(rejected).toBeGreaterThan(0);
    const anonymous = await invokeRoute<{ error: { code: string } }>(getTools, TOOLS);
    expect(anonymous.status).toBe(429); // (the class is shared by /tools) ...
    expect(anonymous.headers.get('retry-after')).toBeTruthy();

    for (let index = 0; index < 5; index += 1) {
      // ... while the signed-in user is served as usual.
      const signedIn = await invokeRoute(getModels, { ...MODELS, headers: session.headers });
      expect(signedIn.status).toBe(200);
    }
  });

  it('keeps enforcing per-user limits', async () => {
    const alice = createUserWithSession(database.db);
    const bob = createUserWithSession(database.db);
    for (let index = 0; index < CATALOG_LIMIT; index += 1) {
      expect(
        (await invokeRoute(getModels, { ...MODELS, headers: alice.session.headers })).status,
      ).toBe(200);
    }
    const blocked = await invokeRoute<{ error: { code: string } }>(getModels, {
      ...MODELS,
      headers: alice.session.headers,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.json.error.code).toBe('rate_limited');
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(blocked.headers.get('x-ratelimit-remaining')).toBe('0');

    // Alice's budget is hers alone: Bob and every anonymous visitor are fine.
    expect((await invokeRoute(getModels, { ...MODELS, headers: bob.session.headers })).status).toBe(
      200,
    );
    expect((await invokeRoute(getModels, MODELS)).status).toBe(200);
  });

  it('ignores a spoofed X-Forwarded-For: it neither buys a fresh bucket nor frames anybody', async () => {
    const budget = CATALOG_LIMIT * ANONYMOUS_UNKNOWN_FACTOR;
    const { last, rejected } = await flood(budget + 3, (index) => ({
      'x-forwarded-for': `198.51.100.${(index % 250) + 1}`,
      'x-real-ip': `203.0.113.${(index % 250) + 1}`,
    }));
    expect(last).toBe(429); // every "different client" was the same anonymous caller
    expect(rejected).toBe(3);

    // A request that claims to be a fresh address is still the same exhausted caller ...
    const spoofed = await invokeRoute(getModels, {
      ...MODELS,
      headers: { 'x-forwarded-for': '192.0.2.200' },
    });
    expect(spoofed.status).toBe(429);
    // ... and nothing was recorded against the addresses it named: with a trusted proxy these
    // would be separate, untouched buckets.
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const named = await invokeRoute(getModels, {
      ...MODELS,
      headers: { 'x-forwarded-for': '198.51.100.1' },
    });
    expect(named.status).toBe(200);
    expect(named.headers.get('x-ratelimit-remaining')).toBe(String(CATALOG_LIMIT - 1));
  });

  it('a signed-in user is not limited by what anonymous callers did before they logged in', async () => {
    // The user browsed anonymously, then logged in: the anonymous history stays anonymous.
    await flood(CATALOG_LIMIT + 50);
    const { session } = createUserWithSession(database.db);
    const result = await invokeRoute(getModels, { ...MODELS, headers: session.headers });
    expect(result.status).toBe(200);
    expect(result.headers.get('x-ratelimit-remaining')).toBe(String(CATALOG_LIMIT - 1));
  });

  it('counts requests with a forged cookie or key as anonymous, not as a free pass', async () => {
    const budget = CATALOG_LIMIT * ANONYMOUS_UNKNOWN_FACTOR;
    const forged = [
      { cookie: 'aivore_session=not-a-real-session-token-0123456789abcdefghijklmnop' },
      { authorization: 'Bearer avk_abcdefgh_0123456789012345678901234567890123456789012' },
    ];
    const { last } = await flood(budget + 2, (index) => forged[index % 2] ?? {});
    expect(last).toBe(429);
  });
});

describe('the same routes behind a trusted proxy', () => {
  beforeEach(() => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
  });

  it('give every client address its own bucket of the per-address size', async () => {
    const from = (ip: string) => ({ 'x-forwarded-for': ip });
    for (let index = 0; index < CATALOG_LIMIT; index += 1) {
      await invokeRoute(getModels, { ...MODELS, headers: from('203.0.113.10') });
    }
    expect(
      (await invokeRoute(getModels, { ...MODELS, headers: from('203.0.113.10') })).status,
    ).toBe(429);
    const other = await invokeRoute(getModels, { ...MODELS, headers: from('203.0.113.11') });
    expect(other.status).toBe(200);
    expect(other.headers.get('x-ratelimit-limit')).toBe(String(CATALOG_LIMIT));
  });

  it('still key signed-in callers by account, whatever address they come from', async () => {
    const { session } = createUserWithSession(database.db);
    const results: string[] = [];
    for (const ip of ['203.0.113.20', '203.0.113.21', '203.0.113.22']) {
      const result = await invokeRoute(getModels, {
        ...MODELS,
        headers: { ...session.headers, 'x-forwarded-for': ip },
      });
      results.push(result.headers.get('x-ratelimit-remaining') ?? '');
    }
    expect(results).toEqual(['239', '238', '237']);
  });
});

describe('routes with their own sizing for the unknown address (addressRoute)', () => {
  it('/auth/me keeps a per-user bucket for signed-in callers and one shared bucket for visitors', async () => {
    const { session } = createUserWithSession(database.db);
    const visitor = await invokeRoute(getMe, { url: '/api/v1/auth/me' });
    expect(visitor.headers.get('x-ratelimit-limit')).toBe('1200');
    const signedIn = await invokeRoute(getMe, { url: '/api/v1/auth/me', headers: session.headers });
    expect(signedIn.headers.get('x-ratelimit-limit')).toBe('1200');
    expect(signedIn.headers.get('x-ratelimit-remaining')).toBe('1199');
  });
});

describe('login without a trusted proxy', () => {
  const login = (email: string, password: string) =>
    invokeRoute<{ error?: { code: string } }>(postLogin, {
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:3000' },
      body: { email, password },
    });

  it('has no site-wide budget: failed logins for other accounts cannot lock anybody out', async () => {
    const real = createUser(database.db, { email: 'real@example.com', passwordHash: hash.hash });
    for (let index = 0; index < 60; index += 1) {
      const result = await login(`stranger${index}@example.com`, 'wrong password!');
      expect(result.status).toBe(401);
    }
    const ok = await login(real.email, GOOD_PASSWORD);
    expect(ok.status).toBe(200);
  });

  it('keys the attempts on the target email, so a guesser is stopped for that account only', async () => {
    const target = createUser(database.db, {
      email: 'target@example.com',
      passwordHash: hash.hash,
    });
    const other = createUser(database.db, { email: 'other@example.com', passwordHash: hash.hash });
    for (let index = 0; index < 10; index += 1) {
      expect((await login(target.email, `guess number ${index}`)).status).toBe(401);
    }
    const blocked = await login(target.email, 'one more guess');
    expect(blocked.status).toBe(429);
    expect(blocked.json.error?.code).toBe('rate_limited');
    // Another account, from the very same (unknown) address, is unaffected.
    expect((await login(other.email, GOOD_PASSWORD)).status).toBe(200);
  });
});

describe('routes with an explicit per-address budget', () => {
  const strict = { name: 'strict', limit: 2, windowSec: 60, by: 'ip' } as const;

  it('count a request that can change something before authentication, for everybody', async () => {
    const guarded = route({ auth: 'optional', csrf: false, rateLimit: strict }, async () => 'ok');
    const { session } = createUserWithSession(database.db);
    const statuses: number[] = [];
    for (const headers of [{}, session.headers, {}]) {
      statuses.push((await invokeRoute(guarded, { url: '/x', method: 'POST', headers })).status);
    }
    // The signed-in caller spent the shared bucket too: an account is no way around a sign-up or
    // credential budget.
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('keep a known address on the address bucket, signed in or not', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const guarded = route({ auth: 'optional', rateLimit: strict }, async () => 'ok');
    const { session } = createUserWithSession(database.db);
    const from = (headers: Record<string, string>) => ({
      ...headers,
      'x-forwarded-for': '203.0.113.30',
    });
    const statuses: number[] = [];
    for (const headers of [{}, session.headers, {}]) {
      statuses.push((await invokeRoute(guarded, { url: '/x', headers: from(headers) })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });

  it('count a read-only request of a signed-in caller by account when the address is unknown', async () => {
    const guarded = route({ auth: 'optional', rateLimit: strict }, async () => 'ok');
    const { session } = createUserWithSession(database.db);
    const anonymous: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      anonymous.push((await invokeRoute(guarded, { url: '/x' })).status);
    }
    expect(anonymous).toEqual([200, 200, 429]); // the shared bucket is used up ...
    const signedIn = await invokeRoute(guarded, { url: '/x', headers: session.headers });
    expect(signedIn.status).toBe(200); // ... and the signed-in caller has a bucket of their own
    expect(signedIn.headers.get('x-ratelimit-remaining')).toBe('1');
  });
});

describe('the public read routes of addressRoute without a trusted proxy', () => {
  // Exactly the evidence of the review: one script floods the public feed, and every signed-in
  // user's Explore page (which fetches it) used to get 429 with it.
  it('1300 anonymous /explore calls do not starve a signed-in user (cookie)', async () => {
    const { session } = createUserWithSession(database.db);
    let rejected = 0;
    for (let index = 0; index < 1300; index += 1) {
      const result = await invokeRoute(getExplore, { url: '/api/v1/explore' });
      if (result.status === 429) rejected += 1;
    }
    expect(rejected).toBe(100); // the flood itself is throttled at the shared 1200 a minute ...
    const visitor = await invokeRoute(getExplore, { url: '/api/v1/explore' });
    expect(visitor.status).toBe(429);

    const signedIn = await invokeRoute(getExplore, {
      url: '/api/v1/explore',
      headers: session.headers,
    });
    expect(signedIn.status).toBe(200); // ... while the account has its own
    expect(signedIn.headers.get('x-ratelimit-limit')).toBe('1200');
    expect(signedIn.headers.get('x-ratelimit-remaining')).toBe('1199');
  });

  it('the same goes for an API key, and a forged credential is still just a visitor', async () => {
    const { user } = createUserWithSession(database.db);
    const { key } = await createApiKey(user.id, 'ci');
    for (let index = 0; index < 1201; index += 1)
      getRateLimiter().hit('explore-shared:ip:unknown', 1200, 60);

    const withKey = await invokeRoute(getExplore, {
      url: '/api/v1/explore',
      headers: { authorization: `Bearer ${key}` },
    });
    expect(withKey.status).toBe(200);
    const forged = await invokeRoute(getExplore, {
      url: '/api/v1/explore',
      headers: { cookie: 'aivore_session=not-a-real-session-token-0123456789abcdefghijklmnop' },
    });
    expect(forged.status).toBe(429);
  });

  it('keeps a per-account limit for the signed-in caller', async () => {
    const { user, session } = createUserWithSession(database.db);
    for (let index = 0; index < 1200; index += 1) {
      getRateLimiter().hit(`explore-shared:user:${user.id}`, 1200, 60);
    }
    const blocked = await invokeRoute(getExplore, {
      url: '/api/v1/explore',
      headers: session.headers,
    });
    expect(blocked.status).toBe(429);
    const other = createUserWithSession(database.db);
    expect(
      (await invokeRoute(getExplore, { url: '/api/v1/explore', headers: other.session.headers }))
        .status,
    ).toBe(200);
  });

  it.each([
    ['/billing/plans', getPlans, 'billing-plans-shared', 1200],
    ['/billing/return', getReturn, 'billing-return-shared', 600],
  ] as const)(
    '%s: a flooded shared bucket does not starve a signed-in caller',
    async (path, handler, bucket, limit) => {
      const { session } = createUserWithSession(database.db);
      for (let index = 0; index < limit + 1; index += 1) {
        getRateLimiter().hit(`${bucket}:ip:unknown`, limit, 60);
      }
      const url = `/api/v1${path}`;
      expect((await invokeRoute(handler, { url })).status).toBe(429);

      const signedIn = await invokeRoute(handler, { url, headers: session.headers });
      expect(signedIn.status).not.toBe(429);
      expect(signedIn.headers.get('x-ratelimit-limit')).toBe(String(limit));
      expect(signedIn.headers.get('x-ratelimit-remaining')).toBe(String(limit - 1));
    },
  );

  it('behind a trusted proxy the feed stays a per-address budget for everybody', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const { session } = createUserWithSession(database.db);
    const from = (headers: Record<string, string>) => ({
      ...headers,
      'x-forwarded-for': '203.0.113.40',
    });
    for (let index = 0; index < 60; index += 1) {
      await invokeRoute(getExplore, { url: '/api/v1/explore', headers: from({}) });
    }
    const signedIn = await invokeRoute(getExplore, {
      url: '/api/v1/explore',
      headers: from(session.headers),
    });
    expect(signedIn.status).toBe(429); // this address is spent, whoever asks from it
    expect(signedIn.headers.get('x-ratelimit-limit')).toBe('60');
  });
});

describe('register without a trusted proxy', () => {
  const register = (body: unknown, headers: Record<string, string> = {}) =>
    invokeRoute<{ error?: { code: string } }>(postRegister, {
      url: '/api/v1/auth/register',
      headers: { origin: 'http://localhost:3000', ...headers },
      body,
    });
  const valid = (index: number) => ({
    email: `newcomer${index}@example.com`,
    password: GOOD_PASSWORD,
    name: 'Newcomer',
  });

  it('is not closed by garbage: 70 invalid requests leave the budget, and a real sign-up, alone', async () => {
    for (let index = 0; index < 70; index += 1) {
      const result = await register({ email: 'nope', password: 'x', name: '' });
      expect(result.status).toBe(422);
      expect(result.headers.get('x-ratelimit-remaining')).toBe('59'); // never goes down
    }
    const first = await register(valid(1));
    expect(first.status).toBe(201);
    expect(first.headers.get('x-ratelimit-limit')).toBe('60');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('59');
  });

  it('is not closed by refused attempts that did get as far as the account (a taken address)', async () => {
    expect((await register(valid(1))).status).toBe(201);
    for (let index = 0; index < 5; index += 1) {
      const result = await register(valid(1));
      expect(result.status).toBe(409);
      expect(result.headers.get('x-ratelimit-remaining')).toBe('58');
    }
    const second = await register(valid(2));
    expect(second.status).toBe(201);
    expect(second.headers.get('x-ratelimit-remaining')).toBe('58');
  });

  it('still caps the accounts one hour can create, signed in or not, and a refusal by the cap stays counted', async () => {
    const { session } = createUserWithSession(database.db);
    for (let index = 0; index < 60; index += 1)
      getRateLimiter().hit('auth-register-shared:ip:unknown', 60, 3600);

    const visitor = await register(valid(3));
    expect(visitor.status).toBe(429);
    expect(visitor.json.error?.code).toBe('rate_limited');
    const signedIn = await register(valid(4), session.headers);
    expect(signedIn.status).toBe(429);
    // The blocked hits were not given back: the bucket does not drain by being hammered.
    expect((await register(valid(5))).status).toBe(429);
    expect(getRateLimiter().hit('auth-register-shared:ip:unknown', 60, 3600).remaining).toBe(0);
  });

  it('behind a trusted proxy a refused attempt still spends the address budget (guessing stays expensive)', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    resetEnvForTests();
    const from = { 'x-forwarded-for': '203.0.113.50' };
    expect((await register(valid(1), from)).status).toBe(201);
    for (let index = 0; index < 4; index += 1) {
      expect((await register(valid(1), from)).status).toBe(409);
    }
    expect((await register(valid(1), from)).status).toBe(429);
  });
});

describe('count: successes', () => {
  const budget = { name: 'maker', limit: 3, windowSec: 60, by: 'ip', count: 'successes' } as const;

  function maker(fail: () => boolean) {
    return route({ auth: 'none', csrf: false, rateLimit: budget }, async () => {
      if (fail()) throw AppError.of('conflict', 'taken');
      return 'created';
    });
  }
  const call = (handler: ReturnType<typeof maker>) =>
    invokeRoute(handler, { url: '/make', method: 'POST' });

  it('gives a refused request back and keeps the ones that worked', async () => {
    let failing = true;
    const handler = maker(() => failing);
    for (let index = 0; index < 10; index += 1) expect((await call(handler)).status).toBe(409);
    failing = false;
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await call(handler)).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('gives back server errors too, but never a request this budget itself refused', async () => {
    vi.stubEnv('LOG_LEVEL', 'silent'); // the 500 below is on purpose
    resetLoggerForTests();
    const handler = route({ auth: 'none', csrf: false, rateLimit: budget }, async () => {
      throw new Error('boom');
    });
    expect((await call(handler)).status).toBe(500);
    expect((await call(handler)).headers.get('x-ratelimit-remaining')).toBe('2');

    const ok = maker(() => false);
    for (let index = 0; index < 3; index += 1) await call(ok);
    for (let index = 0; index < 5; index += 1) expect((await call(ok)).status).toBe(429);
    const info = getRateLimiter().hit('maker:ip:unknown', 3, 60);
    expect(info.allowed).toBe(false);
    expect(info.remaining).toBe(0);
  });

  it('counts every request when it is not asked to', async () => {
    const plain = route(
      {
        auth: 'none',
        csrf: false,
        rateLimit: { name: 'plain', limit: 2, windowSec: 60, by: 'ip' },
      },
      async () => {
        throw AppError.of('conflict', 'taken');
      },
    );
    expect([(await call(plain)).status, (await call(plain)).status]).toEqual([409, 409]);
    expect((await call(plain)).status).toBe(429);
  });

  it('works with a limiter that cannot give hits back (the hit simply stays)', async () => {
    const inner = new InMemoryRateLimiter();
    const limiter: RateLimiter = {
      hit: (key, limit, windowSec) => inner.hit(key, limit, windowSec),
    };
    setRateLimiter(limiter);
    const handler = maker(() => true);
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await call(handler)).status);
    expect(statuses).toEqual([409, 409, 409, 429]);
  });
});
