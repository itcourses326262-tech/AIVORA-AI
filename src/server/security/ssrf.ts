import 'server-only';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { AppError } from '@/lib/errors';
import { ipv4FromMapped, parseIpv4, parseIpv6 } from './ipaddr';

export interface SafeFetchOptions {
  /** Hard cap on the response body; the download is aborted as soon as it is exceeded. */
  maxBytes: number;
  /** Total time budget for the request including redirects and the body. */
  timeoutMs: number;
  /** Accepted response `Content-Type`s, matched on the media type; `image/*` style wildcards allowed. */
  allowedContentTypes: readonly string[];
  /** Aborts the download early (for example when a generation is canceled). */
  signal?: AbortSignal;
  /**
   * TEST ONLY. Also accepts `http:` URLs and any port, and lets loopback addresses through so a
   * test can talk to a server on 127.0.0.1. Every other private, link-local, CGNAT, metadata
   * and reserved range stays blocked. Production code must never set it.
   */
  allowHttpForTests?: boolean;
}

export interface SafeFetchResult {
  bytes: Uint8Array;
  /** Media type of the response without parameters, e.g. `image/png`. */
  contentType: string;
  /** URL after redirects. */
  finalUrl: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

interface Policy {
  allowHttp: boolean;
  allowLoopback: boolean;
}

const STRICT: Policy = { allowHttp: false, allowLoopback: false };
const TEST: Policy = { allowHttp: true, allowLoopback: true };

const MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 4096;
const MAX_HEADER_BYTES = 16 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// ---- Address policy --------------------------------------------------------------------------

type V4Range = readonly [base: string, bits: number];

/** IPv4 ranges that are not the public internet. Loopback is listed separately (test mode). */
const BLOCKED_V4: readonly V4Range[] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT (also Alibaba Cloud metadata at 100.100.100.200)
  ['169.254.0.0', 16], // link-local, including the cloud metadata service 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments (Oracle Cloud metadata 192.0.0.192)
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
];
const LOOPBACK_V4: V4Range = ['127.0.0.0', 8];

function inV4Range(address: number, [base, bits]: V4Range): boolean {
  const start = parseIpv4(base);
  if (start === null) return false;
  const size = 2 ** (32 - bits);
  return address >= start && address < start + size;
}

type V6Range = readonly [base: string, bits: number];

/** Parts of the global unicast block 2000::/3 that are not routable public addresses. */
const BLOCKED_V6_INSIDE_GLOBAL: readonly V6Range[] = [
  ['2001::', 23], // IETF protocol assignments: Teredo, ORCHID, benchmarking
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: embeds an arbitrary IPv4 address
  ['3fff::', 20], // documentation
];

function toBigInt(groups: readonly number[]): bigint {
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
}

function inV6Range(address: bigint, [base, bits]: V6Range): boolean {
  const groups = parseIpv6(base);
  if (!groups) return false;
  const shift = BigInt(128 - bits);
  return address >> shift === toBigInt(groups) >> shift;
}

/**
 * True when `address` (an IP literal) is a public unicast address that server-side requests may
 * target. IPv4: everything outside the ranges above. IPv6: only global unicast (2000::/3) minus
 * the documentation, protocol-assignment and 6to4 blocks, so loopback, unspecified, link-local,
 * unique-local, multicast, NAT64 and IPv4-compatible addresses are all refused. IPv4-mapped IPv6
 * (`::ffff:10.0.0.1`) is judged by the IPv4 address inside it.
 */
export function isPublicAddress(
  address: string,
  options: { allowLoopback?: boolean } = {},
): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicV4(address, options.allowLoopback === true);
  if (family !== 6) return false;

  const groups = parseIpv6(address.split('%')[0] ?? '');
  if (!groups) return false;
  const mapped = ipv4FromMapped(groups);
  if (mapped) return isPublicV4(mapped, options.allowLoopback === true);
  const value = toBigInt(groups);
  if (options.allowLoopback === true && value === 1n) return true;
  if (value >> 125n !== 1n) return false; // not 2000::/3
  return !BLOCKED_V6_INSIDE_GLOBAL.some((range) => inV6Range(value, range));
}

function isPublicV4(address: string, allowLoopback: boolean): boolean {
  const value = parseIpv4(address);
  if (value === null) return false;
  if (inV4Range(value, LOOPBACK_V4)) return allowLoopback;
  return !BLOCKED_V4.some((range) => inV4Range(value, range));
}

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.localdomain',
  '.lan',
  '.home',
];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal']);

