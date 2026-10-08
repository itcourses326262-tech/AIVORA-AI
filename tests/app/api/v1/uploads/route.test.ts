import { readdirSync } from 'node:fs';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetDTO } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { getDb } from '@/server/db';
import { assets } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { InMemoryRateLimiter, setRateLimiter } from '@/server/security/rate-limit';
import { freshDb } from '../../../../helpers/db';
import { createUserWithSession } from '../../../../helpers/factories';
import { invokeRoute } from '../../../../helpers/http';
import {
  SVG,
  concat,
  makeAnimatedWebp,
  makeBombPng,
  makeJpeg,
  makeNoisyPng,
  makePng,
  toFile,
  utf8,
} from '../../../../server/uploads/support';
import { authenticateFromDb, createApiKeyFor, withTempStorage } from '../media/support';

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), assertSameOrigin: vi.fn() }));
vi.mock('@/server/auth', () => ({ authenticate: mocks.authenticate }));
vi.mock('@/server/security/origin', () => ({ assertSameOrigin: mocks.assertSameOrigin }));

import { GET } from '@/app/api/v1/media/[assetId]/route';
import { POST } from '@/app/api/v1/uploads/route';

const state = freshDb();
const disk = withTempStorage();

beforeEach(() => {
  setRateLimiter(new InMemoryRateLimiter());
  mocks.authenticate.mockReset().mockImplementation(authenticateFromDb);
  mocks.assertSameOrigin.mockReset();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const form = (file: File | string | undefined, field = 'file') => {
  const data = new FormData();
  if (file !== undefined) data.append(field, file);
  return data;
};

const upload = (body: FormData | string | Uint8Array, headers: Record<string, string>) =>
  invokeRoute<{ data?: AssetDTO; error?: { code: string; message: string; details?: unknown } }>(
    POST,
    { url: '/api/v1/uploads', body, headers },
  );

const storedObjects = () =>
  readdirSync(disk.directory, { recursive: true, withFileTypes: true }).filter(
    (entry) => entry.isFile() && !entry.name.startsWith('.'),
  );

const assetRows = () => getDb().select().from(assets).all();

describe('POST /api/v1/uploads', () => {
  it('stores the image and returns an AssetDTO that points at the media route', async () => {
    const { user, session } = createUserWithSession(state.db);
    const png = await makePng(80, 40);
    const result = await upload(form(toFile(png)), session.headers);

    expect(result.status).toBe(201);
    const asset = result.json.data as AssetDTO;
    expect(asset).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      width: 80,
      height: 40,
      url: `/api/v1/media/${asset.id}`,
      thumbUrl: `/api/v1/media/${asset.id}?variant=thumb`,
    });
    expect(asset.id).toMatch(/^ast_[0-9a-z]{26}$/);
    expect(asset.bytes).toBeGreaterThan(0);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.headers.get('x-ratelimit-limit')).toBe('20');
    expect(assetRows()).toMatchObject([{ id: asset.id, userId: user.id, role: 'input' }]);
    expect(storedObjects()).toHaveLength(2);
  });

  it('returns nothing that reveals storage keys or the owner', async () => {
    const { session } = createUserWithSession(state.db);
    const result = await upload(form(toFile(await makePng())), session.headers);
    expect(result.text).not.toMatch(/storageKey|thumbKey|\bu\/usr_|userId|sha256/);
  });

  it('round-trips through the media route: the owner can fetch it, nobody else can', async () => {
    const owner = createUserWithSession(state.db);
    const stranger = createUserWithSession(state.db);
    const result = await upload(
      form(toFile(await makeJpeg(60, 30), 'p.jpg', 'image/jpeg')),
      owner.session.headers,
    );
    const asset = result.json.data as AssetDTO;

    const fetchAs = (headers: Record<string, string>, query = '') =>
      GET(new Request(`http://localhost:3000${asset.url}${query}`, { headers }), {
        params: Promise.resolve({ assetId: asset.id }),
      });
    const own = await fetchAs(owner.session.headers);
    expect(own.status).toBe(200);
    expect(own.headers.get('content-type')).toBe('image/jpeg');
    expect(await sharp(Buffer.from(await own.arrayBuffer())).metadata()).toMatchObject({
      width: 60,
    });
    const thumb = await fetchAs(owner.session.headers, '?variant=thumb');
    expect(thumb.headers.get('content-type')).toBe('image/webp');
    expect((await fetchAs(stranger.session.headers)).status).toBe(404);
    expect((await fetchAs({})).status).toBe(404);
  });

  it('works with an API key and does not need an Origin header for it', async () => {
    const { user } = createUserWithSession(state.db);
    const { headers } = createApiKeyFor(user.id);
    const result = await upload(form(toFile(await makePng())), headers);
    expect(result.status).toBe(201);
    expect(mocks.assertSameOrigin).not.toHaveBeenCalled();
  });

  describe('authentication and CSRF', () => {
    it.each([
      ['no credentials', {}],
      ['an unknown session', { cookie: 'aivore_session=forged' }],
      ['an unknown API key', { authorization: 'Bearer avk_nope_nope' }],
    ])('answers 401 with %s and stores nothing', async (_name, headers) => {
      const result = await upload(form(toFile(await makePng())), headers);
      expect(result.status).toBe(401);
      expect(result.json.error?.code).toBe('unauthorized');
      expect(assetRows()).toEqual([]);
      expect(storedObjects()).toEqual([]);
    });

    it('checks the origin of cookie-authenticated uploads and stores nothing when it fails', async () => {
      const { session } = createUserWithSession(state.db);
      mocks.assertSameOrigin.mockImplementation(() => {
        throw AppError.of('forbidden', 'Cross-site request blocked');
      });
      const result = await upload(form(toFile(await makePng())), session.headers);
      expect(result.status).toBe(403);
      expect(mocks.assertSameOrigin).toHaveBeenCalledOnce();
      expect(assetRows()).toEqual([]);
      expect(storedObjects()).toEqual([]);
    });
  });

  describe('malformed requests', () => {
    it('is 422 without a file field, with a text field, or with several files', async () => {
      const { session } = createUserWithSession(state.db);
      const png = toFile(await makePng());
      const two = form(png);
      two.append('file', toFile(await makePng()));
      for (const body of [form(undefined), form('just text'), form(png, 'image'), two]) {
        const result = await upload(body, session.headers);
        expect(result.status).toBe(422);
        expect(result.json.error?.code).toBe('validation_failed');
        expect(result.json.error?.details).toEqual({
          issues: [{ path: 'file', message: expect.any(String) }],
        });
      }
      expect(storedObjects()).toEqual([]);
    });

    it('is 415 for a JSON body and 400 for broken multipart', async () => {
      const { session } = createUserWithSession(state.db);
      const json = await upload('{"file":"x"}', {
        ...session.headers,
        'content-type': 'application/json',
      });
      expect(json.status).toBe(415);
      const broken = await upload('--nope\r\nnot multipart', {
        ...session.headers,
        'content-type': 'multipart/form-data; boundary=zzz',
      });
      expect(broken.status).toBe(400);
    });
  });

  describe('files that must be refused', () => {
    const cases: Array<[string, () => Promise<File>, number, string]> = [
      ['an SVG', async () => toFile(SVG, 'a.svg', 'image/svg+xml'), 415, 'unsupported_media_type'],
      [
        'an SVG named .png',
        async () => toFile(SVG, 'a.png', 'image/png'),
        415,
        'unsupported_media_type',
      ],
      [
        'a GIF',
        async () =>
          toFile(
            new Uint8Array([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 59]),
            'a.gif',
            'image/gif',
          ),
        415,
        'unsupported_media_type',
      ],
      [
        'HTML named .jpg',
        async () => toFile(utf8('<script>1</script>'), 'a.jpg', 'image/jpeg'),
        415,
        'unsupported_media_type',
      ],
      ['an empty file', async () => toFile(new Uint8Array(0)), 400, 'bad_request'],
      [
        'a polyglot',
        async () => toFile(concat(await makePng(), utf8('<script>1</script>'))),
        400,
        'bad_request',
      ],
      [
        'a truncated JPEG',
        async () => toFile((await makeJpeg(64, 64)).slice(0, 300), 'a.jpg', 'image/jpeg'),
        400,
        'bad_request',
      ],
      [
        'an animated WebP',
        async () => toFile(await makeAnimatedWebp(), 'a.webp', 'image/webp'),
        400,
        'bad_request',
      ],
      [
        'a decompression bomb',
        async () => toFile(await makeBombPng(9000, 9000)),
        400,
        'bad_request',
      ],
    ];
    it.each(cases)('%s', async (_name, build, status, code) => {
      const { session } = createUserWithSession(state.db);
      const result = await upload(form(await build()), session.headers);
      expect(result.status).toBe(status);
      expect(result.json.error?.code).toBe(code);
      expect(assetRows()).toEqual([]);
      expect(storedObjects()).toEqual([]);
    });
  });

  describe('size limit', () => {
    beforeEach(() => {
      vi.stubEnv('MAX_UPLOAD_MB', '1');
      resetEnvForTests();
    });

    const noise = (bytes: number) =>
      concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(bytes));

    it('is 413 for a file over MAX_UPLOAD_MB that fits the multipart allowance', async () => {
      const { session } = createUserWithSession(state.db);
      const result = await upload(form(toFile(noise(1.5 * 1024 * 1024))), session.headers);
      expect(result.status).toBe(413);
      expect(result.json.error?.code).toBe('payload_too_large');
      expect(storedObjects()).toEqual([]);
    });

    it('is 413 up front when Content-Length is over the cap, without reading the body', async () => {
      const { session } = createUserWithSession(state.db);
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(64 * 1024));
        },
      });
      const request = new Request('http://localhost:3000/api/v1/uploads', {
        method: 'POST',
        headers: {
          ...session.headers,
          'content-type': 'multipart/form-data; boundary=zzz',
          'content-length': String(50 * 1024 * 1024),
        },
        body,
        duplex: 'half',
      } as RequestInit);
      const response = await POST(request);
      expect(response.status).toBe(413);
      await body.cancel().catch(() => undefined);
      expect(pulled).toBeLessThan(3);
    });

    it('cuts off a chunked body with no Content-Length once it passes the cap', async () => {
      const { session } = createUserWithSession(state.db);
      const multipart = new Request('http://localhost:3000/', {
        method: 'POST',
        body: form(toFile(noise(6 * 1024 * 1024))),
      });
      const contentType = multipart.headers.get('content-type') as string;
      const whole = new Uint8Array(await multipart.arrayBuffer());
      let offset = 0;
      let pulled = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled += 1;
          controller.enqueue(whole.slice(offset, offset + 64 * 1024));
          offset += 64 * 1024;
          if (offset >= whole.length) controller.close();
        },
      });
      const request = new Request('http://localhost:3000/api/v1/uploads', {
        method: 'POST',
        headers: { ...session.headers, 'content-type': contentType },
        body,
        duplex: 'half',
      } as RequestInit);
      expect(request.headers.get('content-length')).toBeNull();
      const response = await POST(request);
      expect(response.status).toBe(413);
      // The cap is 2 MiB = 32 chunks of 64 KiB: it must not have drained the 6 MiB body.
      expect(pulled).toBeLessThan(60);
      expect(storedObjects()).toEqual([]);
    });

    it('re-reads the limit from the environment on each request', async () => {
      const { session } = createUserWithSession(state.db);
      const photo = await makeNoisyPng(700);
      expect(photo.length).toBeGreaterThan(1024 * 1024);
      const send = () => upload(form(toFile(photo)), session.headers);

      expect((await send()).status).toBe(413);
      vi.stubEnv('MAX_UPLOAD_MB', '3');
      resetEnvForTests();
      expect((await send()).status).toBe(201);
    });
  });

  describe('rate limit', () => {
    it('allows 20 uploads a minute per user and then answers 429 with Retry-After', async () => {
      const busy = createUserWithSession(state.db);
      const calm = createUserWithSession(state.db);
      const png = await makePng(4, 4);
      for (let attempt = 1; attempt <= 20; attempt += 1) {
        const result = await upload(form(toFile(png)), busy.session.headers);
        expect(result.status, `upload ${attempt}`).toBe(201);
      }
      const blocked = await upload(form(toFile(png)), busy.session.headers);
      expect(blocked.status).toBe(429);
      expect(blocked.json.error?.code).toBe('rate_limited');
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(blocked.headers.get('x-ratelimit-limit')).toBe('20');
      // Another user has their own budget, and the blocked upload stored nothing.
      expect((await upload(form(toFile(png)), calm.session.headers)).status).toBe(201);
      expect(assetRows()).toHaveLength(21);
    });

    it('counts failed uploads too, so rejections cannot be used to probe for free', async () => {
      const { session } = createUserWithSession(state.db);
      for (let attempt = 0; attempt < 20; attempt += 1) {
        expect((await upload(form(toFile(SVG, 'a.svg')), session.headers)).status).toBe(415);
      }
      expect((await upload(form(toFile(await makePng())), session.headers)).status).toBe(429);
    });
  });
});
