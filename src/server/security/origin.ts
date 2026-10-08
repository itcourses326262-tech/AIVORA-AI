import 'server-only';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/server/env';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** `Authorization: Bearer avk_…`: a non-browser developer client, which has no ambient cookie. */
function carriesApiKey(req: Request): boolean {
  return /^Bearer\s+avk_\S+$/i.test(req.headers.get('authorization') ?? '');
}

/**
 * Origins that count as "us": the configured `APP_URL`, and the origin the browser actually
 * used to reach the app (`Host`, or the forwarded host and protocol behind a trusted proxy).
 * A page on another site cannot make a browser send a forged `Host` or `Origin`, so accepting
 * the host-derived origin cannot be used for CSRF, and it keeps a mistyped `APP_URL` from
 * locking everyone out.
 */
function ownOrigins(req: Request): Set<string> {
  const env = getEnv();
  const origins = new Set<string>();
  const configured = originOf(env.APP_URL);
  if (configured) origins.add(configured);

  const forwardedHost = env.TRUST_PROXY ? req.headers.get('x-forwarded-host') : null;
  const host = (forwardedHost ?? req.headers.get('host') ?? '').split(',')[0]?.trim();
  if (host) {
    const forwardedProto = env.TRUST_PROXY ? req.headers.get('x-forwarded-proto') : null;
    const protocol = (forwardedProto ?? new URL(req.url).protocol.replace(':', '')).split(',')[0];
    const own = originOf(`${protocol?.trim()}://${host}`);
    if (own) origins.add(own);
  }
  return origins;
}

function blocked(): AppError {
  return AppError.of('forbidden', 'Cross-origin request blocked');
}

/**
 * Throws `forbidden` when a cookie-authenticated mutating request comes from another origin.
 *
 * CSRF defence next to the `SameSite=Lax` cookie. Safe methods (GET, HEAD, OPTIONS) are exempt.
 * For everything else the `Origin` header must be one of ours; browsers send it on every
 * cross-origin and every same-origin POST, so a missing `Origin` falls back to `Referer`. A request
 * with neither is accepted only when it carries an API key (`Authorization: Bearer avk_…`): that is
 * a script or server, there is no ambient cookie to ride on and a browser cannot add that header
 * cross-site without a CORS preflight, which this API never grants. `Origin: null` (sandboxed
 * frames, some redirects) is rejected, and so is `Sec-Fetch-Site: cross-site` whatever else the
 * request claims.
 */
export function assertSameOrigin(req: Request): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return;
  if (req.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') throw blocked();

  const own = ownOrigins(req);
  const origin = req.headers.get('origin');
  if (origin !== null) {
    const claimed = originOf(origin);
    if (claimed !== null && own.has(claimed)) return;
    throw blocked();
  }

  const referer = req.headers.get('referer');
  if (referer !== null) {
    const claimed = originOf(referer);
    if (claimed !== null && own.has(claimed)) return;
    throw blocked();
  }

  if (carriesApiKey(req)) return;
  throw blocked();
}
