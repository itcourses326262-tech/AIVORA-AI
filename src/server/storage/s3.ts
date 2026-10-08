// OWNER: storage
import 'server-only';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { AppError } from '@/lib/errors';
import type { Env } from '@/server/env';
import { assertStorageKey } from './keys';
import { RangeNotSatisfiableError, type StorageDriver, type StorageRange } from './types';

/** S3 needs at least 5 MiB per part except the last; larger parts mean fewer round trips. */
export const S3_PART_BYTES = 8 * 1024 * 1024;
const MAX_SIGNED_URL_TTL_SEC = 7 * 24 * 60 * 60;
const DEFAULT_MIME = 'application/octet-stream';

export interface S3StorageOptions {
  /** Injected in tests; production builds one from the `S3_*` variables. */
  client?: S3Client;
  /** Part size for streamed uploads (tests use a tiny one; S3 itself requires >= 5 MiB). */
  partBytes?: number;
}

interface ErrorLike {
  name?: string;
  $metadata?: { httpStatusCode?: number };
}

function statusOf(error: unknown): number | undefined {
  return (error as ErrorLike | null)?.$metadata?.httpStatusCode;
}

/**
 * A missing OBJECT only. Not every 404 qualifies: `NoSuchBucket` (a mistyped or deleted bucket) is
 * also a 404 and must surface as an error, not as "no such file" on every request. The SDK names a
 * bodiless 404 (HEAD) `NotFound` and a `NoSuchKey` XML body after its code.
 */
function isNotFound(error: unknown): boolean {
  const { name } = (error as ErrorLike | null) ?? {};
  return name === 'NoSuchKey' || name === 'NotFound';
}

function isInvalidRange(error: unknown): boolean {
  return (error as ErrorLike | null)?.name === 'InvalidRange' || statusOf(error) === 416;
}

