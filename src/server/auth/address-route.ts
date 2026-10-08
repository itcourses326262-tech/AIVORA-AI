import 'server-only';
import { errorResponse } from '@/server/http/errors';
import { isMutatingMethod, requestIdOf } from '@/server/http/request';
import {
  route,
  type RateLimitOptions,
  type RouteCtx,
  type RouteHandler,
  type RouteOptions,
} from '@/server/http/route';
import { UNKNOWN_IP, getClientIp } from '@/server/security/ip';
import { assertSameOrigin } from '@/server/security/origin';

export type AddressRouteOptions = Omit<RouteOptions, 'auth' | 'admin' | 'rateLimit'> & {
  auth: 'none' | 'optional';
};

export interface AddressLimits {
  /** Budget of one client address, used whenever the address is known. */
  perAddress: RateLimitOptions;
  /**
   * Used when the address is `unknown` (no trusted proxy in front of the app, so the app cannot
   * tell its clients apart). Every visitor then shares this one bucket, so a budget sized for one
   * client would let anybody switch the endpoint off for everybody: give it a generous size, or
   * `false` when other defences (per-account limits, the password hash gate) already cover it.
   */
  sharedAddress: RateLimitOptions | false;
}

/**
 * `route()` for endpoints that are limited per client address. It picks the budget by whether the
 * address is known, and for `csrf: true` routes it runs the same-origin check BEFORE any budget is
 * spent: a request refused as cross-site is not an attempt, and a page on another site must not be
 * able to burn the visitor's own login or sign-up allowance. Everything else is `route()`.
 */
export function addressRoute<P = Record<string, never>>(
  options: AddressRouteOptions,
  limits: AddressLimits,
  handler: (ctx: RouteCtx<P>) => Promise<unknown>,
): RouteHandler<P> {
  const known = route<P>({ ...options, rateLimit: limits.perAddress }, handler);
  const shared = route<P>({ ...options, rateLimit: limits.sharedAddress }, handler);
  const sameOriginFirst = options.csrf === true;

  return async (req, nextCtx) => {
    if (sameOriginFirst && isMutatingMethod(req.method)) {
      try {
        assertSameOrigin(req);
      } catch (error) {
        const response = errorResponse(error);
        response.headers.set('X-Request-Id', requestIdOf(req));
        response.headers.set('Cache-Control', 'no-store');
        return response;
      }
    }
    return (getClientIp(req) === UNKNOWN_IP ? shared : known)(req, nextCtx);
  };
}
