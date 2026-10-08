import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { createLocalStorage } from '@/server/storage/local';
import type { StorageDriver } from '@/server/storage/types';
import { persistOutput, type PersistOutputInput } from '@/server/uploads';
import { TINY_GIF, TINY_PNG, fakeStorage, streamToBytes } from '../../helpers/fakes';
import {
  SVG,
  concat,
  fakeMp4,
  makeAnimatedGif,
  makeJpeg,
  makePng,
  makeWebp,
  pixelAt,
  utf8,
} from './support';

let sandbox: string;
let storage: StorageDriver;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aivore-persist-'));
  storage = createLocalStorage(sandbox);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const storedFiles = () =>
  readdirSync(sandbox, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const readBack = async (key: string) => streamToBytes((await storage.get(key)).stream);

function input(overrides: Partial<PersistOutputInput>): PersistOutputInput {
  return {
    userId: 'usr_owner',
    generationId: 'gen_one',
    index: 0,
    kind: 'image',
    bytes: TINY_PNG,
    mimeType: 'image/png',
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('expected persistOutput to reject');
}

describe('persistOutput: images', () => {
  it('stores the bytes untouched and returns what the asset row needs', async () => {
    const png = await makePng(60, 30);
    const result = await persistOutput(storage, input({ bytes: png, index: 2 }));

    expect(isValidId(result.assetId, 'ast')).toBe(true);
    expect(result).toEqual({
      assetId: result.assetId,
      index: 2,
      kind: 'image',
      storageKey: `u/usr_owner/gen_one/${result.assetId}.png`,
      thumbKey: `u/usr_owner/gen_one/${result.assetId}.thumb.webp`,
      mimeType: 'image/png',
      bytes: png.byteLength,
      width: 60,
      height: 30,
      sha256: sha256(png),
    });
    expect(Buffer.from(await readBack(result.storageKey)).equals(Buffer.from(png))).toBe(true);
    const thumb = await storage.get(result.thumbKey as string);
    expect(thumb.mimeType).toBe('image/webp');
    expect(await sharp(Buffer.from(await streamToBytes(thumb.stream))).metadata()).toMatchObject({
      format: 'webp',
      width: 60,
    });
  });

  it('does not insert any row: it only writes storage', async () => {
    await persistOutput(storage, input({}));
    expect(storedFiles()).toHaveLength(2);
  });

  it('trusts the bytes over the claimed type', async () => {
    const jpeg = await makeJpeg(20, 10);
    const result = await persistOutput(storage, input({ bytes: jpeg, mimeType: 'image/png' }));
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.storageKey.endsWith('.jpg')).toBe(true);
    expect((await storage.head(result.storageKey))?.mimeType).toBe('image/jpeg');
  });

  it('reports displayed dimensions for a rotated JPEG', async () => {
    const result = await persistOutput(
      storage,
      input({ bytes: await makeJpeg(40, 20, { orientation: 6 }), mimeType: 'image/jpeg' }),
    );
    expect(result).toMatchObject({ width: 20, height: 40 });
  });

  it('accepts WebP and ignores a wrong or missing mime type', async () => {
    const result = await persistOutput(
      storage,
      input({ bytes: await makeWebp(), mimeType: 'application/octet-stream' }),
    );
    expect(result.mimeType).toBe('image/webp');
  });

  it('collects a streamed image and treats it like bytes', async () => {
    const png = await makePng(10, 10);
    const result = await persistOutput(
      storage,
      input({ bytes: Readable.from([png.slice(0, 20), png.slice(20)]) }),
    );
    expect(result).toMatchObject({ mimeType: 'image/png', width: 10, sha256: sha256(png) });
  });

  it('gives each output its own asset id and key', async () => {
    const a = await persistOutput(storage, input({}));
    const b = await persistOutput(storage, input({}));
    expect(a.assetId).not.toBe(b.assetId);
    expect(a.storageKey).not.toBe(b.storageKey);
  });

  it.each([
    ['SVG (can carry scripts)', SVG],
    ['HTML', utf8('<html><body>Forbidden</body></html>')],
    ['a JSON error body', utf8('{"error":"quota"}')],
    ['a truncated PNG', TINY_PNG.slice(0, 30)],
    ['an empty body', new Uint8Array(0)],
  ])('refuses %s and stores nothing', async (_name, bytes) => {
    const error = await rejection(persistOutput(storage, input({ bytes })));
    expect(error.code).toBe('bad_request');
    expect(storedFiles()).toEqual([]);
  });

  it('removes the main object when the thumbnail cannot be written', async () => {
    const failing: StorageDriver = {
      ...storage,
      put: async (key, body, opts) => {
        if (key.endsWith('.thumb.webp')) throw new Error('storage unavailable');
        return storage.put(key, body, opts);
      },
    };
    await expect(persistOutput(failing, input({}))).rejects.toThrow('storage unavailable');
    expect(storedFiles()).toEqual([]);
  });

  it('refuses ids that cannot be part of a storage key', async () => {
    for (const overrides of [
      { userId: '../other' },
      { generationId: 'gen/../x' },
      { userId: 'USR' },
      { generationId: '' },
    ]) {
      expect((await rejection(persistOutput(storage, input(overrides)))).code).toBe('bad_request');
    }
    expect(storedFiles()).toEqual([]);
  });

  it('works with the in-memory fake storage used by engine tests', async () => {
    const fake = fakeStorage();
    const result = await persistOutput(fake, input({}));
    expect([...fake.objects.keys()].sort()).toEqual([result.storageKey, result.thumbKey].sort());
  });
});

describe('persistOutput: videos', () => {
  it('stores a GIF "video" with its size, duration and a first-frame thumbnail', async () => {
    const gif = await makeAnimatedGif(3);
    const result = await persistOutput(
      storage,
      input({ kind: 'video', bytes: gif, mimeType: 'image/gif', durationMs: 3000 }),
    );
    expect(result).toMatchObject({
      kind: 'video',
      mimeType: 'image/gif',
      width: 12,
      height: 12,
      durationMs: 3000,
      sha256: sha256(gif),
    });
    expect(result.storageKey.endsWith('.gif')).toBe(true);
    const thumb = await readBack(result.thumbKey as string);
    const [red] = await pixelAt(thumb, 3, 3);
    expect(red).toBeGreaterThan(200);
  });

  it('stores the tiny Demo GIF', async () => {
    const result = await persistOutput(
      storage,
      input({ kind: 'video', bytes: TINY_GIF, mimeType: 'image/gif', durationMs: 1000 }),
    );
    expect(result).toMatchObject({ mimeType: 'image/gif', width: 1, height: 1, durationMs: 1000 });
    expect(result.thumbKey).toBeDefined();
  });

  it('stores an MP4 without a thumbnail unless the provider sent one', async () => {
    const mp4 = fakeMp4();
    const plain = await persistOutput(
      storage,
      input({
        kind: 'video',
        bytes: mp4,
        mimeType: 'video/mp4',
        width: 1280,
        height: 720,
        durationMs: 5000,
      }),
    );
    expect(plain).toEqual({
      assetId: plain.assetId,
      index: 0,
      kind: 'video',
      storageKey: `u/usr_owner/gen_one/${plain.assetId}.mp4`,
      mimeType: 'video/mp4',
      bytes: mp4.byteLength,
      width: 1280,
      height: 720,
      durationMs: 5000,
      sha256: sha256(mp4),
    });

    const withThumb = await persistOutput(
      storage,
      input({
        kind: 'video',
        bytes: mp4,
        mimeType: 'video/mp4',
        thumbBytes: await makeJpeg(640, 360),
      }),
    );
    expect(withThumb.thumbKey).toBe(`u/usr_owner/gen_one/${withThumb.assetId}.thumb.webp`);
    expect(
      await sharp(Buffer.from(await readBack(withThumb.thumbKey as string))).metadata(),
    ).toMatchObject({
      format: 'webp',
      width: 512,
      height: 288,
    });
  });

  it('keeps the video when the provider thumbnail is unusable', async () => {
    const result = await persistOutput(
      storage,
      input({
        kind: 'video',
        bytes: fakeMp4(),
        mimeType: 'video/mp4',
        thumbBytes: utf8('not an image'),
      }),
    );
    expect(result.thumbKey).toBeUndefined();
    expect(storedFiles()).toHaveLength(1);
  });

  it('recognises the container from the bytes and believes the claim only for video types', async () => {
    const detected = await persistOutput(
      storage,
      input({ kind: 'video', bytes: fakeMp4(), mimeType: 'application/octet-stream' }),
    );
    expect(detected.mimeType).toBe('video/mp4');
    const claimed = await persistOutput(
      storage,
      input({ kind: 'video', bytes: utf8('opaque container bytes'), mimeType: 'video/webm' }),
    );
    expect(claimed.mimeType).toBe('video/webm');
    const html = await rejection(
      persistOutput(
        storage,
        input({ kind: 'video', bytes: utf8('<html>login</html>'), mimeType: 'text/html' }),
      ),
    );
    expect(html.code).toBe('bad_request');
  });

  it('refuses an SVG that claims to be a video', async () => {
    const error = await rejection(
      persistOutput(storage, input({ kind: 'video', bytes: SVG, mimeType: 'image/svg+xml' })),
    );
    expect(error.code).toBe('bad_request');
    expect(storedFiles()).toEqual([]);
  });

  describe('streams', () => {
    const chunks = (data: Uint8Array, size: number) =>
      Array.from({ length: Math.ceil(data.length / size) }, (_, i) =>
        data.slice(i * size, (i + 1) * size),
      );

    it('writes a streamed video through with the right size and hash', async () => {
      const mp4 = fakeMp4('payload'.repeat(5000));
      const result = await persistOutput(
        storage,
        input({
          kind: 'video',
          bytes: Readable.from(chunks(mp4, 1000)),
          mimeType: 'video/mp4',
          width: 640,
          height: 360,
          durationMs: 4000,
        }),
      );
      expect(result).toMatchObject({
        mimeType: 'video/mp4',
        bytes: mp4.byteLength,
        sha256: sha256(mp4),
        width: 640,
        durationMs: 4000,
      });
      expect(Buffer.from(await readBack(result.storageKey)).equals(Buffer.from(mp4))).toBe(true);
    });

    it('recognises a video from the first bytes even when they arrive in tiny chunks', async () => {
      const mp4 = fakeMp4();
      const result = await persistOutput(
        storage,
        input({
          kind: 'video',
          bytes: Readable.from(chunks(mp4, 3)),
          mimeType: 'application/octet-stream',
        }),
      );
      expect(result.mimeType).toBe('video/mp4');
      expect(result.bytes).toBe(mp4.byteLength);
    });

    it('buffers a streamed GIF so it gets dimensions and a thumbnail', async () => {
      const result = await persistOutput(
        storage,
        input({ kind: 'video', bytes: Readable.from(chunks(TINY_GIF, 8)), mimeType: 'image/gif' }),
      );
      expect(result).toMatchObject({ mimeType: 'image/gif', width: 1 });
      expect(result.thumbKey).toBeDefined();
    });

    it('leaves nothing behind when the stream breaks half way', async () => {
      const mp4 = fakeMp4('payload'.repeat(5000));
      const broken = Readable.from(
        (async function* () {
          for (const part of chunks(mp4, 4000).slice(0, 3)) yield part;
          throw new Error('upstream closed the connection');
        })(),
      );
      await expect(
        persistOutput(storage, input({ kind: 'video', bytes: broken, mimeType: 'video/mp4' })),
      ).rejects.toThrow('upstream closed');
      expect(
        readdirSync(sandbox, { recursive: true }).filter((n) => String(n).includes('.tmp-')),
      ).toEqual([]);
      expect(storedFiles()).toEqual([]);
    });

    it('refuses an empty or unrecognisable stream and releases the source', async () => {
      const empty = await rejection(
        persistOutput(
          storage,
          input({ kind: 'video', bytes: Readable.from([]), mimeType: 'video/mp4' }),
        ),
      );
      expect(empty.code).toBe('bad_request');

      const source = Readable.from([utf8('<html>not a video</html>'), utf8('more')]);
      const html = await rejection(
        persistOutput(storage, input({ kind: 'video', bytes: source, mimeType: 'text/html' })),
      );
      expect(html.code).toBe('bad_request');
      expect(source.destroyed).toBe(true);
      expect(storedFiles()).toEqual([]);
    });
  });
});

it('does not police trailing bytes of provider outputs, only their type', async () => {
  // Provider outputs are stored as delivered (they are not user uploads); only the type is checked.
  const png = concat(await makePng(), utf8('trailer'));
  const result = await persistOutput(storage, input({ bytes: png }));
  expect(result.mimeType).toBe('image/png');
  expect(result.bytes).toBe(png.byteLength);
});
