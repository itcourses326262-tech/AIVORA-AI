import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { getDb } from '@/server/db';
import { assets } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { setStorageOverride } from '@/server/storage';
import { createLocalStorage } from '@/server/storage/local';
import type { StorageDriver } from '@/server/storage/types';
import { acceptUpload } from '@/server/uploads';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { streamToBytes } from '../../helpers/fakes';
import {
  SVG,
  concat,
  makeAnimatedWebp,
  makeBombPng,
  makeJpeg,
  makeNoisyPng,
  makePng,
  makeWebp,
  toFile,
  utf8,
} from './support';

const state = freshDb();
let sandbox: string;
let storage: StorageDriver;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'aivore-accept-'));
  storage = createLocalStorage(sandbox);
  setStorageOverride(storage);
});

afterEach(() => {
  setStorageOverride(null);
  rmSync(sandbox, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const storedFiles = () =>
  readdirSync(sandbox, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return error;
    throw error;
  }
  throw new Error('expected acceptUpload to reject');
}

describe('acceptUpload', () => {
  it('stores the normalized image and a thumbnail and creates an input asset row', async () => {
    const user = createUser(state.db);
    const asset = await acceptUpload(toFile(await makePng(40, 20)), user.id);

    expect(isValidId(asset.id, 'ast')).toBe(true);
    expect(asset).toMatchObject({
      userId: user.id,
      generationId: null,
      role: 'input',
      kind: 'image',
      index: 0,
      mimeType: 'image/png',
      width: 40,
      height: 20,
      durationMs: null,
    });
    expect(asset.storageKey).toBe(`u/${user.id}/uploads/${asset.id}.png`);
    expect(asset.thumbKey).toBe(`u/${user.id}/uploads/${asset.id}.thumb.webp`);
    expect(getDb().select().from(assets).all()).toEqual([asset]);

    const main = await storage.get(asset.storageKey);
    const bytes = await streamToBytes(main.stream);
    expect(main.mimeType).toBe('image/png');
    expect(bytes.byteLength).toBe(asset.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    const thumb = await storage.get(asset.thumbKey as string);
    expect(thumb.mimeType).toBe('image/webp');
    expect((await sharp(Buffer.from(await streamToBytes(thumb.stream))).metadata()).format).toBe(
      'webp',
    );
  });

  it('keeps the family: JPEG stays .jpg and WebP stays .webp', async () => {
    const user = createUser(state.db);
    const jpeg = await acceptUpload(toFile(await makeJpeg(), 'a.jpeg', 'image/jpeg'), user.id);
    const webp = await acceptUpload(toFile(await makeWebp(), 'a.webp', 'image/webp'), user.id);
    expect([jpeg.mimeType, jpeg.storageKey.slice(-4)]).toEqual(['image/jpeg', '.jpg']);
    expect([webp.mimeType, webp.storageKey.slice(-5)]).toEqual(['image/webp', '.webp']);
  });

  it('gives every upload its own unguessable key', async () => {
    const user = createUser(state.db);
    const file = toFile(await makePng());
    const first = await acceptUpload(file, user.id);
    const second = await acceptUpload(file, user.id);
    expect(first.id).not.toBe(second.id);
    expect(first.storageKey).not.toBe(second.storageKey);
    expect(first.storageKey).toMatch(/^u\/usr_[0-9a-z]{26}\/uploads\/ast_[0-9a-z]{26}\.png$/);
  });

  it('ignores the claimed type and file name: the bytes decide', async () => {
    const user = createUser(state.db);
    const asset = await acceptUpload(
      toFile(await makeJpeg(), '../../evil.svg', 'image/svg+xml'),
      user.id,
    );
    expect(asset.mimeType).toBe('image/jpeg');
    expect(asset.storageKey).toBe(`u/${user.id}/uploads/${asset.id}.jpg`);
    expect(storedFiles()).toEqual([`${asset.id}.jpg`, `${asset.id}.thumb.webp`].sort());
  });

  it('stores nothing of the original: EXIF is gone and orientation is baked in', async () => {
    const user = createUser(state.db);
    const asset = await acceptUpload(
      toFile(await makeJpeg(40, 20, { exif: true, orientation: 6 }), 'p.jpg', 'image/jpeg'),
      user.id,
    );
    expect(asset).toMatchObject({ width: 20, height: 40 });
    const bytes = Buffer.from(await streamToBytes((await storage.get(asset.storageKey)).stream));
    expect(bytes.includes('SECRET-')).toBe(false);
    expect((await sharp(bytes).metadata()).exif).toBeUndefined();
  });

  it('scales big images down to 4096 px', async () => {
    const user = createUser(state.db);
    const asset = await acceptUpload(toFile(await makePng(6000, 200)), user.id);
    expect(asset).toMatchObject({ width: 4096, height: 137 });
  });

  describe('refusals leave nothing behind', () => {
    const cases: Array<[string, () => Promise<File>, string]> = [
      ['an empty file', async () => toFile(new Uint8Array(0)), 'bad_request'],
      ['an SVG', async () => toFile(SVG, 'logo.svg', 'image/svg+xml'), 'unsupported_media_type'],
      [
        'an SVG disguised as a PNG',
        async () => toFile(SVG, 'logo.png', 'image/png'),
        'unsupported_media_type',
      ],
      [
        'HTML named .jpg',
        async () => toFile(utf8('<script>1</script>'), 'a.jpg', 'image/jpeg'),
        'unsupported_media_type',
      ],
      [
        'a polyglot (PNG + script)',
        async () => toFile(concat(await makePng(), utf8('<script>1</script>'))),
        'bad_request',
      ],
      [
        'a truncated JPEG',
        async () => toFile((await makeJpeg(64, 64)).slice(0, 200), 'a.jpg', 'image/jpeg'),
        'bad_request',
      ],
      [
        'an animated WebP',
        async () => toFile(await makeAnimatedWebp(), 'a.webp', 'image/webp'),
        'bad_request',
      ],
      ['a decompression bomb', async () => toFile(await makeBombPng(9000, 9000)), 'bad_request'],
    ];
    it.each(cases)('%s', async (_name, build, code) => {
      const user = createUser(state.db);
      const error = await rejection(acceptUpload(await build(), user.id));
      expect(error.code).toBe(code);
      expect(getDb().select().from(assets).all()).toEqual([]);
      expect(storedFiles()).toEqual([]);
    });
  });

  describe('size limit (MAX_UPLOAD_MB)', () => {
    beforeEach(() => {
      vi.stubEnv('MAX_UPLOAD_MB', '1');
      resetEnvForTests();
    });

    it('rejects a file over the limit before decoding anything', async () => {
      const user = createUser(state.db);
      const big = concat(await makePng(), new Uint8Array(1024 * 1024));
      const error = await rejection(acceptUpload(toFile(big), user.id));
      expect(error.code).toBe('payload_too_large');
      expect(error.status).toBe(413);
      expect(storedFiles()).toEqual([]);
    });

    it('accepts a file just under the limit', async () => {
      const user = createUser(state.db);
      const noisy = await makeNoisyPng(520);
      expect(noisy.length).toBeGreaterThan(700 * 1024);
      expect(noisy.length).toBeLessThan(1024 * 1024);
      const asset = await acceptUpload(toFile(noisy), user.id);
      expect(asset.width).toBe(520);
    });

    it('stops reading as soon as the limit is crossed, whatever size the file claims', async () => {
      const user = createUser(state.db);
      let pulled = 0;
      const liar = {
        size: 10,
        stream: () =>
          new ReadableStream<Uint8Array>({
            pull(controller) {
              pulled += 1;
              controller.enqueue(new Uint8Array(256 * 1024));
              if (pulled > 1000) controller.close();
            },
          }),
      } as unknown as File;
      const error = await rejection(acceptUpload(liar, user.id));
      expect(error.code).toBe('payload_too_large');
      // 1 MiB limit / 256 KiB chunks: it must stop after about five pulls, not read 250 MiB.
      expect(pulled).toBeLessThan(10);
    });
  });

  describe('failures while storing', () => {
    it('removes the main object when the thumbnail cannot be written', async () => {
      const user = createUser(state.db);
      setStorageOverride({
        ...storage,
        put: async (key, body, opts) => {
          if (key.endsWith('.thumb.webp')) throw new Error('disk full');
          return storage.put(key, body, opts);
        },
        delete: (key) => storage.delete(key),
        get: (key, range) => storage.get(key, range),
        head: (key) => storage.head(key),
      });
      await expect(acceptUpload(toFile(await makePng()), user.id)).rejects.toThrow('disk full');
      expect(storedFiles()).toEqual([]);
      expect(getDb().select().from(assets).all()).toEqual([]);
    });

    it('removes both objects when the database refuses the row', async () => {
      const error = await acceptUpload(toFile(await makePng()), 'usr_nonexistent').catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(Error);
      expect(storedFiles()).toEqual([]);
    });

    it('refuses user ids that cannot be part of a key, before storing anything', async () => {
      for (const userId of ['../x', 'a/b', 'USER', '']) {
        const error = await rejection(acceptUpload(toFile(await makePng()), userId));
        expect(error.code).toBe('bad_request');
      }
      expect(storedFiles()).toEqual([]);
    });
  });
});
