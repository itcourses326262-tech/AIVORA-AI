import { gzipSync } from 'node:zlib';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import {
  assertPublicHttpsUrl,
  isPublicAddress,
  safeFetch,
  setSsrfResolverForTests,
  type ResolvedAddress,
  type SafeFetchOptions,
} from '@/server/security/ssrf';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

// ---- A local server that plays the part of a hostile or merely sloppy CDN -----------------------

interface Seen {
  url: string;
  headers: http.IncomingHttpHeaders;
}

let server: http.Server;
let port = 0;
let seen: Seen[] = [];
let origin = '';

function handle(request: http.IncomingMessage, response: http.ServerResponse): void {
  const url = request.url ?? '/';
  seen.push({ url, headers: request.headers });
  const redirect = (status: number, location?: string) => {
    response.writeHead(status, location === undefined ? {} : { location });
    response.end();
  };
  const png = (status = 200, headers: http.OutgoingHttpHeaders = {}) => {
    response.writeHead(status, { 'content-type': 'image/png', ...headers });
    response.end(PNG);
  };

  switch (url.split('?')[0]) {
    case '/ok.png':
      return png();
    case '/ok-with-params':
      response.writeHead(200, { 'content-type': 'Image/PNG; charset=binary' });
      return void response.end(PNG);
    case '/text':
      response.writeHead(200, { 'content-type': 'text/html' });
      return void response.end('<script>alert(1)</script>');
    case '/octet':
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      return void response.end(PNG);
    case '/no-type':
      response.writeHead(200);
      return void response.end(PNG);
    case '/big-declared':
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(50 * 1024 * 1024),
      });
      return void response.end(Buffer.alloc(1024)); // lies; the cap must trip on the header
    case '/big-chunked': {
      response.writeHead(200, { 'content-type': 'image/png' }); // no content-length: chunked
      const chunk = Buffer.alloc(64 * 1024, 1);
      let sent = 0;
      const pump = () => {
        while (sent < 40 * 1024 * 1024) {
          sent += chunk.length;
          if (!response.write(chunk)) return void response.once('drain', pump);
        }
        response.end();
      };
      pump();
      return;
    }
    case '/gzip':
      response.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' });
      return void response.end(gzipSync(PNG));
    case '/redirect-ok':
      return redirect(302, '/ok.png');
    case '/redirect-absolute':
      return redirect(301, `${origin}/ok.png`);
    case '/redirect-308':
      return redirect(308, '/ok.png');
    case '/redirect-twice':
      return redirect(302, '/redirect-ok');
    case '/redirect-3':
      return redirect(302, '/redirect-twice');
    case '/redirect-4':
      return redirect(302, '/redirect-3');
    case '/redirect-loop':
      return redirect(302, '/redirect-loop');
    case '/redirect-none':
      return redirect(302);
    case '/redirect-metadata':
      return redirect(302, 'http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    case '/redirect-private':
      return redirect(302, 'http://10.0.0.5/admin');
    case '/redirect-private-v6':
      return redirect(302, 'http://[fd00::1]/admin');
    case '/redirect-mapped':
      return redirect(302, 'http://[::ffff:192.168.0.1]/');
    case '/redirect-cgnat':
      return redirect(302, 'http://100.100.100.200/latest/meta-data/');
    case '/redirect-file':
      return redirect(302, 'file:///etc/passwd');
    case '/redirect-ftp':
      return redirect(302, 'ftp://example.com/x');
    case '/redirect-javascript':
      return redirect(302, 'javascript:alert(1)');
    case '/redirect-rebind':
      return redirect(302, 'http://rebind.test:' + port + '/ok.png');
    case '/redirect-to-evil-name':
      return redirect(302, 'http://intranet.test/secret');
    case '/status-500':
      return png(500);
    case '/status-404':
      return png(404);
    case '/status-204':
      response.writeHead(204);
      return void response.end();
    case '/headers':
      response.writeHead(200, { 'content-type': 'image/png' });
      return void response.end(PNG);
    case '/early-close':
      response.writeHead(200, { 'content-type': 'image/png', 'content-length': '1000' });
      response.write(Buffer.alloc(10));
      return void setTimeout(() => response.socket?.destroy(), 20);
    case '/hang':
      return; // never answers
    case '/drip': {
      response.writeHead(200, { 'content-type': 'image/png' });
      const timer = setInterval(() => response.write(Buffer.alloc(1)), 25);
      response.on('close', () => clearInterval(timer));
      return;
    }
    default:
      response.writeHead(404);
      response.end();
  }
}

