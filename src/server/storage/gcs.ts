// OWNER: storage
import 'server-only';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '@/lib/errors';
import type { Env } from '@/server/env';
import { readServiceAccount, type ServiceAccount } from './gcs-credentials';
import { openMediaStream } from './gcs-media';
import { assertStorageKey } from './keys';
import { DEFAULT_MIME, assertMimeType } from './mime';
import { resolveStorageRange } from './range';
import type { StorageDriver, StorageReadResult, StoredObjectInfo } from './types';

/** Metadata and delete calls are small, and a download answers its headers at once: longer is stuck. */
const REQUEST_TIMEOUT_MS = 30_000;
/** A whole upload, including the wait for Google's answer. Generous: videos are tens of MB. */
const UPLOAD_TIMEOUT_MS = 10 * 60_000;
/** Attempts for an upload whose body can be replayed (bytes in memory). */
const PUT_ATTEMPTS = 3;
const PUT_RETRY_DELAY_MS = 400;

/**
 * The part of Cloud Storage this driver uses, as small interfaces. `buildClient` adapts the real SDK
 * to them (the SDK for metadata, uploads and deletes, `gcs-media.ts` for downloads); tests pass an
 * in-memory one, so no unit test needs credentials or a network.
 */
export interface GcsFileMetadata {
  /** The JSON API reports sizes as strings. */
  size?: string | number;
  contentType?: string;
  generation?: string | number;
}

export interface GcsFile {
  getMetadata(): Promise<[GcsFileMetadata, ...unknown[]]>;
  /**
   * The bytes of one generation of the object, or of the inclusive slice `start`-`end`, as a web
   * stream. Rejects with an error whose `code` is the HTTP status (404 when that generation is
   * gone). Cancelling the stream must release its connection and nothing else.
   */
  openRead(options: {
    generation?: string;
    start?: number;
    end?: number;
  }): Promise<ReadableStream<Uint8Array>>;
  createWriteStream(options?: {
    resumable?: boolean;
    contentType?: string;
    timeout?: number;
  }): Writable;
  delete(): Promise<unknown>;
}

export interface GcsBucket {
  file(name: string): GcsFile;
}

export interface GcsClient {
  bucket(name: string): GcsBucket;
}

export interface GcsStorageOptions {
  /** Injected in tests; production builds the SDK client from the service account. */
  client?: GcsClient;
  /** Pause before the first retry of an upload (doubles each time). */
  retryDelayMs?: number;
  /** Upper bound of one metadata or delete call. */
  requestTimeoutMs?: number;
  /** Upper bound of one upload. */
  uploadTimeoutMs?: number;
}

/** Bucket names are 3-222 characters of lowercase letters, digits, dashes, underscores and dots. */
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/;

/** Accepts what people copy from the console: `gs://name/` as well as `name`. */
export function normalizeBucketName(raw: string | undefined): string {
  const name = (raw ?? '')
    .trim()
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/, '');
  if (name === '') throw new Error('FIREBASE_STORAGE_BUCKET is required when STORAGE_DRIVER=gcs');
  if (!BUCKET_PATTERN.test(name)) {
    throw new Error(
      'FIREBASE_STORAGE_BUCKET is not a bucket name (expected something like my-project.firebasestorage.app)',
    );
  }
  return name;
}

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  response?: { status?: unknown };
}

/** HTTP status of a Google API error, which the SDK exposes as `code` (a number or a string). */
function statusOf(error: unknown): number | undefined {
  const { code, response } = (error as ErrorLike | null) ?? {};
  const raw =
    typeof code === 'number' || typeof code === 'string' ? Number(code) : response?.status;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 100 && raw <= 599
    ? raw
    : undefined;
}

/**
 * A missing OBJECT only. A mistyped or deleted BUCKET is a 404 too, and must surface as an error
 * instead of making every picture "not found"; Google tells the two apart only in the message.
 */
export function isMissingObject(error: unknown): boolean {
  if (statusOf(error) !== 404) return false;
  const message = (error as ErrorLike | null)?.message;
  return !(typeof message === 'string' && /specified bucket does not exist/i.test(message));
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'FILE_NO_UPLOAD',
]);

