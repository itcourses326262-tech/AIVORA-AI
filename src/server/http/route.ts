import 'server-only';
import type { ZodType } from 'zod';
import { AppError, isAppError } from '@/lib/errors';
import { authenticate, type AuthContext } from '@/server/auth';
import { getLogger, type Logger } from '@/server/logger';
import { assertSameOrigin } from '@/server/security/origin';
import { getRateLimiter, type RateLimitResult } from '@/server/security/rate-limit';
import { UNKNOWN_IP, getClientIp } from '@/server/security/ip';
import { errorResponse, normalizeError } from './errors';
import {
  DEFAULT_MAX_JSON_BYTES,
  capRequestBody,
  hasCredentials,
  isMutatingMethod,
  parseOrThrow,
  queryObject,
  readFormBody,
  readJsonBody,
  requestIdOf,
} from './request';
import { noContent, ok } from './respond';

export type AuthMode = 'required' | 'optional' | 'none';

export interface RateLimitOptions {
  name: string;
  limit: number;
  windowSec: number;
  /**
   * Leave it out for the usual identity keying: a signed-in caller (session cookie or API key,
   * resolved even on `auth: 'optional'` routes) spends `user:<id>`, an anonymous one the address
   * bucket, or, when the address is unknown (no trusted proxy), the shared
   * {@link ANONYMOUS_UNKNOWN_SCOPE} bucket with {@link ANONYMOUS_UNKNOWN_FACTOR} times the limit.
   * A signed-in caller therefore never spends an anonymous budget.
   *
   * `'ip'` is the explicit per-address budget (login, register, the public feed): it is counted
   * before authentication, for everybody, and an unknown address stays `ip:unknown`, so the route
   * must size that case itself (see `addressRoute`). `'user'` keys signed-in callers by account and
   * anonymous ones by address.
   */
  by?: 'ip' | 'user';
}

/**
 * Without a trusted proxy (`TRUST_PROXY=false`) every client has the address `unknown`, and a
 * budget sized for one client would be a switch any script can pull for everybody. Anonymous
 * callers of a route that leaves `by` unset share this many times its `limit` instead, in a bucket
 * of their own per route class. Signed-in callers never touch it.
 */
export const ANONYMOUS_UNKNOWN_FACTOR = 10;
/** Key of the shared anonymous bucket (`<rate name>:anonymous-unknown`). */
export const ANONYMOUS_UNKNOWN_SCOPE = 'anonymous-unknown';

/**
 * Applied to every route that does not pass its own `rateLimit`, so a forgotten option can never
 * leave an endpoint unthrottled. The bucket is shared by all such routes (per user, or per address
 * for anonymous callers).
 */
export const GENERAL_RATE_LIMIT: Readonly<RateLimitOptions> = {
  name: 'general',
  limit: 300,
  windowSec: 60,
};

export interface RouteOptions {
  /**
   * `required`: 401 without valid credentials. `optional`: `ctx.auth` is null for anonymous calls.
   * `none`: credentials are not even looked at.
   */
  auth: AuthMode;
  /**
   * Defaults to {@link GENERAL_RATE_LIMIT} (300 requests per minute). Pass a specific limit for
   * costly or abusable endpoints, or `false` to opt out explicitly (health probes, media streaming).
   */
  rateLimit?: RateLimitOptions | false;
  /** Requires `auth: 'required'` and an admin account. */
  admin?: boolean;
  /**
   * Same-origin check for mutating requests. Defaults to on for cookie-authenticated requests;
   * pass `true` for unauthenticated cookie-setting routes (login, register) and `false` to opt out.
   */
  csrf?: boolean;
  /**
   * Cap on the request body in bytes, defaults to 1 MiB. It covers every way of reading the body
   * (`ctx.body()`, `ctx.formData()` and `ctx.req.json()/text()/formData()/arrayBuffer()/body`):
   * a larger Content-Length is rejected up front and a stream that grows past the cap fails with
   * `payload_too_large` (413) mid-read. A function is evaluated per request, for limits that come
   * from configuration (modules must not read the environment at import time).
   */
  maxBodyBytes?: number | (() => number);
}