function isBlockedHostname(host: string): boolean {
  const name = host.replace(/\.$/, '').toLowerCase();
  return BLOCKED_HOSTS.has(name) || BLOCKED_HOST_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// ---- DNS -------------------------------------------------------------------------------------

async function systemResolver(hostname: string): Promise<ResolvedAddress[]> {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.flatMap((record) =>
    record.family === 4 || record.family === 6
      ? [{ address: record.address, family: record.family }]
      : [],
  );
}

let resolver: Resolver = systemResolver;

/** Replaces the DNS resolver (rebinding tests need to script answers); `null` restores it. */
export function setSsrfResolverForTests(next: Resolver | null): void {
  resolver = next ?? systemResolver;
}

function notAllowed(reason: string): AppError {
  return AppError.of('bad_request', `URL is not allowed: ${reason}`);
}

/**
 * Resolves `hostname` and requires EVERY answer to be public: a name with one public and one
 * private record would otherwise let the connection pick the private one.
 */
async function resolvePublic(hostname: string, policy: Policy): Promise<ResolvedAddress[]> {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicAddress(host, { allowLoopback: policy.allowLoopback })) {
      throw notAllowed('address is not public');
    }
    return [{ address: host, family: literalFamily }];
  }
  if (isBlockedHostname(host)) throw notAllowed('host is not public');

  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(host);
  } catch {
    throw notAllowed('host could not be resolved');
  }
  if (addresses.length === 0) throw notAllowed('host could not be resolved');
  for (const { address } of addresses) {
    if (!isPublicAddress(address, { allowLoopback: policy.allowLoopback })) {
      throw notAllowed('host resolves to a non-public address');
    }
  }
  return addresses;
}

/**
 * The `lookup` Node's socket calls to turn the host name into the address it connects to. The
 * check happens HERE, on the answer the connection will actually use, so DNS rebinding (a name
 * that resolves to a public address when validated and a private one when connected) cannot
 * slip through the gap between "validate" and "connect".
 */
function guardedLookup(policy: Policy): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublic(hostname, policy).then(
      (addresses) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : undefined;
        const usable = wanted ? addresses.filter((entry) => entry.family === wanted) : addresses;
        const first = usable[0];
        if (!first) {
          callback(notAllowed('host has no address of the requested family'), '', 0);
          return;
        }
        if (options.all) callback(null, usable);
        else callback(null, first.address, first.family);
      },
      (error: unknown) => callback(error as NodeJS.ErrnoException, '', 0),
    );
  };
}

// ---- URL validation --------------------------------------------------------------------------

async function validateUrl(input: string | URL, policy: Policy): Promise<URL> {
  const text = typeof input === 'string' ? input : input.href;
  if (text.length > MAX_URL_LENGTH) throw notAllowed('too long');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw AppError.of('bad_request', 'URL is not allowed: not a valid URL');
  }
  const schemeOk = url.protocol === 'https:' || (policy.allowHttp && url.protocol === 'http:');
  if (!schemeOk) throw notAllowed('only https is supported');
  if (url.username !== '' || url.password !== '') throw notAllowed('credentials in the URL');
  if (!policy.allowHttp && url.port !== '' && url.port !== '443') {
    throw notAllowed('only the default https port is supported');
  }
  if (url.hostname === '') throw notAllowed('missing host');
  await resolvePublic(url.hostname, policy);
  return url;
}

/**
 * Parses `url` and rejects (`bad_request`) anything but public HTTPS: resolves DNS and blocks
 * private, loopback, link-local, CGNAT, cloud-metadata and reserved ranges (IPv4 and IPv6,
 * including IPv4-mapped), non-default ports, and credentials in the URL. `safeFetch` runs it for
 * every hop and, in addition, checks again at connect time.
 */
export async function assertPublicHttpsUrl(url: string | URL): Promise<URL> {
  return validateUrl(url, STRICT);
}

// ---- Fetching --------------------------------------------------------------------------------

