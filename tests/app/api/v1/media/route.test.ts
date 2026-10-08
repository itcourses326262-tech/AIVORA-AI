import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryRateLimiter,
  setRateLimiter,
  type RateLimiter,
} from '@/server/security/rate-limit';
import { setStorageOverride } from '@/server/storage';
import type { StorageDriver } from '@/server/storage/types';
import { freshDb } from '../../../../helpers/db';
import { createGeneration, createUserWithSession } from '../../../../helpers/factories';
import { TINY_PNG, fakeStorage } from '../../../../helpers/fakes';
import { fakeMp4, makeJpeg, makePng } from '../../../../server/uploads/support';
import {
  authenticateFromDb,
  createApiKeyFor,
  setGenerationPublic,
  storeAsset,
  tamperMimeType,
  withTempStorage,
} from './support';

const auth = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock('@/server/auth', () => ({ authenticate: auth.authenticate }));

import { GET, HEAD } from '@/app/api/v1/media/[assetId]/route';

const state = freshDb();
const disk = withTempStorage();

beforeEach(() => {
  setRateLimiter(new InMemoryRateLimiter());
  auth.authenticate.mockReset().mockImplementation(authenticateFromDb);
});

interface CallOptions {
  headers?: Record<string, string>;
  /** Query string including the `?`. */
  query?: string;
}

/** Calls the handler like Next.js does and reads the raw body bytes (invokeRoute decodes text). */
async function call(handler: typeof GET, assetId: string, options: CallOptions = {}) {
  const url = new URL(`/api/v1/media/${assetId}${options.query ?? ''}`, 'http://localhost:3000');
  const method = handler === HEAD ? 'HEAD' : 'GET';
  const response = await handler(new Request(url, { method, headers: options.headers }), {
    params: Promise.resolve({ assetId }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  return { status: response.status, headers: response.headers, bytes, text, response };
}
const get = (assetId: string, options?: CallOptions) => call(GET, assetId, options);
const head = (assetId: string, options?: CallOptions) => call(HEAD, assetId, options);

const NOT_FOUND = { error: { code: 'not_found', message: 'Asset not found' } };

function twoUsers() {
  return { owner: createUserWithSession(state.db), other: createUserWithSession(state.db) };
}

describe('serving an owner their own asset', () => {
  it('sends the exact bytes with private, non-sniffable headers', async () => {
    const { owner } = twoUsers();
    const png = await makePng(50, 40);
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: png });
    const result = await get(asset.id, { headers: owner.session.headers });

    expect(result.status).toBe(200);
    expect(Buffer.from(result.bytes).equals(Buffer.from(png))).toBe(true);
    const h = result.headers;
    expect(h.get('content-type')).toBe('image/png');
    expect(h.get('content-length')).toBe(String(png.byteLength));
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('content-disposition')).toBe('inline');
    expect(h.get('accept-ranges')).toBe('bytes');
    expect(h.get('cache-control')).toBe('private, max-age=3600');
    expect(h.get('vary')).toBe('Cookie, Authorization');
    expect(h.get('etag')).toBe(`"${asset.id}-original"`);
    expect(h.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(h.get('x-request-id')).toBeTruthy();
  });

  it('accepts an API key exactly like the session cookie', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const { headers } = createApiKeyFor(owner.user.id);
    const viaKey = await get(asset.id, { headers });
    const viaCookie = await get(asset.id, { headers: owner.session.headers });
    expect(viaKey.status).toBe(200);
    expect(viaKey.bytes).toEqual(viaCookie.bytes);
    expect(viaKey.headers.get('cache-control')).toBe('private, max-age=3600');
  });

  it('serves the thumbnail with ?variant=thumb under its own type, etag and no ranges', async () => {
    const { owner } = twoUsers();
    const thumb = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG, thumb });
    const result = await get(asset.id, { headers: owner.session.headers, query: '?variant=thumb' });
    expect(result.status).toBe(200);
    expect(result.bytes).toEqual(thumb);
    expect(result.headers.get('content-type')).toBe('image/webp');
    expect(result.headers.get('etag')).toBe(`"${asset.id}-thumb"`);
    expect(result.headers.get('accept-ranges')).toBe('none');
    const ranged = await get(asset.id, {
      headers: { ...owner.session.headers, range: 'bytes=0-1' },
      query: '?variant=thumb',
    });
    expect(ranged.status).toBe(200);
    expect(ranged.bytes).toEqual(thumb);
  });

  it('answers 404 for a thumbnail an asset does not have', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      thumb: null,
    });
    const result = await get(asset.id, { headers: owner.session.headers, query: '?variant=thumb' });
    expect(result.status).toBe(404);
    expect(JSON.parse(result.text)).toEqual(NOT_FOUND);
  });
});