export interface RouteCtx<P> {
  /** The incoming request with the body cap of `maxBodyBytes` enforced on its body. */
  req: Request;
  params: P;
  /** Null for anonymous calls; never null on `auth: 'required'` routes. */
  auth: AuthContext | null;
  ip: string;
  requestId: string;
  /** Size-limited JSON body validated by `schema`; invalid input is a 422 with per-field details. */
  body<T>(schema: ZodType<T>): Promise<T>;
  /** Size-limited `multipart/form-data` body (415 for other content types, 400 when malformed). */
  formData(): Promise<FormData>;
  /** Query string validated by `schema` (repeated keys arrive as arrays). */
  query<T>(schema: ZodType<T>): T;
}

export type AuthedRouteCtx<P> = Omit<RouteCtx<P>, 'auth'> & { auth: AuthContext };

/** What Next.js calls: `export const GET = route(...)`. */
export type RouteHandler<P> = (req: Request, nextCtx?: { params: Promise<P> }) => Promise<Response>;

/**
 * Wraps an API handler with the cross-cutting concerns of section 6.1: request id, rate limiting,
 * authentication, same-origin check, error envelope, logging and `Cache-Control: no-store`.
 * A handler returns a `Response`, `undefined` (204) or any value (200 `{ data }`).
 */
export function route<P = Record<string, never>>(
  opts: RouteOptions & { auth: 'required' },
  handler: (ctx: AuthedRouteCtx<P>) => Promise<unknown>,
): RouteHandler<P>;
export function route<P = Record<string, never>>(
  opts: RouteOptions & { auth: 'optional' | 'none' },
  handler: (ctx: RouteCtx<P>) => Promise<unknown>,
): RouteHandler<P>;
export function route<P>(
  opts: RouteOptions,
  handler: (ctx: RouteCtx<P> & AuthedRouteCtx<P>) => Promise<unknown>,
): RouteHandler<P> {
  // Misconfiguration must fail at import time, not on the first request.
  if (opts.admin && opts.auth !== 'required') {
    throw new Error("route(): `admin: true` requires `auth: 'required'`");
  }

  return async (req, nextCtx) => {
    const startedAt = performance.now();
    const requestId = requestIdOf(req);
    const log = getLogger().child({ requestId });
    let rateInfo: RateInfo | undefined;
    let failure: unknown;
    let response: Response;

    try {
      const ip = getClientIp(req);
      const rate = opts.rateLimit === false ? undefined : (opts.rateLimit ?? GENERAL_RATE_LIMIT);
      const hit = (rateLimit: RateLimitOptions, scope: string, limit: number) => {
        const result = getRateLimiter().hit(
          `${rateLimit.name}:${scope}`,
          limit,
          rateLimit.windowSec,
        );
        rateInfo = { limit, result };
        if (!result.allowed) {
          const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
          throw AppError.of('rate_limited', 'Too many requests', { retryAfterSec });
        }
      };

      // An explicit per-address budget is counted before authentication, so floods never reach the
      // credential lookup.
      if (rate?.by === 'ip') hit(rate, `ip:${ip}`, rate.limit);

      // Credentials are resolved before an identity budget is spent, also on `optional` routes: a
      // signed-in caller is keyed by account and must never consume (or be starved by) the bucket
      // of anonymous callers. Anonymous requests carry nothing to look up, and rejected credentials
      // cost one HMAC and one indexed read before they are counted as anonymous.
      const auth = await resolveAuth(req, opts.auth);
      if (opts.admin && auth?.user.role !== 'admin') {
        throw AppError.of('forbidden', 'Admin access required');
      }
      if (isMutatingMethod(req.method) && (opts.csrf ?? auth?.via === 'session')) {
        assertSameOrigin(req);
      }
      if (rate && rate.by !== 'ip') {
        if (auth) hit(rate, `user:${auth.user.id}`, rate.limit);
        else if (rate.by === undefined && ip === UNKNOWN_IP) {
          hit(rate, ANONYMOUS_UNKNOWN_SCOPE, rate.limit * ANONYMOUS_UNKNOWN_FACTOR);
        } else hit(rate, `ip:${ip}`, rate.limit);
      }

      const maxBodyBytes = bodyLimit(opts.maxBodyBytes);
      const capped = capRequestBody(req, maxBodyBytes);
      let rawBody: Promise<unknown> | undefined;
      let rawForm: Promise<FormData> | undefined;
      const ctx: RouteCtx<P> = {
        req: capped,
        params: (await nextCtx?.params) ?? ({} as P),
        auth,
        ip,
        requestId,
        body: async (schema) => {
          rawBody ??= readJsonBody(capped, maxBodyBytes);
          return parseOrThrow(schema, await rawBody);
        },
        formData: () => (rawForm ??= readFormBody(capped)),
        query: (schema) => parseOrThrow(schema, queryObject(req)),
      };

      // `auth` is non-null whenever the `required` overload was used: resolveAuth throws otherwise.
      const result = await handler(ctx as RouteCtx<P> & AuthedRouteCtx<P>);
      response =
        result instanceof Response ? result : result === undefined ? noContent() : ok(result);
    } catch (error) {
      failure = error;
      response = errorResponse(error);
    }

    response = decorate(response, requestId, rateInfo);
    logOutcome(log, req, response, startedAt, failure);
    return response;
  };
}