beforeAll(async () => {
  server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

// ---- A scriptable resolver ---------------------------------------------------------------------

let answers: Record<string, ResolvedAddress[][]> = {};
let lookups: string[] = [];

function dns(host: string, ...rounds: string[][]): void {
  answers[host] = rounds.map((addresses) =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
  );
}

beforeEach(() => {
  seen = [];
  lookups = [];
  answers = {};
  setSsrfResolverForTests(async (host) => {
    lookups.push(host);
    const rounds = answers[host];
    if (!rounds) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    // Each lookup consumes the next scripted answer; the last one repeats.
    const index = Math.min(lookups.filter((name) => name === host).length - 1, rounds.length - 1);
    return rounds[index] ?? [];
  });
});

afterEach(() => setSsrfResolverForTests(null));

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error, 'should have been rejected').toBeInstanceOf(AppError);
  return error as AppError;
}

const FETCH: SafeFetchOptions = {
  maxBytes: 1024 * 1024,
  timeoutMs: 5000,
  allowedContentTypes: ['image/*'],
  allowHttpForTests: true,
};

// ---- isPublicAddress ---------------------------------------------------------------------------

describe('isPublicAddress', () => {
  const blocked = [
    // IPv4: loopback, private, link-local, metadata, CGNAT, reserved
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '192.168.255.255',
    '169.254.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.127.255.255',
    '100.100.100.200',
    '192.0.0.192',
    '192.0.2.5',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.9',
    '203.0.113.9',
    '192.88.99.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    // IPv6: loopback, unspecified, link-local, unique-local, multicast, transition mechanisms
    '::1',
    '::',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fd00:ec2::254',
    'ff02::1',
    'ff00::',
    '::127.0.0.1',
    '::10.0.0.1',
    '64:ff9b::7f00:1',
    '64:ff9b::a00:1',
    '64:ff9b:1::1',
    '100::1',
    '2001::1',
    '2001:0:4136:e378:8000:63bf:3fff:fdd2',
    '2001:db8::1',
    '2002:7f00:1::1',
    '2002:c0a8:1::1',
    '3fff::1',
    '5f00::1',
    'fec0::1',
    // IPv4-mapped IPv6 is judged by the IPv4 inside
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:192.168.1.1',
    '::ffff:169.254.169.254',
    '::ffff:100.64.0.1',
    '0:0:0:0:0:ffff:a00:1',
    // not addresses at all
    '',
    'example.com',
    '999.1.1.1',
    '1.2.3',
    '::g',
  ];
  const allowed = [
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '172.15.255.255',
    '172.32.0.1',
    '100.63.255.255',
    '100.128.0.1',
    '169.253.1.1',
    '126.255.255.255',
    '128.0.0.1',
    '191.255.255.255',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '2a00:1450:4001::1',
    '2001:200::1',
    '2400:cb00::1',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ];

  it.each(blocked)('blocks %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(allowed)('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it('lets loopback through only when asked (tests), and nothing else private', () => {
    expect(isPublicAddress('127.0.0.1', { allowLoopback: true })).toBe(true);
    expect(isPublicAddress('::1', { allowLoopback: true })).toBe(true);
    expect(isPublicAddress('::ffff:127.0.0.1', { allowLoopback: true })).toBe(true);
    for (const address of [
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      'fe80::1',
      'fd00::1',
      '0.0.0.0',
      '::',
    ]) {
      expect(isPublicAddress(address, { allowLoopback: true }), address).toBe(false);
    }
  });
});

// ---- assertPublicHttpsUrl ----------------------------------------------------------------------

describe('assertPublicHttpsUrl', () => {
  it('returns the parsed URL for a public https host', async () => {
    dns('cdn.example.com', ['93.184.216.34']);
    const url = await assertPublicHttpsUrl('https://cdn.example.com/a/b.png?sig=abc#frag');
    expect(url).toBeInstanceOf(URL);
    expect(url.href).toBe('https://cdn.example.com/a/b.png?sig=abc#frag');
    expect((await assertPublicHttpsUrl(new URL('https://8.8.8.8/x'))).hostname).toBe('8.8.8.8');
    expect((await assertPublicHttpsUrl('https://[2606:4700:4700::1111]/x')).hostname).toBe(
      '[2606:4700:4700::1111]',
    );
    expect((await assertPublicHttpsUrl('https://cdn.example.com:443/x')).port).toBe('');
  });

  const refused = [
    // scheme
    'http://cdn.example.com/x',
    'ftp://cdn.example.com/x',
    'file:///etc/passwd',
    'gopher://x/',
    'data:image/png;base64,AAAA',
    'javascript:alert(1)',
    'ws://cdn.example.com/',
    '//cdn.example.com/x',
    // credentials and ports
    'https://user:pass@cdn.example.com/x',
    'https://user@cdn.example.com/x',
    'https://:pw@cdn.example.com/',
    'https://cdn.example.com:8443/x',
    'https://cdn.example.com:80/x',
    'https://cdn.example.com:22/',
    // private IPv4, every spelling the URL parser normalizes
    'https://127.0.0.1/',
    'https://127.1/',
    'https://0x7f.0.0.1/',
    'https://0177.0.0.1/',
    'https://2130706433/',
    'https://017700000001/',
    'https://0/',
    'https://0.0.0.0/',
    'https://10.0.0.1/',
    'https://172.16.5.5/',
    'https://192.168.1.1/',
    'https://169.254.169.254/latest/meta-data/',
    'https://100.64.0.1/',
    'https://100.100.100.200/',
    'https://192.0.0.192/',
    'https://3232235777/',
    // IPv6 literals
    'https://[::1]/',
    'https://[::]/',
    'https://[fe80::1]/',
    'https://[fc00::1]/',
    'https://[fd00:ec2::254]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::127.0.0.1]/',
    'https://[64:ff9b::7f00:1]/',
    'https://[2002:7f00:1::]/',
    'https://[ff02::1]/',
    // names that must never be fetched
    'https://localhost/',
    'https://LOCALHOST/',
    'https://localhost./',
    'https://app.localhost/',
    'https://metadata.google.internal/computeMetadata/v1/',
    'https://db.internal/',
    'https://printer.local/',
    'https://router.lan/',
    'https://metadata/',
    // not URLs
    '',
    ' ',
    'not a url',
    'https://',
    `https://example.com/${'a'.repeat(5000)}`,
  ];

  it.each(refused)('refuses %s', async (candidate) => {
    const error = await rejection(assertPublicHttpsUrl(candidate));
    expect(error.code).toBe('bad_request');
    expect(error.status).toBe(400);
    // Refused by shape: the verdict must not depend on what DNS happens to answer.
    expect(lookups).toEqual([]);
  });

  it('resolves DNS and refuses names that point at private addresses', async () => {
    dns('intranet.example.com', ['10.1.2.3']);
    dns('metadata.example.com', ['169.254.169.254']);
    dns('loop.example.com', ['127.0.0.1']);
    dns('v6.example.com', ['fd00::5']);
    dns('mapped.example.com', ['::ffff:10.0.0.1']);
    for (const host of ['intranet', 'metadata', 'loop', 'v6', 'mapped']) {
      const error = await rejection(assertPublicHttpsUrl(`https://${host}.example.com/x`));
      expect(error.code, host).toBe('bad_request');
    }
  });

  it('refuses a name when ANY of its records is private (no cherry-picking by the connection)', async () => {
    dns('mixed.example.com', ['93.184.216.34', '10.0.0.7']);
    dns('mixed6.example.com', ['2606:4700:4700::1111', '::1']);
    expect((await rejection(assertPublicHttpsUrl('https://mixed.example.com/'))).code).toBe(
      'bad_request',
    );
    expect((await rejection(assertPublicHttpsUrl('https://mixed6.example.com/'))).code).toBe(
      'bad_request',
    );
  });

  it('refuses names that do not resolve, or resolve to nothing', async () => {
    dns('empty.example.com', []);
    expect((await rejection(assertPublicHttpsUrl('https://nxdomain.example.com/'))).code).toBe(
      'bad_request',
    );
    expect((await rejection(assertPublicHttpsUrl('https://empty.example.com/'))).code).toBe(
      'bad_request',
    );
  });

  it('does not put the URL, a token in it, or a resolved address into the error', async () => {
    dns('tok.example.com', ['10.9.8.7']);
    const error = await rejection(
      assertPublicHttpsUrl('https://tok.example.com/x?token=SECRET123'),
    );
    expect(error.message).not.toMatch(/SECRET123|10\.9\.8\.7|tok\.example/);
    expect(JSON.stringify(error.details ?? null)).not.toMatch(/SECRET123|10\.9\.8\.7/);
  });
});

// ---- safeFetch: the happy path -----------------------------------------------------------------

describe('safeFetch', () => {
  it('downloads a response and reports type, final URL and a standalone byte array', async () => {
    const result = await safeFetch(`${origin}/ok.png`, FETCH);
    expect(Buffer.from(result.bytes)).toEqual(PNG);
    expect(result.contentType).toBe('image/png');
    expect(result.finalUrl).toBe(`${origin}/ok.png`);
    expect(result.bytes.byteOffset).toBe(0);
    expect(result.bytes.buffer.byteLength).toBe(PNG.length);
  });

  it('matches the media type without parameters or case', async () => {
    const result = await safeFetch(`${origin}/ok-with-params`, FETCH);
    expect(result.contentType).toBe('image/png');
  });

  it('sends a minimal request: GET, no compression, no cookies or credentials', async () => {
    await safeFetch(`${origin}/headers`, FETCH);
    const [only] = seen;
    expect(only?.headers['accept-encoding']).toBe('identity');
    expect(only?.headers['user-agent']).toMatch(/^AIVORE/);
    for (const name of ['cookie', 'authorization', 'proxy-authorization']) {
      expect(only?.headers[name]).toBeUndefined();
    }
  });

  it('keeps the query string (signed URLs need it) and sends the Host of the URL', async () => {
    await safeFetch(`${origin}/ok.png?X-Signature=abc&exp=1`, FETCH);
    expect(seen[0]?.url).toBe('/ok.png?X-Signature=abc&exp=1');
    expect(seen[0]?.headers.host).toBe(`127.0.0.1:${port}`);
  });

  it('connects through the guarded lookup: a name only the stub resolver knows works, and is resolved', async () => {
    dns('files.test', ['127.0.0.1']);
    const result = await safeFetch(`http://files.test:${port}/ok.png`, FETCH);
    expect(Buffer.from(result.bytes)).toEqual(PNG);
    expect(lookups).toContain('files.test');
    expect(seen[0]?.headers.host).toBe(`files.test:${port}`);
  });

  it('accepts an empty-ish 2xx body and rejects non-2xx statuses', async () => {
    for (const path of ['/status-500', '/status-404']) {
      const error = await rejection(safeFetch(`${origin}${path}`, FETCH));
      expect(error.code, path).toBe('provider_error');
      expect(error.message).toMatch(/status \d{3}/);
    }
    await expect(
      safeFetch(`${origin}/status-204`, { ...FETCH, allowedContentTypes: ['*/*'] }),
    ).resolves.toMatchObject({
      bytes: new Uint8Array(0),
    });
  });
});

// ---- safeFetch: content type -------------------------------------------------------------------

describe('safeFetch content-type allowlist', () => {
  it('refuses a type outside the list before reading the body', async () => {
    const error = await rejection(safeFetch(`${origin}/text`, FETCH));
    expect(error).toMatchObject({ code: 'unsupported_media_type', status: 415 });
  });

  it('supports exact types and wildcards, and refuses near misses', async () => {
    await expect(
      safeFetch(`${origin}/ok.png`, { ...FETCH, allowedContentTypes: ['image/png'] }),
    ).resolves.toBeDefined();
    await expect(
      safeFetch(`${origin}/ok.png`, { ...FETCH, allowedContentTypes: ['video/mp4', 'IMAGE/*'] }),
    ).resolves.toBeDefined();
    for (const list of [['image/jpeg'], ['video/*'], ['image/pngx'], ['image'], []]) {
      const error = await rejection(
        safeFetch(`${origin}/ok.png`, { ...FETCH, allowedContentTypes: list }),
      );
      expect(error.code, list.join()).toBe('unsupported_media_type');
    }
  });

  it('treats application/octet-stream and a missing type as not allowed unless asked for', async () => {
    expect((await rejection(safeFetch(`${origin}/octet`, FETCH))).code).toBe(
      'unsupported_media_type',
    );
    expect((await rejection(safeFetch(`${origin}/no-type`, FETCH))).code).toBe(
      'unsupported_media_type',
    );
    await expect(
      safeFetch(`${origin}/octet`, { ...FETCH, allowedContentTypes: ['application/octet-stream'] }),
    ).resolves.toBeDefined();
    await expect(
      safeFetch(`${origin}/no-type`, { ...FETCH, allowedContentTypes: ['*/*'] }),
    ).resolves.toBeDefined();
  });

  it('refuses compressed responses (a small body could expand past the cap)', async () => {
    const error = await rejection(safeFetch(`${origin}/gzip`, FETCH));
    expect(error.code).toBe('unsupported_media_type');
  });
});

// ---- safeFetch: size ---------------------------------------------------------------------------

describe('safeFetch size cap', () => {
  it('rejects on the declared Content-Length without downloading', async () => {
    const error = await rejection(safeFetch(`${origin}/big-declared`, FETCH));
    expect(error).toMatchObject({ code: 'payload_too_large', status: 413 });
  });

  it('enforces the cap while streaming when there is no Content-Length, and stops reading', async () => {
    const started = Date.now();
    const error = await rejection(
      safeFetch(`${origin}/big-chunked`, { ...FETCH, maxBytes: 256 * 1024 }),
    );
    expect(error.code).toBe('payload_too_large');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('accepts a body exactly at the cap and refuses one byte over', async () => {
    await expect(
      safeFetch(`${origin}/ok.png`, { ...FETCH, maxBytes: PNG.length }),
    ).resolves.toBeDefined();
    const error = await rejection(
      safeFetch(`${origin}/ok.png`, { ...FETCH, maxBytes: PNG.length - 1 }),
    );
    expect(error.code).toBe('payload_too_large');
  });

  it('reports a connection that dies mid-body as a provider error, not a short success', async () => {
    const error = await rejection(safeFetch(`${origin}/early-close`, FETCH));
    expect(error.code).toBe('provider_error');
  });
});

// ---- safeFetch: redirects ----------------------------------------------------------------------

describe('safeFetch redirects', () => {
  it('follows relative and absolute redirects', async () => {
    for (const path of ['/redirect-ok', '/redirect-absolute', '/redirect-308']) {
      const result = await safeFetch(`${origin}${path}`, FETCH);
      expect(result.finalUrl, path).toBe(`${origin}/ok.png`);
      expect(Buffer.from(result.bytes)).toEqual(PNG);
    }
  });

  it('follows up to 3 redirects and fails on the 4th', async () => {
    await expect(safeFetch(`${origin}/redirect-3`, FETCH)).resolves.toMatchObject({
      finalUrl: `${origin}/ok.png`,
    });
    const error = await rejection(safeFetch(`${origin}/redirect-4`, FETCH));
    expect(error).toMatchObject({
      code: 'bad_request',
      message: expect.stringMatching(/redirect/i),
    });
  });

  it('stops a redirect loop', async () => {
    const error = await rejection(safeFetch(`${origin}/redirect-loop`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(seen.length).toBeLessThanOrEqual(4);
  });

  it('rejects a redirect without Location', async () => {
    expect((await rejection(safeFetch(`${origin}/redirect-none`, FETCH))).code).toBe(
      'provider_error',
    );
  });

  it.each([
    ['cloud metadata (link-local)', '/redirect-metadata'],
    ['a private IPv4 address', '/redirect-private'],
    ['a unique-local IPv6 address', '/redirect-private-v6'],
    ['an IPv4-mapped private address', '/redirect-mapped'],
    ['the CGNAT metadata address', '/redirect-cgnat'],
    ['a file: URL', '/redirect-file'],
    ['an ftp: URL', '/redirect-ftp'],
    ['a javascript: URL', '/redirect-javascript'],
  ])('refuses a redirect to %s and never connects there', async (_name, path) => {
    const error = await rejection(safeFetch(`${origin}${path}`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(error.message).not.toMatch(/169\.254|10\.0\.0|etc\/passwd/);
    expect(seen.map((entry) => entry.url)).toEqual([path]); // only the first hop was ever requested
  });

  it('re-resolves and refuses a redirect to a NAME that points inward', async () => {
    dns('intranet.test', ['192.168.1.20']);
    const error = await rejection(safeFetch(`${origin}/redirect-to-evil-name`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(lookups).toContain('intranet.test');
    expect(seen).toHaveLength(1);
  });

  it('applies the https-only rule to redirects too when not in test mode', async () => {
    dns('safe.example.com', ['93.184.216.34']);
    // Strict mode cannot even reach the local server; the point is that the first URL is judged.
    const error = await rejection(
      safeFetch(`${origin}/redirect-ok`, { ...FETCH, allowHttpForTests: false }),
    );
    expect(error.code).toBe('bad_request');
    expect(seen).toHaveLength(0);
  });
});

// ---- safeFetch: strict mode and DNS rebinding --------------------------------------------------

describe('safeFetch in production mode', () => {
  const strict: SafeFetchOptions = { ...FETCH, allowHttpForTests: undefined };

  it('never connects to a loopback or private literal, even if something listens there', async () => {
    for (const url of [
      `${origin}/ok.png`,
      `https://127.0.0.1:${port}/ok.png`,
      'https://[::1]/',
      'https://10.0.0.1/',
      'https://169.254.169.254/',
    ]) {
      const error = await rejection(safeFetch(url, strict));
      expect(error.code, url).toBe('bad_request');
    }
    expect(seen).toEqual([]);
  });

  it('refuses names that resolve to loopback', async () => {
    dns('sneaky.example.com', ['127.0.0.1']);
    expect((await rejection(safeFetch('https://sneaky.example.com/', strict))).code).toBe(
      'bad_request',
    );
    expect(seen).toEqual([]);
  });
});

describe('DNS rebinding', () => {
  it('validates the address the socket will actually use, not just the one seen when validating the URL', async () => {
    // First answer (URL validation): public. Second (the connection): a private address.
    dns('rebind.test', ['93.184.216.34'], ['169.254.169.254']);
    const error = await rejection(safeFetch(`http://rebind.test:${port}/ok.png`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(lookups.filter((host) => host === 'rebind.test')).toHaveLength(2);
    expect(seen, 'nothing was requested from anything').toEqual([]);
  });

  it('applies to redirect hops as well', async () => {
    dns('rebind.test', ['127.0.0.1'], ['10.0.0.9']);
    const error = await rejection(safeFetch(`${origin}/redirect-rebind`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(seen.map((entry) => entry.url)).toEqual(['/redirect-rebind']);
  });

  it('connects to exactly the validated answer when it stays public (here: loopback, test mode)', async () => {
    dns('stable.test', ['127.0.0.1'], ['127.0.0.1']);
    await expect(safeFetch(`http://stable.test:${port}/ok.png`, FETCH)).resolves.toBeDefined();
  });

  it('refuses a name that answers with a private record only on the second lookup, mixed in with a public one', async () => {
    dns('mix.test', ['127.0.0.1'], ['127.0.0.1', '192.168.0.9']);
    const error = await rejection(safeFetch(`http://mix.test:${port}/ok.png`, FETCH));
    expect(error.code).toBe('bad_request');
    expect(seen).toEqual([]);
  });
});

// ---- safeFetch: time and cancellation ----------------------------------------------------------

describe('safeFetch timeouts and cancellation', () => {
  it('times out a server that never answers', async () => {
    const started = Date.now();
    const error = await rejection(safeFetch(`${origin}/hang`, { ...FETCH, timeoutMs: 150 }));
    expect(error).toMatchObject({
      code: 'provider_error',
      message: expect.stringMatching(/timed out/i),
    });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('times out a body that drips forever (the budget covers the whole download)', async () => {
    const error = await rejection(safeFetch(`${origin}/drip`, { ...FETCH, timeoutMs: 200 }));
    expect(error.message).toMatch(/timed out/i);
  });

  it('rethrows the caller signal reason untouched when canceled mid-download', async () => {
    const controller = new AbortController();
    const reason = new Error('generation canceled');
    const pending = safeFetch(`${origin}/hang`, { ...FETCH, signal: controller.signal });
    setTimeout(() => controller.abort(reason), 50);
    await expect(pending).rejects.toBe(reason);
  });

  it('does not start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      safeFetch(`${origin}/ok.png`, { ...FETCH, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(seen).toEqual([]);
  });

  it('reports a refused connection as a provider error without the address', async () => {
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const closedPort = (closed.address() as AddressInfo).port;
    await new Promise((resolve) => closed.close(resolve));
    const error = await rejection(safeFetch(`http://127.0.0.1:${closedPort}/x`, FETCH));
    expect(error.code).toBe('provider_error');
    expect(error.message).not.toContain(String(closedPort));
  });
});