describe('who may not see an asset (IDOR)', () => {
  it('answers 404, never 403, to another signed-in user, an anonymous caller and a bad credential', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const otherKey = createApiKeyFor(other.user.id);
    const missing = await get('ast_00000000000000000000000000', { headers: owner.session.headers });
    expect(missing.status).toBe(404);

    const attempts = [
      { headers: other.session.headers },
      { headers: otherKey.headers },
      { headers: undefined },
      { headers: { authorization: 'Bearer avk_not_a_real_key' } },
      { headers: { cookie: 'aivore_session=forged' } },
    ];
    for (const attempt of attempts) {
      const result = await get(asset.id, attempt);
      expect(result.status).toBe(404);
      // Byte-identical to "no such asset": nothing tells the two apart.
      expect(result.text).toBe(missing.text);
      expect(JSON.parse(result.text)).toEqual(NOT_FOUND);
      expect(result.headers.get('cache-control')).toBe('no-store');
      expect(result.bytes.byteLength).toBe(missing.bytes.byteLength);
    }
  });

  it('does not let another user at the thumbnail or the download either', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      thumb: new Uint8Array([1, 2, 3]),
    });
    for (const query of ['?variant=thumb', '?download=1', '?variant=thumb&download=1']) {
      expect((await get(asset.id, { headers: other.session.headers, query })).status).toBe(404);
      expect((await head(asset.id, { headers: other.session.headers, query })).status).toBe(404);
    }
  });

  it('keeps a private generation private, and the owner can still see it', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation: { isPublic: false },
    });
    expect((await get(asset.id, { headers: other.session.headers })).status).toBe(404);
    expect((await get(asset.id)).status).toBe(404);
    expect((await get(asset.id, { headers: owner.session.headers })).status).toBe(200);
  });

  it('does not let a revoked key or an expired session through', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const key = createApiKeyFor(owner.user.id);
    expect((await get(asset.id, { headers: key.headers })).status).toBe(200);
    state.db.$client.prepare('update api_keys set revoked_at = ?').run(Date.now());
    expect((await get(asset.id, { headers: key.headers })).status).toBe(404);
    state.db.$client.prepare('update sessions set expires_at = ?').run(Date.now() - 1000);
    expect((await get(asset.id, { headers: owner.session.headers })).status).toBe(404);
  });

  it('treats malformed ids as plain 404s without touching the database or storage', async () => {
    const spy = vi.spyOn(disk.storage, 'get');
    for (const id of [
      '../../etc/passwd',
      'ast_',
      'ast_UPPERCASEUPPERCASEUPPERCASE',
      'gen_00000000000000000000000000',
      'ast_0000000000000000000000000000000',
      '%2e%2e%2f',
      'x',
    ]) {
      const result = await get(id);
      expect(result.status).toBe(404);
      expect(JSON.parse(result.text)).toEqual(NOT_FOUND);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('public sharing', () => {
  it('serves the outputs of a public generation to anyone, with a short public cache', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation: { isPublic: true },
      thumb: new Uint8Array([9, 9, 9]),
    });
    for (const headers of [
      undefined,
      other.session.headers,
      createApiKeyFor(other.user.id).headers,
    ]) {
      const result = await get(asset.id, { headers });
      expect(result.status).toBe(200);
      expect(result.bytes).toEqual(TINY_PNG);
      expect(result.headers.get('cache-control')).toBe('public, max-age=300');
      expect(result.headers.get('vary')).toBeNull();
      expect(result.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const thumb = await get(asset.id, { query: '?variant=thumb' });
    expect(thumb.status).toBe(200);
    expect(thumb.headers.get('cache-control')).toBe('public, max-age=300');
    // The owner still gets the private variant of the same URL.
    expect(
      (await get(asset.id, { headers: owner.session.headers })).headers.get('cache-control'),
    ).toBe('private, max-age=3600');
  });

  it('stops serving as soon as the generation is made private again', async () => {
    const { owner } = twoUsers();
    const generation = createGeneration(state.db, { userId: owner.user.id, isPublic: true });
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation,
    });
    expect((await get(asset.id)).status).toBe(200);
    setGenerationPublic(generation.id, false);
    expect((await get(asset.id)).status).toBe(404);
  });

  it('never shares an input image, even when the generation made from it is public', async () => {
    const { owner } = twoUsers();
    const generation = createGeneration(state.db, { userId: owner.user.id, isPublic: true });
    const input = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation,
      role: 'input',
    });
    const upload = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    expect((await get(input.id)).status).toBe(404);
    expect((await get(upload.id)).status).toBe(404);
    expect((await get(input.id, { headers: owner.session.headers })).status).toBe(200);
  });
});