interface RateInfo {
  limit: number;
  result: RateLimitResult;
}

function bodyLimit(option: RouteOptions['maxBodyBytes']): number {
  if (option === undefined) return DEFAULT_MAX_JSON_BYTES;
  return typeof option === 'function' ? option() : option;
}

async function resolveAuth(req: Request, mode: AuthMode): Promise<AuthContext | null> {
  if (mode === 'none') return null;
  // Anonymous requests skip `authenticate` entirely, so public routes never touch the database.
  const context = hasCredentials(req) ? await authenticate(req) : null;
  if (!context && mode === 'required') {
    throw AppError.of('unauthorized', 'Authentication required');
  }
  return context;
}

/** Adds the request id, the no-store default and rate-limit headers, copying immutable responses. */
function decorate(response: Response, requestId: string, rate: RateInfo | undefined): Response {
  const apply = (headers: Headers) => {
    headers.set('X-Request-Id', requestId);
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
    if (rate) {
      headers.set('X-RateLimit-Limit', String(rate.limit));
      headers.set('X-RateLimit-Remaining', String(Math.max(0, rate.result.remaining)));
      headers.set('X-RateLimit-Reset', String(Math.ceil(rate.result.resetAt / 1000)));
    }
  };
  try {
    apply(response.headers);
    return response;
  } catch {
    // Responses from fetch() or Response.redirect() have immutable headers.
    const copy = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: new Headers(response.headers),
    });
    apply(copy.headers);
    return copy;
  }
}

function logOutcome(
  log: Logger,
  req: Request,
  response: Response,
  startedAt: number,
  failure: unknown,
): void {
  const fields = {
    method: req.method,
    path: new URL(req.url).pathname,
    status: response.status,
    durationMs: Math.round(performance.now() - startedAt),
  };
  // `service_busy` is the 503 a deliberate guard answers with (its own source logs it, throttled),
  // not a fault: it must not page anyone with a stack trace per refused request.
  const deliberate = isAppError(failure) && failure.code === 'service_busy';
  if (response.status >= 500 && !deliberate) {
    log.error('Request failed', failure === undefined ? fields : { ...fields, err: failure });
  } else {
    const code = failure === undefined ? undefined : normalizeError(failure).body.error.code;
    log.debug('Request completed', code === undefined ? fields : { ...fields, code });
  }
}