function mediaType(header: string | undefined): string {
  return (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function contentTypeAllowed(type: string, allowed: readonly string[]): boolean {
  if (type === '') return allowed.includes('*/*');
  return allowed.some((pattern) => {
    const wanted = pattern.trim().toLowerCase();
    if (wanted === '*/*' || wanted === type) return true;
    return wanted.endsWith('/*') && type.startsWith(wanted.slice(0, -1));
  });
}

type HopResult =
  { kind: 'redirect'; location: string } | { kind: 'done'; bytes: Uint8Array; contentType: string };

interface HopOptions {
  policy: Policy;
  signal: AbortSignal;
  maxBytes: number;
  allowedContentTypes: readonly string[];
}

function requestOnce(url: URL, options: HopOptions): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    let settled = false;
    const settle = (action: () => void) => {
      if (settled) return;
      settled = true;
      action();
    };
    const fail = (error: unknown) => settle(() => reject(error));

    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname,
        port: url.port === '' ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          accept: '*/*',
          // No compression: a small response must not inflate past the size cap unseen.
          'accept-encoding': 'identity',
          'user-agent': 'AIVORE-fetch/1.0',
        },
        agent: false,
        lookup: guardedLookup(options.policy),
        signal: options.signal,
        maxHeaderSize: MAX_HEADER_BYTES,
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (REDIRECT_STATUSES.has(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) {
            fail(AppError.of('provider_error', 'Redirect without a location'));
          } else {
            settle(() => resolve({ kind: 'redirect', location }));
          }
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          fail(AppError.of('provider_error', `Download failed with status ${status}`));
          return;
        }

        const encoding = (response.headers['content-encoding'] ?? 'identity').toLowerCase();
        if (encoding !== 'identity') {
          response.destroy();
          fail(AppError.of('unsupported_media_type', 'Compressed responses are not accepted'));
          return;
        }
        const type = mediaType(response.headers['content-type']);
        if (!contentTypeAllowed(type, options.allowedContentTypes)) {
          response.destroy();
          fail(AppError.of('unsupported_media_type', `Content type "${type}" is not accepted`));
          return;
        }
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > options.maxBytes) {
          response.destroy();
          fail(AppError.of('payload_too_large', `Response exceeds ${options.maxBytes} bytes`));
          return;
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on('data', (chunk: Buffer) => {
          total += chunk.length;
          if (total > options.maxBytes) {
            response.destroy();
            fail(AppError.of('payload_too_large', `Response exceeds ${options.maxBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          // A copy: Buffer.concat may hand out a view into Node's shared pool.
          const bytes = new Uint8Array(Buffer.concat(chunks, total));
          settle(() => resolve({ kind: 'done', bytes, contentType: type }));
        });
        response.on('error', (error) => fail(error));
        response.on('close', () => {
          if (!response.complete) fail(AppError.of('provider_error', 'Connection closed early'));
        });
      },
    );
    request.on('error', fail);
    request.end();
  });
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

/**
 * The only way the server downloads a URL it did not choose (provider outputs). Every hop is
 * validated with {@link assertPublicHttpsUrl}'s rules and again at connect time (see
 * `guardedLookup`); redirects are followed by hand, at most 3, each one re-validated, and the
 * body is limited in size while it streams and in content type before it is read.
 *
 * Errors are `AppError`s: `bad_request` for a URL that is not allowed, `payload_too_large`,
 * `unsupported_media_type` and `provider_error` (non-2xx, timeout, network failure). Messages
 * never contain the URL, which may carry a signed token. If `options.signal` aborts, its reason
 * is rethrown untouched (cancellation is not a failure).
 */
export async function safeFetch(url: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const policy = options.allowHttpForTests === true ? TEST : STRICT;
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(AppError.of('provider_error', 'Download timed out')),
    options.timeoutMs,
  );
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;

  try {
    let current = await validateUrl(url, policy);
    for (let redirects = 0; ; redirects += 1) {
      signal.throwIfAborted();
      const hop = await requestOnce(current, {
        policy,
        signal,
        maxBytes: options.maxBytes,
        allowedContentTypes: options.allowedContentTypes,
      });
      if (hop.kind === 'done') {
        return { bytes: hop.bytes, contentType: hop.contentType, finalUrl: current.href };
      }
      if (redirects >= MAX_REDIRECTS) throw AppError.of('bad_request', 'Too many redirects');
      let next: URL;
      try {
        next = new URL(hop.location, current);
      } catch {
        throw AppError.of('bad_request', 'URL is not allowed: invalid redirect');
      }
      current = await validateUrl(next, policy);
    }
  } catch (error) {
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (timeout.signal.aborted) throw AppError.of('provider_error', 'Download timed out');
    if (error instanceof AppError) throw error;
    throw new AppError('provider_error', 502, 'Download failed', undefined, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}