describe("content type is ours, never the user's", () => {
  it.each([
    ['text/html', 'text/html'],
    ['image/svg+xml', 'image/svg+xml'],
    ['application/javascript', 'application/javascript'],
    ['image/png\r\nSet-Cookie: x=1', 'header injection'],
    ['', 'empty'],
  ])('serves a stored type of %j (%s) as an opaque download', async (mimeType) => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: new Uint8Array([60, 115, 99, 114, 105, 112, 116, 62]),
    });
    tamperMimeType(asset.id, mimeType);
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toBe('application/octet-stream');
    expect(result.headers.get('content-disposition')).toMatch(
      /^attachment; filename="aivore-image-[0-9a-z]{8}\.bin"$/,
    );
    expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    expect(result.headers.get('set-cookie')).toBeNull();
  });

  it('allows exactly the allowlisted types', async () => {
    const { owner } = twoUsers();
    for (const [mimeType, extension] of [
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
      ['video/mp4', 'mp4'],
      ['video/webm', 'webm'],
    ] as const) {
      const asset = await storeAsset(disk.storage, {
        userId: owner.user.id,
        bytes: TINY_PNG,
        extension,
      });
      tamperMimeType(asset.id, mimeType.toUpperCase());
      const result = await get(asset.id, { headers: owner.session.headers });
      expect(result.headers.get('content-type')).toBe(mimeType);
    }
  });

  it('ignores whatever content type the object was stored with', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    await disk.storage.put(asset.storageKey, TINY_PNG, { mimeType: 'text/html' });
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.headers.get('content-type')).toBe('image/png');
  });
});

describe('downloads', () => {
  it('sends an attachment named after the asset, never after user text', async () => {
    const { owner } = twoUsers();
    const generation = createGeneration(state.db, {
      userId: owner.user.id,
      prompt: '"; filename=evil.html\r\nX-Injected: 1',
    });
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation,
    });
    for (const query of ['?download=1', '?download=true']) {
      const result = await get(asset.id, { headers: owner.session.headers, query });
      expect(result.status).toBe(200);
      expect(result.headers.get('content-disposition')).toBe(
        `attachment; filename="aivore-image-${asset.id.slice(-8)}.png"`,
      );
      expect(result.headers.get('x-injected')).toBeNull();
    }
    for (const query of ['?download=0', '?download=false', '']) {
      const result = await get(asset.id, { headers: owner.session.headers, query });
      expect(result.headers.get('content-disposition')).toBe('inline');
    }
  });

  it('names a downloaded thumbnail .webp and a video .mp4', async () => {
    const { owner } = twoUsers();
    const image = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      thumb: new Uint8Array([1]),
    });
    const thumb = await get(image.id, {
      headers: owner.session.headers,
      query: '?variant=thumb&download=1',
    });
    expect(thumb.headers.get('content-disposition')).toMatch(/\.webp"$/);
    const video = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: fakeMp4(),
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const download = await get(video.id, { headers: owner.session.headers, query: '?download=1' });
    expect(download.headers.get('content-disposition')).toMatch(
      /^attachment; filename="aivore-video-[0-9a-z]{8}\.mp4"$/,
    );
  });

  it('rejects unknown variants but ignores unrelated query parameters', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const bad = await get(asset.id, { headers: owner.session.headers, query: '?variant=huge' });
    expect(bad.status).toBe(422);
    expect(
      (await get(asset.id, { headers: owner.session.headers, query: '?t=123&v=2' })).status,
    ).toBe(200);
  });
});

