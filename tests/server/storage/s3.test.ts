import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { isAppError } from '@/lib/errors';
import { parseEnv, type Env } from '@/server/env';
import { createS3Storage } from '@/server/storage/s3';
import { RangeNotSatisfiableError } from '@/server/storage/types';
import { streamToBytes } from '../../helpers/fakes';

const baseEnv = {
  NODE_ENV: 'test',
  STORAGE_DRIVER: 's3',
  S3_BUCKET: 'aivore-media',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_ENDPOINT: 'http://minio.test:9000',
  S3_REGION: 'us-east-1',
  S3_FORCE_PATH_STYLE: 'true',
};
const env: Env = parseEnv(baseEnv);

type Reply = (command: unknown) => unknown;

/** A real client (so presigning works offline) whose `send` never reaches the network. */
function setup(reply: Reply = () => ({}), partBytes?: number) {
  const client = new S3Client({
    region: 'us-east-1',
    endpoint: 'http://minio.test:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key' },
  });
  const send = vi.spyOn(client, 'send') as unknown as MockInstance<(command: unknown) => unknown>;
  send.mockImplementation(async (command) => reply(command));
  const driver = createS3Storage(env, { client, ...(partBytes ? { partBytes } : {}) });
  const commands = () => send.mock.calls.map((call) => call[0]);
  return { driver, send, commands };
}

const KEY = 'u/usr_a/gen_1/ast_one.png';
const bytesOf = (text: string) => new TextEncoder().encode(text);
const textOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

class FakeS3Error extends Error {
  readonly $metadata: { httpStatusCode: number };
  constructor(name: string, status: number) {
    super(name);
    this.name = name;
    this.$metadata = { httpStatusCode: status };
  }
}