function requiredSetting(
  env: Env,
  name: 'S3_BUCKET' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY',
) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3`);
  return value;
}

function buildClient(env: Env): S3Client {
  return new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: requiredSetting(env, 'S3_ACCESS_KEY_ID'),
      secretAccessKey: requiredSetting(env, 'S3_SECRET_ACCESS_KEY'),
    },
    // The SDK's newer default adds CRC trailers that MinIO, R2 and other S3-compatible services
    // reject or ignore unevenly; only send checksums where the API demands them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 60_000 },
  });
}

/** The HTTP `Range` value for a storage range, built from integers only. */
function rangeHeader({ start, end }: StorageRange): string {
  if (start < 0) return `bytes=-${-start}`;
  return `bytes=${start}-${end === undefined ? '' : end}`;
}

function isWellFormedRange({ start, end }: StorageRange): boolean {
  if (!Number.isSafeInteger(start) || Object.is(start, -0)) return false;
  if (end === undefined) return true;
  return Number.isSafeInteger(end) && start >= 0 && end >= start;
}

/** `bytes 10-19/100` -> its three numbers. */
function parseContentRange(value: string | undefined) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), size: Number(match[3]) };
}

function toWebStream(body: unknown): ReadableStream<Uint8Array> {
  if (body && typeof body === 'object') {
    const sdkBody = body as { transformToWebStream?: () => ReadableStream<Uint8Array> };
    if (typeof sdkBody.transformToWebStream === 'function') return sdkBody.transformToWebStream();
    if (body instanceof Readable) return Readable.toWeb(body) as ReadableStream<Uint8Array>;
    if (body instanceof ReadableStream) return body as ReadableStream<Uint8Array>;
  }
  throw new Error('S3 returned an object body of an unknown type');
}

function toBuffer(chunk: unknown): Buffer {
  return typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array);
}

/**
 * S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, ...) configured from the `S3_*`
 * variables. Small bodies are one `PutObject`; streams are sent as a multipart upload that holds
 * one part in memory at a time and is aborted on failure.
 */
export function createS3Storage(env: Env, options: S3StorageOptions = {}): StorageDriver {
  const bucket = requiredSetting(env, 'S3_BUCKET');
  const client = options.client ?? buildClient(env);
  const partBytes = options.partBytes ?? S3_PART_BYTES;

  async function putStream(key: string, body: NodeJS.ReadableStream, mimeType: string) {
    const pending: Buffer[] = [];
    let pendingBytes = 0;
    let total = 0;
    let uploadId: string | undefined;
    const parts: CompletedPart[] = [];

    const uploadPart = async (data: Buffer) => {
      if (!uploadId) {
        const started = await client.send(
          new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: mimeType }),
        );
        if (!started.UploadId) throw new Error('S3 did not return a multipart upload id');
        uploadId = started.UploadId;
      }
      const partNumber = parts.length + 1;
      const sent = await client.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: data,
        }),
      );
      parts.push({ ETag: sent.ETag, PartNumber: partNumber });
    };
    const takePending = () => {
      const data = Buffer.concat(pending, pendingBytes);
      pending.length = 0;
      pendingBytes = 0;
      return data;
    };

    try {
      for await (const chunk of body) {
        const buffer = toBuffer(chunk);
        pending.push(buffer);
        pendingBytes += buffer.byteLength;
        total += buffer.byteLength;
        if (pendingBytes >= partBytes) await uploadPart(takePending());
      }
      if (!uploadId) {
        // Never filled a part: a plain PutObject with a known length is simpler and cheaper.
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: takePending(),
            ContentType: mimeType,
          }),
        );
        return total;
      }
      if (pendingBytes > 0) await uploadPart(takePending());
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      return total;
    } catch (error) {
      if (uploadId) {
        await client
          .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
          .catch(() => undefined);
      }
      throw error;
    }
  }

  const driver: StorageDriver = {
    async put(key, body, { mimeType }) {
      assertStorageKey(key);
      if (body instanceof Uint8Array) {
        await client.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mimeType }),
        );
        return { bytes: body.byteLength };
      }
      return { bytes: await putStream(key, body, mimeType) };
    },

    async get(key, range) {
      assertStorageKey(key);
      if (range && !isWellFormedRange(range)) {
        const info = await driver.head(key);
        if (!info) throw AppError.of('not_found', 'No such object');
        throw new RangeNotSatisfiableError(info.size);
      }
      let response;
      try {
        response = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(range ? { Range: rangeHeader(range) } : {}),
          }),
        );
      } catch (error) {
        if (isNotFound(error)) throw AppError.of('not_found', 'No such object');
        if (isInvalidRange(error)) {
          const info = await driver.head(key);
          if (!info) throw AppError.of('not_found', 'No such object');
          throw new RangeNotSatisfiableError(info.size);
        }
        throw error;
      }
      const mimeType = response.ContentType ?? DEFAULT_MIME;
      const stream = toWebStream(response.Body);
      if (!range) {
        if (response.ContentLength === undefined) throw new Error('S3 omitted the object size');
        return { stream, size: response.ContentLength, mimeType };
      }
      const served = parseContentRange(response.ContentRange);
      if (!served) {
        await stream.cancel().catch(() => undefined);
        throw new Error('S3 endpoint ignored the Range request');
      }
      return {
        stream,
        size: served.size,
        mimeType,
        range: { start: served.start, end: served.end },
      };
    },

    async head(key) {
      assertStorageKey(key);
      try {
        const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          size: response.ContentLength ?? 0,
          mimeType: response.ContentType ?? DEFAULT_MIME,
        };
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async delete(key) {
      assertStorageKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },

    async signedUrl(key, ttlSec) {
      assertStorageKey(key);
      if (!Number.isFinite(ttlSec) || ttlSec < 1) {
        throw AppError.of('bad_request', 'Signed URL lifetime must be at least one second');
      }
      const expiresIn = Math.min(Math.floor(ttlSec), MAX_SIGNED_URL_TTL_SEC);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn,
      });
    },
  };
  return driver;
}
