import 'server-only';
import { isIP } from 'node:net';
import { getEnv, type Env } from '@/server/env';
import { getLogger } from '@/server/logger';
import { ipv4FromMapped, parseIpv6 } from './ipaddr';

export const UNKNOWN_IP = 'unknown';

/**
 * Canonical form of an IP address as it appears in headers, or null when it is not one.
 * Strips a port and the brackets of an IPv6 literal, unwraps IPv4-mapped IPv6 (`::ffff:1.2.3.4`)
 * and lower-cases IPv6. IPv6 addresses are then collapsed to their /64 network (`2001:db8:1:2::/64`):
 * one subscriber normally owns a whole /64, so keying limits on the full address would let a
 * single client rotate through billions of "different" addresses.
 */
export function normalizeIp(raw: string): string | null {
  let value = raw.trim();
  if (value === '' || value.length > 64) return null;

  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed?.[1]) value = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}$/.test(value))
    value = value.slice(0, value.lastIndexOf(':'));

  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);

  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;

  const groups = parseIpv6(value);
  if (!groups) return null;
  const mapped = ipv4FromMapped(groups);
  if (mapped) return mapped;
  return `${compressPrefix(groups.slice(0, 4))}/64`;
}

/** `2001:db8:1:2::` for the first four groups; the other four of a /64 are zero by definition. */
function compressPrefix(prefix: number[]): string {
  const groups = [...prefix];
  while (groups.length > 0 && groups[groups.length - 1] === 0) groups.pop();
  return `${groups.map((group) => group.toString(16)).join(':')}::`;
}

/** The Next.js / platform provided connection address, when the runtime exposes one. */
function connectionIp(req: Request): string | null {
  const candidate = (req as { ip?: unknown }).ip;
  return typeof candidate === 'string' ? normalizeIp(candidate) : null;
}

/** The entry `hops` positions from the right of `X-Forwarded-For` that is a valid address. */
function forwardedIp(header: string, hops: number): string | null {
  const entries = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length === 0) return null;
  // Fewer entries than trusted hops: the request skipped a proxy; the left-most is all we have.
  const entry = entries[Math.max(0, entries.length - hops)];
  return entry === undefined ? null : normalizeIp(entry);
}

const WARNED_KEY = Symbol.for('aivore.proxy-headers-warned');
type GlobalWithWarning = typeof globalThis & { [WARNED_KEY]?: boolean };

/**
 * With `TRUST_PROXY=false` the forwarding headers are ignored on purpose. When a production
 * server still receives them, a reverse proxy is almost certainly in front of it and every client
 * ends up as `unknown`: say so once per process, instead of leaving the operator to discover it as
 * a rate-limit complaint. (Next.js itself fills `X-Forwarded-For` with the socket address, so the
 * hint also appears on a server that is reached directly; there it is harmless to ignore.)
 */
function warnIfForwardingHeadersAreIgnored(req: Request, env: Env): void {
  if (env.NODE_ENV !== 'production') return;
  const scope = globalThis as GlobalWithWarning;
  if (scope[WARNED_KEY]) return;
  if (!req.headers.has('x-forwarded-for') && !req.headers.has('x-real-ip')) return;
  scope[WARNED_KEY] = true;
  getLogger().warn(
    'X-Forwarded-For/X-Real-IP are present but ignored because TRUST_PROXY=false: all clients share one rate-limit bucket (anonymous visitors one larger budget per route, signed-in users are limited per account). Set TRUST_PROXY=true behind your proxy (and TRUSTED_PROXY_HOPS when proxies are chained); ignore this when the app is reached directly.',
  );
}

/** Lets the "warn once" tests start from a clean slate. */
export function resetProxyHeaderWarningForTests(): void {
  (globalThis as GlobalWithWarning)[WARNED_KEY] = undefined;
}

/**
 * Client address for rate limits and logs.
 *
 * - `TRUST_PROXY=false` (default): headers are never believed, because any client can send
 *   `X-Forwarded-For`. Next.js 16 does not expose the socket address to route handlers either
 *   (it only fills `X-Forwarded-For` when the client sent none, which cannot be told apart), so
 *   the result is `req.ip` when a platform provides one and otherwise `'unknown'`, which means
 *   "the app cannot tell its clients apart" (see `addressRoute` for how limits cope). Run behind
 *   a reverse proxy and set `TRUST_PROXY=true` for per-client limits.
 * - `TRUST_PROXY=true`: the proxy chain is trusted to append the address it saw to
 *   `X-Forwarded-For`. The client is the entry `TRUSTED_PROXY_HOPS` (default 1) positions from the
 *   RIGHT, never the left-most: everything to the left of the last trusted proxy is client-supplied
 *   and spoofable. Invalid values fall through to `'unknown'` rather than becoming a bucket key.
 *
 * Only `X-Forwarded-For` is read, on purpose. Next.js fills it with the socket address (the
 * proxy's own) whenever the proxy sent none, so an `X-Real-IP` fallback could never be reached in
 * production, and where it could (other runtimes) the header is client-controlled unless the proxy
 * overwrites it. A proxy that only sets `X-Real-IP` therefore puts every client in the proxy's
 * bucket: configure it to append to `X-Forwarded-For`.
 */
export function getClientIp(req: Request): string {
  const env = getEnv();
  if (!env.TRUST_PROXY) {
    warnIfForwardingHeadersAreIgnored(req, env);
    return connectionIp(req) ?? UNKNOWN_IP;
  }

  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded ? forwardedIp(forwarded, env.TRUSTED_PROXY_HOPS) : null;
  return ip ?? connectionIp(req) ?? UNKNOWN_IP;
}
