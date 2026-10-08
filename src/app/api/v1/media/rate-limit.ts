import 'server-only';
import { AppError, isAppError } from '@/lib/errors';
import type { AuthContext } from '@/server/auth';
import { errorResponse } from '@/server/http/errors';
import { UNKNOWN_IP } from '@/server/security/ip';
import { getRateLimiter, type RateLimitResult } from '@/server/security/rate-limit';

/**
 * A gallery page loads dozens of thumbnails at once, infinite scroll fetches several pages in a
 * row, and a playing video issues a ranged request per seek. Throttling that would break normal
 * browsing, so the budget is high (20 requests per second); it still stops a script from
 * hammering the disk or the S3 egress.
 */
export const MEDIA_RATE_LIMIT = { name: 'media', limit: 1200, windowSec: 60 } as const;

interface Viewer {
  auth: Pick<AuthContext, 'user'> | null;
  ip: string;
}

/**
 * Whose budget a request spends: the signed-in user's, or the client address of an anonymous
 * viewer of a public page. Null when the caller cannot be told apart from everybody else: with
 * `TRUST_PROXY=false` (the default) every anonymous request has the address `unknown`, so counting
 * them would put the whole site's public viewers in one bucket and let a single script lock them
 * all out of thumbnails and videos. Those requests are not counted; run behind a reverse proxy
 * with `TRUST_PROXY=true` (or a CDN, which public assets are cacheable for) to throttle them.
 */
export function mediaRateScope({ auth, ip }: Viewer): string | null {
  if (auth) return `user:${auth.user.id}`;
  return ip === UNKNOWN_IP ? null : `ip:${ip}`;
}

function rateHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(MEDIA_RATE_LIMIT.limit),
    'X-RateLimit-Remaining': String(Math.max(0, result.remaining)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

/**
 * Runs `serve` under the media budget. The route opts out of `route()`'s own limiter
 * (`rateLimit: false`) because that one keys anonymous callers by address unconditionally; this
 * one keeps its response contract (429 with `Retry-After`, `X-RateLimit-*` on every answer).
 */
export async function withMediaRateLimit(
  viewer: Viewer,
  serve: () => Promise<Response>,
): Promise<Response> {
  const scope = mediaRateScope(viewer);
  if (scope === null) return serve();

  const { name, limit, windowSec } = MEDIA_RATE_LIMIT;
  const result = getRateLimiter().hit(`${name}:${scope}`, limit, windowSec);
  const headers = rateHeaders(result);
  if (!result.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
    const rejected = errorResponse(
      AppError.of('rate_limited', 'Too many requests', { retryAfterSec }),
    );
    return withHeaders(rejected, headers);
  }

  try {
    return withHeaders(await serve(), headers);
  } catch (error) {
    // Client errors (404, 422) carry the budget headers too; server errors keep `route()`'s logging.
    if (!isAppError(error) || error.status >= 500) throw error;
    return withHeaders(errorResponse(error), headers);
  }
}
