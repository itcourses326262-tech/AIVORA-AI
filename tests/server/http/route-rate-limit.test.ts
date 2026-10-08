import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getMe } from '@/app/api/v1/auth/me/route';
import { POST as postLogin } from '@/app/api/v1/auth/login/route';
import { GET as getModels } from '@/app/api/v1/models/route';
import { GET as getTools } from '@/app/api/v1/tools/route';
import { createApiKey } from '@/server/auth';
import { resetEnvForTests } from '@/server/env';
import { ANONYMOUS_UNKNOWN_FACTOR, route } from '@/server/http/route';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
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
  it('count it before authentication, unscaled, for everybody (the route sizes the unknown case)', async () => {
    const guarded = route(
      { auth: 'optional', rateLimit: { name: 'strict', limit: 2, windowSec: 60, by: 'ip' } },
      async () => 'ok',
    );
    const { session } = createUserWithSession(database.db);
    const statuses: number[] = [];
    for (const headers of [{}, session.headers, {}]) {
      statuses.push((await invokeRoute(guarded, { url: '/x', headers })).status);
    }
    expect(statuses).toEqual([200, 200, 429]);
  });
});
