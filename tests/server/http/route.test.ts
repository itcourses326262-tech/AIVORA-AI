import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  assertSameOrigin: vi.fn(),
  getClientIp: vi.fn(),
  hit: vi.fn(),
}));

vi.mock('@/server/auth', () => ({ authenticate: mocks.authenticate }));
vi.mock('@/server/security/origin', () => ({ assertSameOrigin: mocks.assertSameOrigin }));
vi.mock('@/server/security/ip', () => ({ getClientIp: mocks.getClientIp }));
vi.mock('@/server/security/rate-limit', () => ({ getRateLimiter: () => ({ hit: mocks.hit }) }));
// Routes that do not need a user must never open the database.
vi.mock('@/server/db', () => ({
  getDb: () => {
    throw new Error('route() touched the database');
  },
}));

import type { AuthContext } from '@/server/auth';
import { route } from '@/server/http/route';
import { resetLoggerForTests } from '@/server/logger';

const BASE = 'http://localhost:3000/api/v1/things';

const user = {
  id: 'usr_1',
  email: 'a@example.com',
  name: 'A',
  role: 'user',
  locale: 'en',
  creditBalance: 10,
} as const;
const sessionAuth: AuthContext = { user, via: 'session', sessionId: 'ses_1' };
const keyAuth: AuthContext = { user, via: 'api_key', apiKeyId: 'key_1' };
const adminAuth: AuthContext = { user: { ...user, role: 'admin' }, via: 'session' };

const withSession = { cookie: 'aivore_session=token' };
const withBearer = { authorization: 'Bearer avk_abc_secret' };

function request(init: RequestInit & { path?: string } = {}) {
  const { path = '', ...rest } = init;
  return new Request(`${BASE}${path}`, rest);
}

function jsonPost(body: unknown, headers: Record<string, string> = {}) {
  return request({
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}

beforeEach(() => {
  mocks.authenticate.mockReset().mockResolvedValue(null);
  mocks.assertSameOrigin.mockReset();
  mocks.getClientIp.mockReset().mockReturnValue('203.0.113.7');
  mocks.hit
    .mockReset()
    .mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 30_000 });
  // Tests that provoke 5xx errors would otherwise print their (expected) error logs.
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetLoggerForTests();
});

describe('responses', () => {
  it('wraps a plain return value in { data } with request id and no-store', async () => {
    const handler = route({ auth: 'none' }, async () => ({ hello: 'world' }));
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { hello: 'world' } });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('content-type')).toMatch(/^application\/json/);
  });

  it('passes a returned Response through, keeping its own caching headers', async () => {
    const handler = route(
      { auth: 'none' },
      async () =>
        new Response('bytes', {
          status: 206,
          headers: { 'Cache-Control': 'private, max-age=60', 'X-Custom': '1' },
        }),
    );
    const response = await handler(request());
    expect(response.status).toBe(206);
    expect(await response.text()).toBe('bytes');
    expect(response.headers.get('cache-control')).toBe('private, max-age=60');
    expect(response.headers.get('x-custom')).toBe('1');
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('can decorate responses whose headers are immutable', async () => {
    const handler = route({ auth: 'none' }, async () =>
      Response.redirect('https://example.com/next', 302),
    );
    const response = await handler(request());
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://example.com/next');
    expect(response.headers.get('x-request-id')).toBeTruthy();
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not buffer streamed bodies', async () => {
    const handler = route({ auth: 'none' }, async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk'));
          controller.close();
        },
      });
      return new Response(stream);
    });
    expect(await (await handler(request())).text()).toBe('chunk');
  });

  it('turns undefined into 204', async () => {
    const response = await route(
      { auth: 'none' },
      async () => undefined,
    )(request({ method: 'DELETE' }));
    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('serializes falsy values rather than treating them as empty', async () => {
    expect(await (await route({ auth: 'none' }, async () => 0)(request())).json()).toEqual({
      data: 0,
    });
    expect(await (await route({ auth: 'none' }, async () => null)(request())).json()).toEqual({
      data: null,
    });
    expect(await (await route({ auth: 'none' }, async () => [])(request())).json()).toEqual({
      data: [],
    });
  });
});