describe('conditional requests (ETag)', () => {
  it('answers 304 without a body when If-None-Match matches, for HEAD and GET', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const first = await get(asset.id, { headers: owner.session.headers });
    const etag = first.headers.get('etag') as string;

    for (const call of [get, head]) {
      const result = await call(asset.id, {
        headers: { ...owner.session.headers, 'if-none-match': etag },
      });
      expect(result.status).toBe(304);
      expect(result.bytes.byteLength).toBe(0);
      expect(result.headers.get('etag')).toBe(etag);
      expect(result.headers.get('cache-control')).toBe('private, max-age=3600');
      expect(result.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });

  it.each([
    ['a weak validator', (etag: string) => `W/${etag}`],
    ['a list containing it', (etag: string) => `"nope", ${etag}, "other"`],
    ['the wildcard', () => '*'],
  ])('treats %s as a match', async (_name, build) => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const etag = (await get(asset.id, { headers: owner.session.headers })).headers.get(
      'etag',
    ) as string;
    const result = await get(asset.id, {
      headers: { ...owner.session.headers, 'if-none-match': build(etag) },
    });
    expect(result.status).toBe(304);
  });

  it('serves the body when the validator differs, and keeps variants apart', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      thumb: new Uint8Array([1, 2]),
    });
    const stale = await get(asset.id, {
      headers: { ...owner.session.headers, 'if-none-match': '"something-else"' },
    });
    expect(stale.status).toBe(200);
    const thumbEtag = (
      await get(asset.id, { headers: owner.session.headers, query: '?variant=thumb' })
    ).headers.get('etag') as string;
    const mixed = await get(asset.id, {
      headers: { ...owner.session.headers, 'if-none-match': thumbEtag },
    });
    expect(mixed.status).toBe(200);
  });

  it('never confirms an asset to someone who may not see it: 404, not 304', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const etag = (await get(asset.id, { headers: owner.session.headers })).headers.get(
      'etag',
    ) as string;
    for (const headers of [other.session.headers, {}]) {
      const result = await get(asset.id, { headers: { ...headers, 'if-none-match': etag } });
      expect(result.status).toBe(404);
    }
    expect((await get(asset.id, { headers: { 'if-none-match': '*' } })).status).toBe(404);
  });

  it('does not read the stored object for a 304', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const getSpy = vi.spyOn(disk.storage, 'get');
    const headSpy = vi.spyOn(disk.storage, 'head');
    await get(asset.id, {
      headers: { ...owner.session.headers, 'if-none-match': `"${asset.id}-original"` },
    });
    expect(getSpy).not.toHaveBeenCalled();
    expect(headSpy).not.toHaveBeenCalled();
  });
});