function objectReply(data: string, extra: Record<string, unknown> = {}) {
  return {
    Body: { transformToWebStream: () => new Blob([bytesOf(data)]).stream() },
    ContentLength: data.length,
    ContentType: 'image/png',
    ...extra,
  };
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
  it('sends one PutObject for a Uint8Array', async () => {
    const { driver, commands } = setup();
    const body = bytesOf('hello');
    expect(await driver.put(KEY, body, { mimeType: 'image/png' })).toEqual({ bytes: 5 });
    const [command] = commands();
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
      Body: body,
      ContentType: 'image/png',
    });
  });

  it('sends a short stream as a single PutObject', async () => {
    const { driver, commands } = setup(undefined, 16);
    const result = await driver.put(KEY, Readable.from([bytesOf('abc'), bytesOf('def')]), {
      mimeType: 'video/mp4',
    });
    expect(result.bytes).toBe(6);
    expect(commands()).toHaveLength(1);
    const input = (commands()[0] as PutObjectCommand).input;
    expect(input).toMatchObject({ Bucket: 'aivore-media', Key: KEY, ContentType: 'video/mp4' });
    expect(textOf(input.Body as Uint8Array)).toBe('abcdef');
  });

  it('sends an empty stream as an empty PutObject', async () => {
    const { driver, commands } = setup();
    expect(await driver.put(KEY, Readable.from([]), { mimeType: 'image/png' })).toEqual({
      bytes: 0,
    });
    expect((commands()[0] as PutObjectCommand).input.Body).toHaveLength(0);
  });

  it('uploads a long stream as an ordered multipart upload and completes it', async () => {
    const { driver, commands } = setup((command) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'upload-1' };
      if (command instanceof UploadPartCommand) {
        return { ETag: `"etag-${command.input.PartNumber}"` };
      }
      return {};
    }, 10);
    const chunks = ['aaaaaa', 'bbbbbb', 'cccccc', 'dddddd', 'ee'].map(bytesOf);
    const result = await driver.put(KEY, Readable.from(chunks), { mimeType: 'video/mp4' });
    expect(result.bytes).toBe(26);

    const sent = commands();
    expect(sent[0]).toBeInstanceOf(CreateMultipartUploadCommand);
    expect((sent[0] as CreateMultipartUploadCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
      ContentType: 'video/mp4',
    });
    const parts = sent.filter(
      (command): command is UploadPartCommand => command instanceof UploadPartCommand,
    );
    expect(parts.map((part) => part.input.PartNumber)).toEqual([1, 2, 3]);
    expect(parts.every((part) => part.input.UploadId === 'upload-1')).toBe(true);
    expect(parts.map((part) => textOf(part.input.Body as Uint8Array)).join('')).toBe(
      'aaaaaabbbbbbccccccddddddee',
    );
    const complete = sent.at(-1);
    expect(complete).toBeInstanceOf(CompleteMultipartUploadCommand);
    expect((complete as CompleteMultipartUploadCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
      UploadId: 'upload-1',
      MultipartUpload: {
        Parts: [
          { ETag: '"etag-1"', PartNumber: 1 },
          { ETag: '"etag-2"', PartNumber: 2 },
          { ETag: '"etag-3"', PartNumber: 3 },
        ],
      },
    });
    expect(sent.some((command) => command instanceof AbortMultipartUploadCommand)).toBe(false);
  });

  it('aborts the multipart upload when a part fails', async () => {
    const { driver, commands } = setup((command) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'upload-9' };
      if (command instanceof UploadPartCommand) {
        if (command.input.PartNumber === 2) throw new FakeS3Error('InternalError', 500);
        return { ETag: '"e"' };
      }
      return {};
    }, 4);
    const stream = Readable.from(['aaaa', 'bbbb', 'cccc'].map(bytesOf));
    expect(await rejection(driver.put(KEY, stream, { mimeType: 'video/mp4' }))).toMatchObject({
      name: 'InternalError',
    });
    const abort = commands().at(-1);
    expect(abort).toBeInstanceOf(AbortMultipartUploadCommand);
    expect((abort as AbortMultipartUploadCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
      UploadId: 'upload-9',
    });
    expect(commands().some((c) => c instanceof CompleteMultipartUploadCommand)).toBe(false);
  });

  it('aborts when the source stream fails after the upload started, and reports the source error', async () => {
    const { driver, commands } = setup(
      (command) =>
        command instanceof CreateMultipartUploadCommand
          ? { UploadId: 'upload-3' }
          : { ETag: '"e"' },
      4,
    );
    const source = Readable.from(
      (async function* () {
        yield bytesOf('aaaa');
        throw new Error('download dropped');
      })(),
    );
    await expect(driver.put(KEY, source, { mimeType: 'video/mp4' })).rejects.toThrow(
      'download dropped',
    );
    expect(commands().at(-1)).toBeInstanceOf(AbortMultipartUploadCommand);
  });

  it('still reports the original failure when the abort itself fails', async () => {
    const { driver } = setup((command) => {
      if (command instanceof CreateMultipartUploadCommand) return { UploadId: 'u' };
      if (command instanceof UploadPartCommand) throw new FakeS3Error('SlowDown', 503);
      if (command instanceof AbortMultipartUploadCommand) throw new FakeS3Error('Gone', 500);
      return {};
    }, 2);
    expect(
      await rejection(driver.put(KEY, Readable.from([bytesOf('abcd')]), { mimeType: 'video/mp4' })),
    ).toMatchObject({ name: 'SlowDown' });
  });

  it('fails when S3 does not return an upload id', async () => {
    const { driver } = setup(() => ({}), 2);
    await expect(
      driver.put(KEY, Readable.from([bytesOf('abcd')]), { mimeType: 'video/mp4' }),
    ).rejects.toThrow('multipart upload id');
  });
});