function isRetryable(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) return RETRYABLE_STATUS.has(status);
  const code = (error as ErrorLike | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

const notFound = () => AppError.of('not_found', 'No such object');

function toBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') return Buffer.from(chunk);
  const view = chunk as Uint8Array;
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Rejects when `work` has not settled in time; the call itself cannot be cancelled. */
async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Cloud Storage ${what} took longer than ${ms / 1000} s`)),
      ms,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface ClientSettings {
  requestTimeoutMs: number;
  retryDelayMs: number;
}

/**
 * Loaded on first use: the SDK is large, and a site on local disk (the default) must not pay for it
 * at start-up. Retries are the SDK's for small calls (GETs and deletes, which are safe to repeat);
 * uploads and media downloads are retried here, only while the body can still be replayed.
 */
async function buildClient(account: ServiceAccount, settings: ClientSettings): Promise<GcsClient> {
  const { Storage, IdempotencyStrategy } = await import('@google-cloud/storage');
  const storage = new Storage({
    projectId: account.project_id,
    credentials: {
      client_email: account.client_email,
      private_key: account.private_key,
      ...(account.private_key_id ? { private_key_id: account.private_key_id } : {}),
    },
    retryOptions: {
      autoRetry: true,
      maxRetries: 3,
      totalTimeout: 60,
      maxRetryDelay: 8,
      idempotencyStrategy: IdempotencyStrategy.RetryAlways,
    },
  });

  /** Authorization for the media request. A custom endpoint (an emulator) takes none. */
  async function authorization(): Promise<Record<string, string>> {
    if (storage.customEndpoint && !storage.useAuthWithCustomEndpoint) return {};
    const token = await storage.authClient.getAccessToken();
    if (!token) throw new Error('Google did not return an access token for the service account');
    return { authorization: `Bearer ${token}` };
  }

  return {
    bucket(name) {
      const bucket = storage.bucket(name);
      return {
        file(key) {
          const file = bucket.file(key);
          return {
            getMetadata: () => file.getMetadata(),
            createWriteStream: (options) => file.createWriteStream(options),
            delete: () => file.delete(),
            // Not `file.createReadStream`: cancelling one of its streams breaks every other
            // transfer in flight (see gcs-media.ts).
            async openRead({ generation, start, end }) {
              const url = new URL(
                `${storage.apiEndpoint}/storage/v1/b/${encodeURIComponent(name)}/o/${encodeURIComponent(key)}`,
              );
              url.searchParams.set('alt', 'media');
              if (generation !== undefined) url.searchParams.set('generation', generation);
              const ranged = start !== undefined && end !== undefined;
              return openMediaStream({
                url,
                headers: {
                  ...(await authorization()),
                  // Stored bytes as they are: they must match the size announced to the browser.
                  'accept-encoding': 'identity',
                  ...(ranged ? { range: `bytes=${start}-${end}` } : {}),
                },
                ...(ranged ? { range: { start, end } } : {}),
                timeoutMs: settings.requestTimeoutMs,
                attempts: PUT_ATTEMPTS,
                retryDelayMs: settings.retryDelayMs,
              });
            },
          };
        },
      };
    },
  };
}

/**
 * Google Cloud Storage, which is also the storage of a Firebase project (its default bucket is
 * `<project>.firebasestorage.app`). Only the server talks to it, with a service account, so bucket
 * rules are irrelevant and can stay "deny all": pictures and videos keep streaming through the
 * app, which checks who may see them. There is deliberately no `signedUrl`.
 *
 * The settings and the key file are checked here, when the driver is created (never at import);
 * the SDK itself is loaded on the first request.
 */
export function createGcsStorage(env: Env, options: GcsStorageOptions = {}): StorageDriver {
  const bucketName = normalizeBucketName(env.FIREBASE_STORAGE_BUCKET);
  const account = options.client ? undefined : readServiceAccount(env);
  const retryDelayMs = options.retryDelayMs ?? PUT_RETRY_DELAY_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? UPLOAD_TIMEOUT_MS;

  let pending: Promise<GcsBucket> | undefined;
  function bucket(): Promise<GcsBucket> {
    if (!pending) {
      const client = options.client
        ? Promise.resolve(options.client)
        : buildClient(account as ServiceAccount, { requestTimeoutMs, retryDelayMs });
      pending = client.then((ready) => ready.bucket(bucketName));
      // A failed start (SDK missing, bad key) is reported to the caller and tried again next time.
      pending.catch(() => {
        pending = undefined;
      });
    }
    return pending;
  }

  interface Stat extends StoredObjectInfo {
    generation: string | undefined;
  }

  async function stat(file: GcsFile): Promise<Stat | null> {
    let metadata: GcsFileMetadata;
    try {
      [metadata] = await within(file.getMetadata(), requestTimeoutMs, 'metadata request');
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Cloud Storage returned an object without a usable size');
    }
    return {
      size,
      mimeType: metadata.contentType || DEFAULT_MIME,
      generation: metadata.generation === undefined ? undefined : String(metadata.generation),
    };
  }

  /** One attempt; `source` is consumed, whatever happens. Returns the bytes sent. */
  async function upload(
    file: GcsFile,
    source: NodeJS.ReadableStream,
    mimeType: string,
  ): Promise<number> {
    let bytes = 0;
    const sink = file.createWriteStream({
      // One request, no session to resume: the pictures are small and a stream cannot be replayed.
      resumable: false,
      contentType: mimeType,
    });
    try {
      await pipeline(
        source,
        // Counts as it goes; each chunk waits for the sink (backpressure), so memory stays flat.
        async function* (chunks: AsyncIterable<unknown>) {
          for await (const chunk of chunks) {
            const buffer = toBuffer(chunk);
            bytes += buffer.byteLength;
            yield buffer;
          }
        },
        sink,
        { signal: AbortSignal.timeout(uploadTimeoutMs) },
      );
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'AbortError') {
        throw new Error(`Cloud Storage upload took longer than ${uploadTimeoutMs / 1000} s`);
      }
      throw error;
    }
    return bytes;
  }

  return {
    async put(key, body, { mimeType }) {
      assertStorageKey(key);
      assertMimeType(mimeType);
      const file = (await bucket()).file(key);
      if (!(body instanceof Uint8Array)) return { bytes: await upload(file, body, mimeType) };
      for (let attempt = 1; ; attempt += 1) {
        try {
          const chunks = body.byteLength === 0 ? [] : [toBuffer(body)];
          return { bytes: await upload(file, Readable.from(chunks), mimeType) };
        } catch (error) {
          if (attempt >= PUT_ATTEMPTS || !isRetryable(error)) throw error;
          await sleep(retryDelayMs * 2 ** (attempt - 1));
        }
      }
    },

    async get(key, range): Promise<StorageReadResult> {
      assertStorageKey(key);
      const target = await bucket();
      const file = target.file(key);
      // Measure, then read exactly the measured generation. If the object is replaced in between,
      // that generation is gone (404): measure again once instead of failing or, worse, sending
      // bytes that disagree with the size announced to the browser.
      for (let attempt = 1; ; attempt += 1) {
        const info = await stat(file);
        if (!info) throw notFound();
        // Before any byte is requested, so an impossible range is a 416 and not a Google error.
        const slice = range ? resolveStorageRange(range, info.size) : undefined;
        if (info.size === 0) {
          return { stream: new Blob([]).stream(), size: 0, mimeType: info.mimeType };
        }
        try {
          const stream = await file.openRead({
            ...(info.generation ? { generation: info.generation } : {}),
            ...(slice ? { start: slice.start, end: slice.end } : {}),
          });
          return {
            stream,
            size: info.size,
            mimeType: info.mimeType,
            ...(slice ? { range: slice } : {}),
          };
        } catch (error) {
          if (!isMissingObject(error)) throw error;
          if (attempt >= 2) throw notFound();
        }
      }
    },

    async head(key) {
      assertStorageKey(key);
      const info = await stat((await bucket()).file(key));
      return info ? { size: info.size, mimeType: info.mimeType } : null;
    },

    async delete(key) {
      assertStorageKey(key);
      const file = (await bucket()).file(key);
      try {
        await within(file.delete(), requestTimeoutMs, 'delete request');
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    },
  };
}