describe('ranges', () => {
  const video = new Uint8Array(100).map((_, index) => index);

  async function ranged(range: string | undefined, extra: Record<string, string> = {}) {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: video,
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const headers = { ...owner.session.headers, ...(range ? { range } : {}), ...extra };
    return { asset, result: await get(asset.id, { headers }), owner };
  }

  it.each([
    ['bytes=0-9', 0, 9],
    ['bytes=10-19', 10, 19],
    ['bytes=0-0', 0, 0],
    ['bytes=99-99', 99, 99],
    ['bytes=90-', 90, 99],
    ['bytes=0-', 0, 99],
    ['bytes=-10', 90, 99],
    ['bytes=-1', 99, 99],
    ['bytes=-500', 0, 99],
    ['bytes=50-5000', 50, 99],
    ['bytes=0-99', 0, 99],
    ['Bytes=2-3', 2, 3],
    ['bytes= 4-5 ', 4, 5],
    ['bytes=99999999999999999999-', null, null],
  ])('%s -> 206 with the right slice (or 416)', async (range, start, end) => {
    const { result } = await ranged(range);
    if (start === null || end === null) {
      expect(result.status).toBe(416);
      return;
    }
    expect(result.status).toBe(206);
    expect(result.headers.get('content-range')).toBe(`bytes ${start}-${end}/100`);
    expect(result.headers.get('content-length')).toBe(String(end - start + 1));
    expect(result.headers.get('accept-ranges')).toBe('bytes');
    expect(result.headers.get('content-type')).toBe('video/mp4');
    expect(result.bytes).toEqual(video.slice(start, end + 1));
  });

  it.each([
    'bytes=100-',
    'bytes=100-200',
    'bytes=500-600',
    'bytes=-0',
    'bytes=0000000000000000000099999-',
  ])('%s -> 416 reporting the real size', async (range) => {
    const { result } = await ranged(range);
    expect(result.status).toBe(416);
    expect(result.headers.get('content-range')).toBe('bytes */100');
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(result.text).error.code).toBe('bad_request');
  });

  it.each([
    ['a reversed range', 'bytes=5-2'],
    ['multiple ranges', 'bytes=0-1,5-6'],
    ['another unit', 'items=0-5'],
    ['no unit', '0-5'],
    ['an empty spec', 'bytes='],
    ['a bare dash', 'bytes=-'],
    ['letters', 'bytes=a-b'],
    ['a negative start with an end', 'bytes=-5-9'],
    ['a decimal', 'bytes=1.5-3'],
    ['whitespace', '   '],
  ])('ignores %s and serves the whole file', async (_name, range) => {
    const { result } = await ranged(range);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-range')).toBeNull();
    expect(result.headers.get('content-length')).toBe('100');
    expect(result.bytes).toEqual(video);
  });

  it('honours If-Range only when it matches the current ETag', async () => {
    const { asset, result: first } = await ranged(undefined);
    const etag = first.headers.get('etag') as string;
    const { owner } = twoUsers();
    const own = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: video,
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const ownEtag = `"${own.id}-original"`;
    const resume = (ifRange: string) =>
      get(own.id, {
        headers: { ...owner.session.headers, range: 'bytes=10-19', 'if-range': ifRange },
      });

    expect((await resume(ownEtag)).status).toBe(206);
    expect((await resume(etag)).status).toBe(200);
    expect((await resume(`W/${ownEtag}`)).status).toBe(200);
    expect((await resume('Wed, 21 Oct 2015 07:28:00 GMT')).status).toBe(200);
    expect(asset.id).not.toBe(own.id);
  });

  it('streams a slice from the middle of a large file without reading the rest', async () => {
    const { owner } = twoUsers();
    const big = new Uint8Array(4 * 1024 * 1024).map((_, i) => (i * 7) & 0xff);
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: big,
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const start = 2_000_000;
    const result = await get(asset.id, {
      headers: { ...owner.session.headers, range: `bytes=${start}-${start + 999}` },
    });
    expect(result.status).toBe(206);
    expect(result.headers.get('content-range')).toBe(`bytes ${start}-${start + 999}/${big.length}`);
    expect(result.bytes).toEqual(big.slice(start, start + 1000));
    const tail = await get(asset.id, {
      headers: { ...owner.session.headers, range: 'bytes=-16' },
    });
    expect(tail.bytes).toEqual(big.slice(-16));
  });

  it('applies the same access rules to ranged requests', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: video,
      mimeType: 'video/mp4',
      kind: 'video',
    });
    for (const range of ['bytes=0-9', 'bytes=999-', 'bytes=-0']) {
      expect((await get(asset.id, { headers: { ...other.session.headers, range } })).status).toBe(
        404,
      );
      expect((await get(asset.id, { headers: { range } })).status).toBe(404);
    }
  });
});