describe('get', () => {
  it('requests the whole object without a Range and reports its size and type', async () => {
    const { driver, commands } = setup(() => objectReply('0123456789'));
    const result = await driver.get(KEY);
    expect(result).toMatchObject({ size: 10, mimeType: 'image/png' });
    expect(result.range).toBeUndefined();
    expect(textOf(await streamToBytes(result.stream))).toBe('0123456789');
    expect((commands()[0] as GetObjectCommand).input).toEqual({ Bucket: 'aivore-media', Key: KEY });
  });

  it('wraps a Node readable body too', async () => {
    const { driver } = setup(() => ({
      Body: Readable.from([bytesOf('node-body')]),
      ContentLength: 9,
    }));
    const result = await driver.get(KEY);
    expect(result.mimeType).toBe('application/octet-stream');
    expect(textOf(await streamToBytes(result.stream))).toBe('node-body');
  });

  it.each([
    [{ start: 0, end: 0 }, 'bytes=0-0'],
    [{ start: 2, end: 5 }, 'bytes=2-5'],
    [{ start: 4 }, 'bytes=4-'],
    [{ start: -3 }, 'bytes=-3'],
  ])('sends %j as %s and returns the range S3 served', async (requested, header) => {
    const { driver, commands } = setup(() =>
      objectReply('2345', { ContentLength: 4, ContentRange: 'bytes 2-5/10' }),
    );
    const result = await driver.get(KEY, requested);
    expect((commands()[0] as GetObjectCommand).input.Range).toBe(header);
    expect(result.size).toBe(10);
    expect(result.range).toEqual({ start: 2, end: 5 });
    expect(textOf(await streamToBytes(result.stream))).toBe('2345');
  });

  it('turns S3 InvalidRange into the 416 error with the real object size', async () => {
    const { driver } = setup((command) => {
      if (command instanceof GetObjectCommand) throw new FakeS3Error('InvalidRange', 416);
      return { ContentLength: 10, ContentType: 'image/png' };
    });
    const error = await rejection(driver.get(KEY, { start: 50 }));
    expect(error).toBeInstanceOf(RangeNotSatisfiableError);
    expect((error as RangeNotSatisfiableError).size).toBe(10);
    expect((error as RangeNotSatisfiableError).status).toBe(416);
  });

  it('refuses malformed ranges without sending a ranged GET', async () => {
    const { driver, commands } = setup(() => ({ ContentLength: 10 }));
    for (const range of [
      { start: 5, end: 2 },
      { start: -3, end: 5 },
      { start: -0 },
      { start: 1.5 },
      { start: Number.NaN },
    ]) {
      const error = await rejection(driver.get(KEY, range));
      expect(error).toBeInstanceOf(RangeNotSatisfiableError);
      expect((error as RangeNotSatisfiableError).size).toBe(10);
    }
    expect(commands().every((command) => command instanceof HeadObjectCommand)).toBe(true);
  });

  it('refuses an endpoint that ignores Range instead of returning the wrong bytes', async () => {
    const { driver } = setup(() => objectReply('0123456789'));
    await expect(driver.get(KEY, { start: 2, end: 3 })).rejects.toThrow('ignored the Range');
  });

  it('maps a missing object to not_found', async () => {
    for (const error of [new FakeS3Error('NoSuchKey', 404), new FakeS3Error('NotFound', 404)]) {
      const { driver } = setup(() => {
        throw error;
      });
      const thrown = await rejection(driver.get(KEY));
      expect(isAppError(thrown) && thrown.code).toBe('not_found');
    }
  });

  it('lets other S3 failures through', async () => {
    const { driver } = setup(() => {
      throw new FakeS3Error('AccessDenied', 403);
    });
    expect(await rejection(driver.get(KEY))).toMatchObject({ name: 'AccessDenied' });
  });
});

describe('head and delete', () => {
  it('HEADs the object and reports size and type', async () => {
    const { driver, commands } = setup(() => ({ ContentLength: 42, ContentType: 'video/mp4' }));
    expect(await driver.head(KEY)).toEqual({ size: 42, mimeType: 'video/mp4' });
    expect(commands()[0]).toBeInstanceOf(HeadObjectCommand);
    expect((commands()[0] as HeadObjectCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
    });
  });

  it('returns null for a missing object and rethrows real failures', async () => {
    const missing = setup(() => {
      throw new FakeS3Error('NotFound', 404);
    });
    expect(await missing.driver.head(KEY)).toBeNull();
    const broken = setup(() => {
      throw new FakeS3Error('InternalError', 500);
    });
    await expect(broken.driver.head(KEY)).rejects.toMatchObject({ name: 'InternalError' });
  });

  it('DELETEs the key, tolerates a missing object and surfaces other failures', async () => {
    const ok = setup();
    await ok.driver.delete(KEY);
    expect((ok.commands()[0] as DeleteObjectCommand).input).toEqual({
      Bucket: 'aivore-media',
      Key: KEY,
    });
    const missing = setup(() => {
      throw new FakeS3Error('NoSuchKey', 404);
    });
    await expect(missing.driver.delete(KEY)).resolves.toBeUndefined();
    const denied = setup(() => {
      throw new FakeS3Error('AccessDenied', 403);
    });
    await expect(denied.driver.delete(KEY)).rejects.toMatchObject({ name: 'AccessDenied' });
  });
});