describe('request ids', () => {
  it('reuses a valid inbound id and echoes it on success and failure', async () => {
    const ok = route({ auth: 'none' }, async (ctx) => ({ id: ctx.requestId }));
    const fail = route({ auth: 'none' }, async () => {
      throw AppError.of('not_found', 'nope');
    });
    const headers = { 'x-request-id': 'trace-12345678' };
    const success = await ok(request({ headers }));
    expect(success.headers.get('x-request-id')).toBe('trace-12345678');
    expect((await success.json()).data.id).toBe('trace-12345678');
    expect((await fail(request({ headers }))).headers.get('x-request-id')).toBe('trace-12345678');
  });

  it('replaces an unsafe inbound id', async () => {
    const response = await route(
      { auth: 'none' },
      async () => null,
    )(request({ headers: { 'x-request-id': 'bad id with spaces' } }));
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('authentication', () => {
  it("'none' never looks at credentials", async () => {
    const seen: unknown[] = [];
    const handler = route({ auth: 'none' }, async (ctx) => seen.push(ctx.auth));
    await handler(request({ headers: { ...withBearer, ...withSession } }));
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(seen).toEqual([null]);
  });

  it("'optional' skips authenticate for anonymous requests", async () => {
    const handler = route({ auth: 'optional' }, async (ctx) => ({ anonymous: ctx.auth === null }));
    const response = await handler(request());
    expect(await response.json()).toEqual({ data: { anonymous: true } });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it.each([
    ['bearer', withBearer],
    ['session cookie', withSession],
  ])("'optional' authenticates requests carrying a %s", async (_label, headers) => {
    mocks.authenticate.mockResolvedValue(keyAuth);
    const handler = route({ auth: 'optional' }, async (ctx) => ({ id: ctx.auth?.user.id }));
    const response = await handler(request({ headers }));
    expect(await response.json()).toEqual({ data: { id: 'usr_1' } });
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });

  it("'optional' treats rejected credentials as anonymous", async () => {
    mocks.authenticate.mockResolvedValue(null);
    const handler = route({ auth: 'optional' }, async (ctx) => ({ anonymous: ctx.auth === null }));
    expect(await (await handler(request({ headers: withBearer }))).json()).toEqual({
      data: { anonymous: true },
    });
  });

  it("'required' answers 401 without credentials and never calls authenticate", async () => {
    const handler = route({ auth: 'required' }, async () => 'secret');
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatchObject({ code: 'unauthorized' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("'required' answers 401 when the credentials are invalid", async () => {
    const handler = route({ auth: 'required' }, async () => 'secret');
    const response = await handler(request({ headers: withBearer }));
    expect(response.status).toBe(401);
    expect(mocks.authenticate).toHaveBeenCalledTimes(1);
  });

  it("'required' hands the handler a non-null auth context", async () => {
    mocks.authenticate.mockResolvedValue(sessionAuth);
    const handler = route({ auth: 'required' }, async (ctx) => {
      expectTypeOf(ctx.auth).toEqualTypeOf<AuthContext>();
      return { userId: ctx.auth.user.id, via: ctx.auth.via };
    });
    expect(await (await handler(request({ headers: withSession }))).json()).toEqual({
      data: { userId: 'usr_1', via: 'session' },
    });
  });

  it('surfaces failures of authenticate itself as errors', async () => {
    mocks.authenticate.mockRejectedValue(new Error('db down'));
    const response = await route(
      { auth: 'required' },
      async () => 'x',
    )(request({ headers: withBearer }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'internal', message: 'Internal server error' },
    });
  });
});

describe('admin routes', () => {
  it('rejects ordinary users with 403 and runs the handler for admins', async () => {
    const handler = route({ auth: 'required', admin: true }, async () => 'admin-only');
    mocks.authenticate.mockResolvedValue(sessionAuth);
    const denied = await handler(request({ headers: withSession }));
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('forbidden');

    mocks.authenticate.mockResolvedValue(adminAuth);
    expect(await (await handler(request({ headers: withSession }))).json()).toEqual({
      data: 'admin-only',
    });
  });

  it('anonymous callers get 401, not 403', async () => {
    const response = await route({ auth: 'required', admin: true }, async () => 'x')(request());
    expect(response.status).toBe(401);
  });

  it('is a definition-time error to mark a non-required route as admin', () => {
    expect(() => route({ auth: 'optional', admin: true }, async () => null)).toThrow(
      /requires `auth: 'required'`/,
    );
    expect(() => route({ auth: 'none', admin: true }, async () => null)).toThrow(/requires/);
  });
});

describe('same-origin check', () => {
  const handler = route({ auth: 'optional' }, async () => 'done');

  it('runs for mutating requests authenticated by cookie', async () => {
    mocks.authenticate.mockResolvedValue(sessionAuth);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      mocks.assertSameOrigin.mockClear();
      await handler(request({ method, headers: withSession }));
      expect(mocks.assertSameOrigin).toHaveBeenCalledTimes(1);
    }
  });

  it('does not run for reads, API keys or anonymous requests', async () => {
    mocks.authenticate.mockResolvedValue(sessionAuth);
    await handler(request({ method: 'GET', headers: withSession }));
    mocks.authenticate.mockResolvedValue(keyAuth);
    await handler(request({ method: 'POST', headers: withBearer }));
    mocks.authenticate.mockResolvedValue(null);
    await handler(request({ method: 'POST' }));
    expect(mocks.assertSameOrigin).not.toHaveBeenCalled();
  });

  it('blocks the handler when the check fails', async () => {
    mocks.authenticate.mockResolvedValue(sessionAuth);
    mocks.assertSameOrigin.mockImplementation(() => {
      throw AppError.of('forbidden', 'Cross-origin request blocked');
    });
    const ran = vi.fn();
    const response = await route({ auth: 'optional' }, async () => ran())(
      request({ method: 'POST', headers: withSession }),
    );
    expect(response.status).toBe(403);
    expect(ran).not.toHaveBeenCalled();
  });

  it('csrf: true also protects unauthenticated mutations such as login', async () => {
    const login = route({ auth: 'none', csrf: true }, async () => 'ok');
    await login(request({ method: 'POST' }));
    expect(mocks.assertSameOrigin).toHaveBeenCalledTimes(1);
    mocks.assertSameOrigin.mockClear();
    await login(request({ method: 'GET' }));
    expect(mocks.assertSameOrigin).not.toHaveBeenCalled();
  });

  it('csrf: false opts a cookie-authenticated route out', async () => {
    mocks.authenticate.mockResolvedValue(sessionAuth);
    await route(
      { auth: 'optional', csrf: false },
      async () => 'ok',
    )(request({ method: 'POST', headers: withSession }));
    expect(mocks.assertSameOrigin).not.toHaveBeenCalled();
  });
});

describe('rate limiting', () => {
  const limited = { name: 'create', limit: 30, windowSec: 60 };

  it('limits by IP for routes without a user and sends rate limit headers', async () => {
    const handler = route({ auth: 'none', rateLimit: limited }, async () => 'ok');
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(mocks.hit).toHaveBeenCalledWith('create:ip:203.0.113.7', 30, 60);
    expect(response.headers.get('x-ratelimit-limit')).toBe('30');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('9');
    expect(Number(response.headers.get('x-ratelimit-reset'))).toBeGreaterThan(Date.now() / 1000);
  });

  it('limits authenticated routes by user by default', async () => {
    mocks.authenticate.mockResolvedValue(keyAuth);
    await route(
      { auth: 'required', rateLimit: limited },
      async () => 'ok',
    )(request({ headers: withBearer }));
    expect(mocks.hit).toHaveBeenCalledWith('create:user:usr_1', 30, 60);
  });

  it('can limit an authenticated route by IP instead', async () => {
    mocks.authenticate.mockResolvedValue(keyAuth);
    await route(
      { auth: 'required', rateLimit: { ...limited, by: 'ip' } },
      async () => 'ok',
    )(request({ headers: withBearer }));
    expect(mocks.hit).toHaveBeenCalledWith('create:ip:203.0.113.7', 30, 60);
  });

  it('falls back to the IP for anonymous callers of a by-user limit', async () => {
    await route(
      { auth: 'optional', rateLimit: { ...limited, by: 'user' } },
      async () => 'ok',
    )(request());
    expect(mocks.hit).toHaveBeenCalledWith('create:ip:203.0.113.7', 30, 60);
  });

  it('answers 429 with Retry-After and skips the handler', async () => {
    mocks.hit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 17_200 });
    const ran = vi.fn();
    const response = await route({ auth: 'none', rateLimit: limited }, async () => ran())(
      request(),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('18');
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0');
    expect((await response.json()).error).toMatchObject({ code: 'rate_limited' });
    expect(ran).not.toHaveBeenCalled();
  });

  it('never reports a Retry-After below one second', async () => {
    mocks.hit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() - 5 });
    const response = await route({ auth: 'none', rateLimit: limited }, async () => 'x')(request());
    expect(response.headers.get('retry-after')).toBe('1');
  });

  it('applies IP limits before authentication so floods never reach the credential lookup', async () => {
    mocks.hit.mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 1000 });
    const response = await route(
      { auth: 'required', rateLimit: { ...limited, by: 'ip' } },
      async () => 'x',
    )(request({ headers: withBearer }));
    expect(response.status).toBe(429);
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('applies user limits after authentication, and not to rejected credentials', async () => {
    const unauthorized = await route(
      { auth: 'required', rateLimit: limited },
      async () => 'x',
    )(request());
    expect(unauthorized.status).toBe(401);
    expect(mocks.hit).not.toHaveBeenCalled();
  });

  it('does not touch the limiter on routes without a limit', async () => {
    await route({ auth: 'none' }, async () => 'x')(request());
    expect(mocks.hit).not.toHaveBeenCalled();
  });
});

describe('ctx.body', () => {
  const schema = z.object({ prompt: z.string().min(1), count: z.number().int().default(1) });

  it('validates and returns typed data', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => {
      const body = await ctx.body(schema);
      expectTypeOf(body).toEqualTypeOf<{ prompt: string; count: number }>();
      return body;
    });
    expect(await (await handler(jsonPost({ prompt: 'a cat' }))).json()).toEqual({
      data: { prompt: 'a cat', count: 1 },
    });
  });

  it('answers 422 with per-field details for invalid input', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => ctx.body(schema));
    const response = await handler(jsonPost({ prompt: '', count: 1.5 }));
    expect(response.status).toBe(422);
    const { error } = await response.json();
    expect(error.code).toBe('validation_failed');
    expect(error.details.issues.map((issue: { path: string }) => issue.path).sort()).toEqual([
      'count',
      'prompt',
    ]);
  });

  it('answers 415 for non-JSON bodies, 400 for malformed JSON and 413 for oversized ones', async () => {
    const handler = route({ auth: 'none', maxBodyBytes: 64 }, async (ctx) => ctx.body(schema));
    const text = await handler(
      request({ method: 'POST', body: 'prompt=x', headers: { 'content-type': 'text/plain' } }),
    );
    expect(text.status).toBe(415);
    expect((await handler(jsonPost('{"prompt":'))).status).toBe(400);
    const big = await handler(jsonPost({ prompt: 'x'.repeat(200) }));
    expect(big.status).toBe(413);
    expect((await big.json()).error.code).toBe('payload_too_large');
  });

  it('treats a missing body as undefined for the schema to judge', async () => {
    const required = route({ auth: 'none' }, async (ctx) => ctx.body(schema));
    expect((await required(request({ method: 'POST' }))).status).toBe(422);
    const optional = route({ auth: 'none' }, async (ctx) => ctx.body(schema.optional()));
    expect((await optional(request({ method: 'POST' }))).status).toBe(204);
  });

  it('can be called more than once, with different schemas, because the stream is read once', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => {
      const first = await ctx.body(z.object({ a: z.number() }));
      const second = await ctx.body(z.object({ a: z.number() }).transform((value) => value.a * 2));
      return { first, second };
    });
    expect(await (await handler(jsonPost({ a: 21 }))).json()).toEqual({
      data: { first: { a: 21 }, second: 42 },
    });
  });
});