describe('HEAD', () => {
  it('returns the headers of a GET and no body', async () => {
    const { owner } = twoUsers();
    const png = await makePng(30, 30);
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: png });
    const readBefore = vi.spyOn(disk.storage, 'get');
    const headResult = await head(asset.id, { headers: owner.session.headers });
    const getResult = await get(asset.id, { headers: owner.session.headers });
    expect(headResult.status).toBe(200);
    expect(headResult.bytes.byteLength).toBe(0);
    for (const name of [
      'content-type',
      'content-length',
      'etag',
      'cache-control',
      'content-disposition',
      'accept-ranges',
      'x-content-type-options',
      'vary',
    ]) {
      expect(headResult.headers.get(name), name).toBe(getResult.headers.get(name));
    }
    expect(readBefore).toHaveBeenCalledTimes(1);
  });

  it('supports ranges and 416 like GET', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: new Uint8Array(100),
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const partial = await head(asset.id, {
      headers: { ...owner.session.headers, range: 'bytes=10-19' },
    });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-range')).toBe('bytes 10-19/100');
    expect(partial.headers.get('content-length')).toBe('10');
    expect(partial.bytes.byteLength).toBe(0);
    const bad = await head(asset.id, {
      headers: { ...owner.session.headers, range: 'bytes=500-' },
    });
    expect(bad.status).toBe(416);
    expect(bad.headers.get('content-range')).toBe('bytes */100');
  });

  it('is 404 for strangers and for assets whose file is missing', async () => {
    const { owner, other } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    expect((await head(asset.id, { headers: other.session.headers })).status).toBe(404);
    await disk.storage.delete(asset.storageKey);
    expect((await head(asset.id, { headers: owner.session.headers })).status).toBe(404);
  });
});

describe('storage behaviour', () => {
  it('answers 404 (not 500) when the row exists but the object is gone', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    await disk.storage.delete(asset.storageKey);
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.status).toBe(404);
    expect(JSON.parse(result.text)).toEqual(NOT_FOUND);
  });

  it('turns an unexpected storage failure into a generic 500 without leaking details', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const broken: StorageDriver = {
      ...disk.storage,
      get: async () => {
        throw new Error('EIO: /var/secret/path exploded');
      },
    };
    setStorageOverride(broken);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.status).toBe(500);
    expect(result.text).not.toContain('secret');
    expect(JSON.parse(result.text).error.code).toBe('internal');
  });

  it('streams through the app even when the driver could offer a signed URL (no redirect)', async () => {
    const { owner } = twoUsers();
    const s3Like = fakeStorage({ signedUrls: true });
    setStorageOverride(s3Like);
    const signedUrl = vi.spyOn(s3Like, 'signedUrl' as never);
    const asset = await storeAsset(s3Like, { userId: owner.user.id, bytes: TINY_PNG });
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.status).toBe(200);
    expect(result.headers.get('location')).toBeNull();
    expect(result.bytes).toEqual(TINY_PNG);
    expect(signedUrl).not.toHaveBeenCalled();
  });

  it('passes a satisfiable range straight to the driver and reports what it served', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: new Uint8Array(100).map((_, i) => i),
      mimeType: 'video/mp4',
      kind: 'video',
    });
    const spy = vi.spyOn(disk.storage, 'get');
    await get(asset.id, { headers: { ...owner.session.headers, range: 'bytes=-10' } });
    expect(spy).toHaveBeenCalledWith(asset.storageKey, { start: 90, end: 99 });
    spy.mockClear();
    await get(asset.id, { headers: owner.session.headers });
    expect(spy).toHaveBeenCalledWith(asset.storageKey, undefined);
  });
});

