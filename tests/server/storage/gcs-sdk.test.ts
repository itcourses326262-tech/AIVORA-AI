import { Readable } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '@/server/env';
import { createGcsStorage } from '@/server/storage/gcs';
import { openMediaStream } from '@/server/storage/gcs-media';
import { RangeNotSatisfiableError } from '@/server/storage/types';
import { streamToBytes } from '../../helpers/fakes';
import { describeStorageContract } from './contract';
import { startFakeGcsServer, type FakeGcsServer } from './fake-gcs-server';
import { serviceAccountFixture } from './service-account';

// The REAL @google-cloud/storage SDK, talking to a stand-in for the JSON API on 127.0.0.1 (the SDK
// supports this through STORAGE_EMULATOR_HOST). Nothing leaves the machine. This is what proves the
// driver's assumptions about the SDK (error shapes, ranges, generations, upload verification).
let server: FakeGcsServer;

beforeAll(async () => {
  server = await startFakeGcsServer();
  vi.stubEnv('STORAGE_EMULATOR_HOST', server.host);
  vi.stubEnv('NO_PROXY', '127.0.0.1,localhost');
  vi.stubEnv('no_proxy', '127.0.0.1,localhost');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await server.close();
});
beforeEach(() => {
  server.reset();
  server.objects.clear();
  server.requests.length = 0;
  server.ranges.length = 0;
});

function realDriver(
  bucket = 'demo-project.firebasestorage.app',
  extra: { requestTimeoutMs?: number } = {},
) {
  return createGcsStorage(
    parseEnv({
      NODE_ENV: 'test',
      STORAGE_DRIVER: 'gcs',
      FIREBASE_STORAGE_BUCKET: bucket,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(serviceAccountFixture()),
    }),
    { retryDelayMs: 0, requestTimeoutMs: 10_000, uploadTimeoutMs: 20_000, ...extra },
  );
}

const KEY = 'u/usr_a/gen_1/ast_one.png';
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describeStorageContract('Google Cloud Storage (real SDK, local stand-in server)', async () => ({
  driver: realDriver(),
}));

describe('the real SDK', () => {
  it('uploads with one multipart request and the content type, verified by checksum', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('hello'), { mimeType: 'image/png' });
    expect(server.requests.filter((r) => r.startsWith('POST'))).toHaveLength(1);
    expect(server.requests.some((r) => r.includes('uploadType=multipart'))).toBe(true);
    expect(server.requests.some((r) => r.includes('uploadType=resumable'))).toBe(false);
    expect(server.objects.get(KEY)?.contentType).toBe('image/png');
  });

  it('sends the Range header the driver computed, for ranges and suffix ranges', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    for (const range of [
      { start: 2, end: 5 },
      { start: 4 },
      { start: -3 },
      { start: 8, end: 99 },
    ]) {
      await streamToBytes((await driver.get(KEY, range)).stream);
    }
    expect(server.ranges).toEqual(['bytes=2-5', 'bytes=4-9', 'bytes=7-9', 'bytes=8-9']);
  });

  it('does not ask for the bytes of a range it can already refuse', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    await expect(driver.get(KEY, { start: 50 })).rejects.toBeInstanceOf(RangeNotSatisfiableError);
    expect(server.ranges).toEqual([]);
  });

  it('pins the generation it measured', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    const generation = String(server.objects.get(KEY)?.generation);
    await streamToBytes((await driver.get(KEY)).stream);
    expect(
      server.requests.some(
        (r) => r.includes(`alt=media`) && r.includes(`generation=${generation}`),
      ),
    ).toBe(true);
  });

  it('retries a transient upload failure of bytes with the real SDK error shape', async () => {
    const driver = realDriver();
    server.failUploads(503, 2);
    await driver.put(KEY, bytesOf('abc'), { mimeType: 'image/png' });
    expect(textOf(server.objects.get(KEY)?.bytes ?? new Uint8Array())).toBe('abc');
    expect(server.requests.filter((r) => r.startsWith('POST'))).toHaveLength(3);
  });

  it('does not retry a 403 and surfaces it with its status', async () => {
    const driver = realDriver();
    server.failUploads(403, 5);
    const error = await driver
      .put(KEY, bytesOf('abc'), { mimeType: 'image/png' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 403 });
    expect(server.requests.filter((r) => r.startsWith('POST'))).toHaveLength(1);
  });

  it('tells a missing bucket from a missing object', async () => {
    const driver = realDriver('some-other-bucket');
    for (const operation of [
      () => driver.get(KEY),
      () => driver.head(KEY),
      () => driver.delete(KEY),
    ]) {
      const error = await operation().catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: 404,
        message: expect.stringMatching(/bucket does not exist/i),
      });
    }
  });
});