describe('ctx.query', () => {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    ids: z.union([z.string(), z.array(z.string())]).optional(),
  });

  it('parses and coerces the query string', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => ctx.query(schema));
    expect(await (await handler(request({ path: '?limit=25&ids=a&ids=b' }))).json()).toEqual({
      data: { limit: 25, ids: ['a', 'b'] },
    });
    expect(await (await handler(request())).json()).toEqual({ data: { limit: 10 } });
  });

  it('answers 422 for invalid parameters', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => ctx.query(schema));
    const response = await handler(request({ path: '?limit=500' }));
    expect(response.status).toBe(422);
    expect((await response.json()).error.details.issues[0].path).toBe('limit');
  });
});

describe('route params', () => {
  it('awaits the params promise Next.js passes', async () => {
    const handler = route<{ id: string }>({ auth: 'none' }, async (ctx) => {
      expectTypeOf(ctx.params).toEqualTypeOf<{ id: string }>();
      return { id: ctx.params.id };
    });
    const response = await handler(request(), { params: Promise.resolve({ id: 'gen_42' }) });
    expect(await response.json()).toEqual({ data: { id: 'gen_42' } });
  });

  it('gives routes without dynamic segments an empty params object', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => ctx.params);
    expect(await (await handler(request())).json()).toEqual({ data: {} });
    expect(
      await (
        await handler(request(), { params: Promise.resolve({}) as Promise<Record<string, never>> })
      ).json(),
    ).toEqual({
      data: {},
    });
  });

  it('exposes the raw request and the client IP', async () => {
    const handler = route({ auth: 'none' }, async (ctx) => ({
      ip: ctx.ip,
      method: ctx.req.method,
      url: ctx.req.url,
    }));
    const response = await handler(request({ path: '/x', method: 'PATCH' }));
    expect(await response.json()).toEqual({
      data: { ip: '203.0.113.7', method: 'PATCH', url: `${BASE}/x` },
    });
  });
});