describe('releasing the file when the client goes away', () => {
  /** A driver whose body is an endless stream that records whether it was cancelled. */
  function endlessStorage(base: StorageDriver) {
    const state = { cancelled: false, pulls: 0 };
    const driver: StorageDriver = {
      ...base,
      get: async () => ({
        size: 1_000_000,
        mimeType: 'image/png',
        stream: new ReadableStream<Uint8Array>({
          pull(controller) {
            state.pulls += 1;
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            state.cancelled = true;
          },
        }),
      }),
    };
    return { driver, state };
  }

  async function setup() {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const { driver, state } = endlessStorage(disk.storage);
    setStorageOverride(driver);
    return { owner, asset, state };
  }

  const request = (assetId: string, headers: Record<string, string>, signal: AbortSignal) =>
    GET(new Request(`http://localhost:3000/api/v1/media/${assetId}`, { headers, signal }), {
      params: Promise.resolve({ assetId }),
    });

  it('cancels the stored stream when the request aborts before anybody reads the body', async () => {
    const { owner, asset, state } = await setup();
    const controller = new AbortController();
    const response = await request(asset.id, owner.session.headers, controller.signal);
    expect(response.status).toBe(200);
    expect(state.cancelled).toBe(false);
    controller.abort();
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
  });

  it('cancels it right away when the request was already aborted', async () => {
    const { owner, asset, state } = await setup();
    const controller = new AbortController();
    controller.abort();
    await request(asset.id, owner.session.headers, controller.signal);
    await vi.waitFor(() => expect(state.cancelled).toBe(true));
  });

  it('cancels it when the consumer stops reading half way', async () => {
    const { owner, asset, state } = await setup();
    const response = await request(asset.id, owner.session.headers, new AbortController().signal);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    expect((await reader.read()).value?.byteLength).toBe(1024);
    await reader.cancel();
    expect(state.cancelled).toBe(true);
  });

  it('stops reading from storage while nobody is consuming (no read-ahead)', async () => {
    const { owner, asset, state } = await setup();
    await request(asset.id, owner.session.headers, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(state.pulls).toBeLessThanOrEqual(1);
  });

  it('does not cancel a body that is read to the end', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const controller = new AbortController();
    const response = await request(asset.id, owner.session.headers, controller.signal);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(TINY_PNG);
    controller.abort();
  });
});

describe('rate limiting', () => {
  function recordingLimiter(allowed = true) {
    const hits: Array<{ key: string; limit: number; windowSec: number }> = [];
    const limiter: RateLimiter = {
      hit(key, limit, windowSec) {
        hits.push({ key, limit, windowSec });
        return { allowed, remaining: 5, resetAt: Date.now() + 30_000 };
      },
    };
    return { limiter, hits };
  }

  it('uses a high, dedicated budget keyed by user when signed in and by IP otherwise', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: TINY_PNG,
      generation: { isPublic: true },
    });
    const { limiter, hits } = recordingLimiter();
    setRateLimiter(limiter);
    const signedIn = await get(asset.id, { headers: owner.session.headers });
    const anonymous = await get(asset.id);
    expect(hits[0]).toEqual({ key: `media:user:${owner.user.id}`, limit: 1200, windowSec: 60 });
    expect(hits[1]?.key).toMatch(/^media:ip:/);
    expect(signedIn.headers.get('x-ratelimit-limit')).toBe('1200');
    expect(anonymous.headers.get('x-ratelimit-limit')).toBe('1200');
  });

  it('shares nothing with the general bucket', async () => {
    const { limiter, hits } = recordingLimiter();
    setRateLimiter(limiter);
    await get('ast_00000000000000000000000000');
    expect(hits.every((hit) => hit.key.startsWith('media:'))).toBe(true);
  });

  it('answers 429 with Retry-After once the budget is spent, before touching storage', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    setRateLimiter(recordingLimiter(false).limiter);
    const spy = vi.spyOn(disk.storage, 'get');
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.status).toBe(429);
    expect(result.headers.get('retry-after')).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
  });

  it('really allows a gallery-sized burst', async () => {
    const { owner } = twoUsers();
    const asset = await storeAsset(disk.storage, { userId: owner.user.id, bytes: TINY_PNG });
    const results = await Promise.all(
      Array.from({ length: 150 }, () => get(asset.id, { headers: owner.session.headers })),
    );
    expect(results.every((result) => result.status === 200)).toBe(true);
  });
});

describe('real images end to end', () => {
  it('serves a JPEG with the right type and an unchanged body', async () => {
    const { owner } = twoUsers();
    const jpeg = await makeJpeg(64, 48);
    const asset = await storeAsset(disk.storage, {
      userId: owner.user.id,
      bytes: jpeg,
      mimeType: 'image/jpeg',
      extension: 'jpg',
    });
    const result = await get(asset.id, { headers: owner.session.headers });
    expect(result.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(result.bytes).equals(Buffer.from(jpeg))).toBe(true);
  });
});
