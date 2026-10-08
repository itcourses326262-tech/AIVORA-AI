import 'server-only';
import { isIP } from 'node:net';
import { getEnv } from '@/server/env';
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

/**
 * Client address for rate limits and logs.
 *
 * - `TRUST_PROXY=false` (default): headers are never believed, because any client can send
 *   `X-Forwarded-For`. Next.js 16 does not expose the socket address to route handlers either
 *   (it only fills `X-Forwarded-For` when the client sent none, which cannot be told apart), so
 *   the result is `req.ip` when a platform provides one and otherwise `'unknown'`, a single
 *   shared bucket. Run behind a reverse proxy and set `TRUST_PROXY=true` for per-client limits.
 * - `TRUST_PROXY=true`: the proxy chain is trusted to append the address it saw to
 *   `X-Forwarded-For`. The client is the entry `TRUSTED_PROXY_HOPS` (default 1) positions from the
 *   RIGHT, never the left-most: everything to the left of the last trusted proxy is client-supplied
 *   and spoofable. Without that header `X-Real-IP` (single value, set by the proxy) is used.
 *   Invalid values fall through to `'unknown'` rather than becoming a bucket key.
 */
export function getClientIp(req: Request): string {
  const env = getEnv();
  if (!env.TRUST_PROXY) return connectionIp(req) ?? UNKNOWN_IP;

  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const ip = forwardedIp(forwarded, env.TRUSTED_PROXY_HOPS);
    if (ip) return ip;
  }
  const real = req.headers.get('x-real-ip');
  return (real ? normalizeIp(real) : null) ?? connectionIp(req) ?? UNKNOWN_IP;
}
