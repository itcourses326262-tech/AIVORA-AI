import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { isAppError } from '@/lib/errors';
import { parseEnv, type Env } from '@/server/env';
import {
  createGcsStorage,
  isMissingObject,
  normalizeBucketName,
  type GcsStorageOptions,
} from '@/server/storage/gcs';
import { RangeNotSatisfiableError } from '@/server/storage/types';
import { streamToBytes } from '../../helpers/fakes';
import { FAST, FakeApiError, fakeGcs, type FakeGcs } from './fake-gcs';

const KEY = 'u/usr_a/gen_1/ast_one.png';
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function envFor(bucket: string): Env {
  return parseEnv({
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'gcs',
    FIREBASE_STORAGE_BUCKET: bucket,
    FIREBASE_SERVICE_ACCOUNT_FILE: '/never-read.json',
  });
}

function setup(options: GcsStorageOptions = {}, fake: FakeGcs = fakeGcs()) {
  const driver = createGcsStorage(envFor(fake.bucketName), { client: fake, ...FAST, ...options });
  const calls = (op: string) => fake.calls.filter((call) => call.op === op);
  return { fake, driver, calls };
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the promise to reject');
}

describe('put', () => {
  it('uploads in one non-resumable request with the content type', async () => {
    const { driver, fake, calls } = setup();
    await driver.put(KEY, bytesOf('hello'), { mimeType: 'image/png' });
    expect(calls('write')).toHaveLength(1);
    expect(calls('write')[0]?.options).toEqual({ resumable: false, contentType: 'image/png' });
    expect(fake.objects.get(KEY)?.contentType).toBe('image/png');
  });

  it('streams a long upload through the sink one chunk at a time (no whole-file buffering)', async () => {
    const { driver, fake } = setup();
    let produced = 0;
    let maxAhead = 0;
    const chunks = 2000;
    const source = Readable.from(
      (async function* () {
        for (let i = 0; i < chunks; i += 1) {
          produced += 1;
          maxAhead = Math.max(maxAhead, produced - fake.chunksReceived);
          yield Buffer.alloc(1024, i & 0xff);
        }
      })(),
    );
    const result = await driver.put(KEY, source, { mimeType: 'video/mp4' });
    expect(result.bytes).toBe(chunks * 1024);
    expect(fake.objects.get(KEY)?.bytes.byteLength).toBe(chunks * 1024);
    // Stream buffers hold a few dozen chunks; the producer is never allowed to run ahead by more,
    // however long the upload is.
    expect(maxAhead).toBeLessThan(100);
  });

  describe('retries', () => {
    it('retries an upload of bytes after a transient failure and then succeeds', async () => {
      const { driver, fake, calls } = setup();
      fake.failNext('write', new FakeApiError(503, 'Service Unavailable'), 2);
      expect(await driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' })).toEqual({
        bytes: 3,
      });
      expect(calls('write')).toHaveLength(3);
      expect(textOf(fake.objects.get(KEY)?.bytes ?? new Uint8Array())).toBe('abc');
    });

    it.each([
      new FakeApiError(429, 'Too Many Requests'),
      new FakeApiError('503', 'Backend Error'),
      new FakeApiError('ECONNRESET', 'socket hang up'),
      new FakeApiError('FILE_NO_UPLOAD', 'checksum mismatch'),
    ])('treats %s as transient', async (error) => {
      const { driver, fake, calls } = setup();
      fake.failNext('write', error);
      await driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' });
      expect(calls('write')).toHaveLength(2);
    });

    it('gives up after three attempts and reports the last failure', async () => {
      const { driver, fake, calls } = setup();
      fake.failNext('write', new FakeApiError(500, 'Internal'), 10);
      expect(
        await rejection(driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' })),
      ).toMatchObject({ code: 500 });
      expect(calls('write')).toHaveLength(3);
      expect(fake.objects.has(KEY)).toBe(false);
    });

    it.each([403, 400, 401, 404])('does not retry a %i', async (status) => {
      const { driver, fake, calls } = setup();
      fake.failNext('write', new FakeApiError(status, 'nope'), 5);
      await rejection(driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' }));
      expect(calls('write')).toHaveLength(1);
    });

    it('does not retry a stream: it cannot be replayed', async () => {
      const { driver, fake, calls } = setup();
      fake.failNext('write', new FakeApiError(503, 'Service Unavailable'), 5);
      const source = Readable.from([bytesOf('abc')]);
      await rejection(driver.put(KEY, source, { mimeType: 'image/png' }));
      expect(calls('write')).toHaveLength(1);
      expect(source.destroyed).toBe(true);
    });
  });

  it('stops an upload that takes too long, and stores nothing', async () => {
    const { driver, fake } = setup({ uploadTimeoutMs: 30 });
    fake.writeDelayMs = 200;
    const error = await rejection(driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' }));
    expect((error as Error).message).toMatch(/upload took longer than/);
    expect(fake.objects.has(KEY)).toBe(false);
  });

  it('validates the key and mime type before talking to Google', async () => {
    const { driver, fake } = setup();
    for (const [key, mimeType] of [
      ['../x', 'image/png'],
      [KEY, 'image/png\r\nx-evil: 1'],
    ] as const) {
      const error = await rejection(driver.put(key, bytesOf('x'), { mimeType }));
      expect(isAppError(error) && error.code).toBe('bad_request');
    }
    expect(fake.calls).toHaveLength(0);
  });
});

describe('get', () => {
  it('measures the object, then reads exactly that generation', async () => {
    const { driver, fake, calls } = setup();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    const stored = fake.objects.get(KEY);
    const result = await driver.get(KEY);
    expect(textOf(await streamToBytes(result.stream))).toBe('0123456789');
    expect(calls('read').at(-1)?.options).toEqual({ generation: String(stored?.generation) });
  });

  it('requests start and end only for ranged reads, as inclusive absolute offsets', async () => {
    const { driver, calls } = setup();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    const lastRead = () => {
      const { generation: _generation, ...slice } = calls('read').at(-1)?.options as {
        generation?: string;
      };
      return slice;
    };
    await driver.get(KEY);
    expect(lastRead()).toEqual({});
    await driver.get(KEY, { start: 2, end: 5 });
    expect(lastRead()).toEqual({ start: 2, end: 5 });
    await driver.get(KEY, { start: -3 });
    expect(lastRead()).toEqual({ start: 7, end: 9 });
    await driver.get(KEY, { start: 4 });
    expect(lastRead()).toEqual({ start: 4, end: 9 });
    await driver.get(KEY, { start: 8, end: 900 });
    expect(lastRead()).toEqual({ start: 8, end: 9 });
  });

  it('answers an unsatisfiable range itself, without asking Google for the bytes', async () => {
    const { driver, calls } = setup();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    const error = await rejection(driver.get(KEY, { start: 10 }));
    expect(error).toBeInstanceOf(RangeNotSatisfiableError);
    expect(calls('read')).toHaveLength(0);
  });

  it('measures again when the object is replaced between the size and the read', async () => {
    const { driver, fake, calls } = setup();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    // The replacement lands after the size was measured but before the first byte is read.
    fake.afterMetadata = () =>
      fake.objects.set(KEY, { bytes: bytesOf('abc'), contentType: 'image/png', generation: 9999 });
    const result = await driver.get(KEY);
    // Never the old size with new bytes: the answer is the new object, consistently.
    expect(result.size).toBe(3);
    expect(textOf(await streamToBytes(result.stream))).toBe('abc');
    expect(calls('metadata')).toHaveLength(2);
  });

  it('gives up with not_found when the object keeps changing under it', async () => {
    const { driver, fake } = setup();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    let generation = 2000;
    const replace = () => {
      generation += 1;
      fake.objects.set(KEY, { bytes: bytesOf('abc'), contentType: 'image/png', generation });
      fake.afterMetadata = replace;
    };
    fake.afterMetadata = replace;
    const error = await rejection(driver.get(KEY));
    expect(isAppError(error) && error.code).toBe('not_found');
  });

  it('does not open a download for an empty object', async () => {
    const { driver, calls } = setup();
    await driver.put(KEY, new Uint8Array(0), { mimeType: 'image/png' });
    const result = await driver.get(KEY);
    expect(result.size).toBe(0);
    expect(calls('read')).toHaveLength(0);
  });

  it('falls back to application/octet-stream when Google reports no content type', async () => {
    const { driver, fake } = setup();
    fake.objects.set(KEY, { bytes: bytesOf('x'), contentType: undefined, generation: 5 });
    expect((await driver.get(KEY)).mimeType).toBe('application/octet-stream');
    expect(await driver.head(KEY)).toEqual({ size: 1, mimeType: 'application/octet-stream' });
  });

  it('refuses an answer without a usable size', async () => {
    const { driver } = setup(
      {},
      Object.assign(fakeGcs(), {
        bucket: () => ({
          file: () => ({
            getMetadata: async () => [{ size: 'not-a-number' }],
          }),
        }),
      }) as unknown as FakeGcs,
    );
    await expect(driver.head(KEY)).rejects.toThrow('usable size');
  });

  it('lets other failures through unchanged (for example missing permission)', async () => {
    const { driver, fake } = setup();
    await driver.put(KEY, bytesOf('x'), { mimeType: 'image/png' });
    fake.failNext('metadata', new FakeApiError(403, 'caller does not have storage.objects.get'));
    expect(await rejection(driver.get(KEY))).toMatchObject({ code: 403 });
    fake.failNext('metadata', new FakeApiError(403, 'denied'));
    expect(await rejection(driver.head(KEY))).toMatchObject({ code: 403 });
  });

  it('gives up on a metadata call that never answers', async () => {
    const { driver } = setup(
      { requestTimeoutMs: 20 },
      Object.assign(fakeGcs(), {
        bucket: () => ({
          file: () => ({ getMetadata: () => new Promise<never>(() => undefined) }),
        }),
      }) as unknown as FakeGcs,
    );
    expect((await rejection(driver.head(KEY))) as Error).toMatchObject({
      message: expect.stringContaining('took longer than'),
    });
  });
});

describe('a missing bucket is not a missing object', () => {
  it('surfaces the error from get, head, delete and put', async () => {
    const { driver, fake } = setup();
    fake.missingBucket = true;
    for (const operation of [
      () => driver.get(KEY),
      () => driver.head(KEY),
      () => driver.delete(KEY),
      () => driver.put(KEY, bytesOf('x'), { mimeType: 'image/png' }),
    ]) {
      const error = await rejection(operation());
      expect(isAppError(error)).toBe(false);
      expect(error).toMatchObject({ code: 404 });
    }
  });

  it('classifies 404s by their message', () => {
    expect(isMissingObject(new FakeApiError(404, 'No such object: b/bucket-x/k'))).toBe(true);
    expect(isMissingObject(new FakeApiError('404', 'Not Found'))).toBe(true);
    expect(isMissingObject(new FakeApiError(404, 'The specified bucket does not exist.'))).toBe(
      false,
    );
    expect(isMissingObject(new FakeApiError(403, 'No such object'))).toBe(false);
    expect(isMissingObject(new Error('boom'))).toBe(false);
    expect(isMissingObject(null)).toBe(false);
  });
});

describe('delete', () => {
  it('ignores a missing object, surfaces other failures', async () => {
    const { driver, fake } = setup();
    await expect(driver.delete(KEY)).resolves.toBeUndefined();
    fake.failNext('delete', new FakeApiError(403, 'denied'));
    expect(await rejection(driver.delete(KEY))).toMatchObject({ code: 403 });
  });
});

describe('no signed URLs', () => {
  it('has no signedUrl: media always streams through the app', () => {
    expect(setup().driver.signedUrl).toBeUndefined();
  });
});

describe('configuration', () => {
  it('uses the bucket from FIREBASE_STORAGE_BUCKET, tolerating gs:// and a trailing slash', async () => {
    const fake = fakeGcs('my-project.firebasestorage.app');
    const driver = createGcsStorage(envFor('gs://my-project.firebasestorage.app/'), {
      client: fake,
      ...FAST,
    });
    await driver.head(KEY);
    expect(fake.bucketsAsked).toEqual(['my-project.firebasestorage.app']);
  });

  it('normalizes and validates bucket names', () => {
    expect(normalizeBucketName('  GS://abc-def_1.x/  '.toLowerCase())).toBe('abc-def_1.x');
    for (const bad of [undefined, '', '   ', 'a', 'UPPER', 'has space', 'a/b', '-lead', 'trail-']) {
      expect(() => normalizeBucketName(bad)).toThrow('FIREBASE_STORAGE_BUCKET');
    }
  });

  it('refuses to start without a bucket', () => {
    // parseEnv already reports this; the driver is the second line of defence.
    const env = { ...envFor('my-project.firebasestorage.app'), FIREBASE_STORAGE_BUCKET: undefined };
    expect(() => createGcsStorage(env, { client: fakeGcs() })).toThrow('FIREBASE_STORAGE_BUCKET');
  });

  it('refuses to start without usable credentials when it has to build its own client', () => {
    expect(() => createGcsStorage(envFor('my-project.firebasestorage.app'))).toThrow(
      'FIREBASE_SERVICE_ACCOUNT_FILE',
    );
  });
});