describe('error handling', () => {
  it('maps AppError to its status and envelope', async () => {
    const handler = route({ auth: 'none' }, async () => {
      throw new AppError('insufficient_credits', 402, 'Insufficient credits', {
        required: 5,
        balance: 1,
      });
    });
    const response = await handler(request());
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: {
        code: 'insufficient_credits',
        message: 'Insufficient credits',
        details: { required: 5, balance: 1 },
      },
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('maps a ZodError thrown by the handler to 422', async () => {
    const handler = route({ auth: 'none' }, async () => z.object({ a: z.string() }).parse({}));
    const response = await handler(request());
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe('validation_failed');
  });

  it('hides the details of unexpected errors from the client', async () => {
    const handler = route({ auth: 'none' }, async () => {
      throw new Error('SQLITE_ERROR: no such table users at /srv/app/db.ts:12');
    });
    const response = await handler(request());
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain('SQLITE');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal server error' },
    });
  });

  it('survives handlers that throw non-errors', async () => {
    const response = await route({ auth: 'none' }, async () => {
      throw 'just a string';
    })(request());
    expect(response.status).toBe(500);
  });
});

describe('logging', () => {
  function captureLogs() {
    vi.stubEnv('LOG_LEVEL', 'debug');
    resetLoggerForTests();
    const lines: Array<Record<string, unknown>> = [];
    const collect = (chunk: unknown) => {
      lines.push(JSON.parse(String(chunk)) as Record<string, unknown>);
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(collect);
    vi.spyOn(process.stderr, 'write').mockImplementation(collect);
    return lines;
  }

  it('logs 5xx failures at error level with the error and request id', async () => {
    const lines = captureLogs();
    const handler = route({ auth: 'none' }, async () => {
      throw new Error('kaboom');
    });
    await handler(
      request({ path: '/boom?token=querysecret', headers: { 'x-request-id': 'trace-abcdefgh' } }),
    );
    const failure = lines.find((line) => line.msg === 'Request failed');
    expect(failure).toMatchObject({
      level: 'error',
      requestId: 'trace-abcdefgh',
      method: 'GET',
      path: '/api/v1/things/boom',
      status: 500,
      err: { name: 'Error', message: 'kaboom' },
    });
    expect(JSON.stringify(lines)).not.toContain('querysecret');
  });

  it('logs handled 4xx at debug level only, with the error code', async () => {
    const lines = captureLogs();
    await route({ auth: 'none' }, async () => {
      throw AppError.of('not_found', 'missing');
    })(request());
    expect(lines.filter((line) => line.level === 'error')).toEqual([]);
    expect(lines.find((line) => line.msg === 'Request completed')).toMatchObject({
      level: 'debug',
      status: 404,
      code: 'not_found',
    });
  });

  it('logs 5xx Responses returned by a handler too', async () => {
    const lines = captureLogs();
    await route(
      { auth: 'none' },
      async () => new Response('bad gateway', { status: 502 }),
    )(request());
    expect(lines.find((line) => line.msg === 'Request failed')).toMatchObject({
      level: 'error',
      status: 502,
    });
  });

  it('never writes credentials to the log', async () => {
    const lines = captureLogs();
    mocks.authenticate.mockResolvedValue(keyAuth);
    await route({ auth: 'required' }, async () => {
      throw new Error('boom');
    })(request({ headers: { ...withBearer, ...withSession } }));
    const text = JSON.stringify(lines);
    expect(text).not.toContain('avk_abc_secret');
    expect(text).not.toContain('aivore_session=token');
  });
});