describe('media downloads', () => {
  it('retries a transient failure before the first byte, then serves the object', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    server.failDownloads(503, 2);
    const result = await driver.get(KEY);
    expect(textOf(await streamToBytes(result.stream))).toBe('0123456789');
    expect(server.requests.filter((r) => r.includes('alt=media'))).toHaveLength(3);
  });

  it('does not retry a 403 and reports Googles message with its status', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    server.failDownloads(403, 5);
    const error = await driver.get(KEY).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 403, message: 'Injected failure' });
    expect(server.requests.filter((r) => r.includes('alt=media'))).toHaveLength(1);
  });

  it('refuses a server that ignores the Range header instead of sending the wrong bytes', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    server.ignoreRange = true;
    await expect(driver.get(KEY, { start: 2, end: 3 })).rejects.toThrow('ignored the Range');
    // A whole-object read is fine.
    const whole = await driver.get(KEY);
    expect(textOf(await streamToBytes(whole.stream))).toBe('0123456789');
  });

  it('gives up on a server that never answers', async () => {
    const driver = realDriver('demo-project.firebasestorage.app', { requestTimeoutMs: 300 });
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    server.stallDownloads = true;
    const started = Date.now();
    await expect(driver.get(KEY)).rejects.toThrow(/took longer than/);
    expect(Date.now() - started).toBeLessThan(5_000);
  }, 20_000);

  it('maps a 416 from Google to the range error carrying the real size', async () => {
    const driver = realDriver();
    await driver.put(KEY, bytesOf('0123456789'), { mimeType: 'image/png' });
    const url = new URL(
      `${server.host}/storage/v1/b/${server.bucket}/o/${encodeURIComponent(KEY)}?alt=media`,
    );
    const error = await openMediaStream({
      url,
      headers: { range: 'bytes=20-30' },
      range: { start: 20, end: 30 },
      timeoutMs: 2_000,
      attempts: 1,
      retryDelayMs: 0,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RangeNotSatisfiableError);
    expect((error as RangeNotSatisfiableError).size).toBe(10);
  });

  describe('cancelling a download', () => {
    afterEach(() => {
      server.slowDownloads = undefined;
    });

    it('does not break other downloads that are in flight (the SDK stream would)', async () => {
      const driver = realDriver();
      const big = new Uint8Array(512 * 1024);
      for (let i = 0; i < big.length; i += 1) big[i] = i & 0xff;
      await driver.put('u/usr_a/a.mp4', big, { mimeType: 'video/mp4' });
      await driver.put('u/usr_a/b.mp4', big, { mimeType: 'video/mp4' });
      server.slowDownloads = { chunk: 32 * 1024, delayMs: 15 };

      const a = await driver.get('u/usr_a/a.mp4');
      const readerA = a.stream.getReader();
      const firstA = await readerA.read();
      expect(firstA.done).toBe(false);

      // A browser abandoning another video while A is still being sent.
      for (let i = 0; i < 3; i += 1) {
        const b = await driver.get('u/usr_a/b.mp4');
        const readerB = b.stream.getReader();
        await readerB.read();
        await readerB.cancel();
      }

      const chunks: Uint8Array[] = [firstA.value as Uint8Array];
      for (;;) {
        const { done, value } = await readerA.read();
        if (done) break;
        chunks.push(value);
      }
      expect(Buffer.concat(chunks).equals(Buffer.from(big))).toBe(true);
    }, 30_000);

    it('does not break an upload in flight either', async () => {
      const driver = realDriver();
      const big = new Uint8Array(256 * 1024).fill(9);
      await driver.put('u/usr_a/b.mp4', big, { mimeType: 'video/mp4' });
      server.slowDownloads = { chunk: 16 * 1024, delayMs: 10 };

      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const source = Readable.from(
        (async function* () {
          yield Buffer.alloc(1024, 1);
          await gate; // the upload stays open while downloads are cancelled
          yield Buffer.alloc(1024, 2);
        })(),
      );
      const upload = driver.put('u/usr_a/c.bin', source, { mimeType: 'application/octet-stream' });
      await new Promise((resolve) => setTimeout(resolve, 100));

      for (let i = 0; i < 3; i += 1) {
        const b = await driver.get('u/usr_a/b.mp4');
        const reader = b.stream.getReader();
        await reader.read();
        await reader.cancel();
      }
      release();
      expect(await upload).toEqual({ bytes: 2048 });
      expect(server.objects.get('u/usr_a/c.bin')?.bytes.byteLength).toBe(2048);
    }, 30_000);

    it('closes the connection of the cancelled download', async () => {
      const driver = realDriver();
      await driver.put(KEY, new Uint8Array(512 * 1024), { mimeType: 'video/mp4' });
      server.slowDownloads = { chunk: 16 * 1024, delayMs: 10 };
      const result = await driver.get(KEY);
      const reader = result.stream.getReader();
      await reader.read();
      expect(server.activeDownloads).toBe(1);
      await reader.cancel();
      await vi.waitFor(() => expect(server.activeDownloads).toBe(0), { timeout: 2_000 });
    });
  });
});