describe('signedUrl', () => {
  it('presigns a GET for the key without any network call', async () => {
    const { driver, send } = setup();
    const url = new URL((await driver.signedUrl?.(KEY, 600)) as string);
    expect(url.origin).toBe('http://minio.test:9000');
    expect(url.pathname).toBe(`/aivore-media/${KEY}`);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get('X-Amz-Credential')).toContain('test-access-key/');
    expect(url.toString()).not.toContain('test-secret-key');
    expect(send).not.toHaveBeenCalled();
  });

  it('caps the lifetime at seven days and rejects nonsense', async () => {
    const { driver } = setup();
    const capped = new URL((await driver.signedUrl?.(KEY, 10 ** 9)) as string);
    expect(capped.searchParams.get('X-Amz-Expires')).toBe(String(7 * 24 * 60 * 60));
    for (const ttl of [0, -5, Number.NaN]) {
      expect(await rejection(driver.signedUrl?.(KEY, ttl) as Promise<unknown>)).toMatchObject({
        code: 'bad_request',
      });
    }
  });
});

describe('keys', () => {
  it('never lets an invalid key reach S3', async () => {
    const { driver, send } = setup();
    for (const key of ['../x', '/x', 'a//b', 'A/b', 'a\\b', 'a/.hidden', '']) {
      for (const operation of [
        () => driver.put(key, bytesOf('x'), { mimeType: 'image/png' }),
        () => driver.get(key),
        () => driver.head(key),
        () => driver.delete(key),
        () => driver.signedUrl?.(key, 60) as Promise<unknown>,
      ]) {
        expect(await rejection(operation())).toMatchObject({ code: 'bad_request' });
      }
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe('client configuration', () => {
  async function configOf(source: Record<string, string>) {
    const sentFrom: S3Client[] = [];
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async function (this: S3Client) {
      sentFrom.push(this);
      return { ContentLength: 1 } as never;
    });
    await createS3Storage(parseEnv({ ...baseEnv, ...source })).head(KEY);
    const client = sentFrom[0] as S3Client;
    return {
      region: await client.config.region(),
      forcePathStyle: client.config.forcePathStyle,
      endpoint: (await client.config.endpoint?.())?.hostname,
      credentials: await client.config.credentials(),
    };
  }

  it('builds the client from the S3_* variables', async () => {
    const config = await configOf({});
    expect(config.region).toBe('us-east-1');
    expect(config.forcePathStyle).toBe(true);
    expect(config.endpoint).toBe('minio.test');
    expect(config.credentials).toMatchObject({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    });
  });

  it('defaults to virtual-hosted style and the configured region without a path-style flag', async () => {
    const config = await configOf({ S3_FORCE_PATH_STYLE: 'false', S3_REGION: 'auto' });
    expect(config.forcePathStyle).toBe(false);
    expect(config.region).toBe('auto');
  });

  it('refuses to start without a bucket or credentials', () => {
    const incomplete = { ...env, S3_BUCKET: undefined } as Env;
    expect(() => createS3Storage(incomplete)).toThrow('S3_BUCKET');
    const keyless = { ...env, S3_ACCESS_KEY_ID: undefined } as Env;
    expect(() => createS3Storage(keyless)).toThrow('S3_ACCESS_KEY_ID');
  });
});
