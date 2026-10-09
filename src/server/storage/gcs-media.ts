// OWNER: storage
import 'server-only';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import { RangeNotSatisfiableError } from './types';

/**
 * Media downloads do NOT go through `file.createReadStream` of the SDK. Its streams share one
 * keep-alive connection pool, and when ANY download is cancelled (a browser aborting a video
 * request, which happens all the time) the SDK destroys every connection of that pool: other
 * downloads and uploads in flight fail with "aborted". Here each download is its own request, and
 * cancelling the stream closes that one connection only.
 */

/** An HTTP error from the Cloud Storage JSON API; `code` is the status, like the SDK's ApiError. */
export class GcsHttpError extends Error {
  override readonly name: string = 'GcsHttpError';

  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface MediaRequest {
  url: URL;
  /** Includes authorization when the endpoint needs it. */
  headers: Record<string, string>;
  /** Inclusive offsets that were asked for; the answer must be exactly that slice. */
  range?: { start: number; end: number };
  /** Time allowed to connect and receive the response headers (the body can take as long as it takes). */
  timeoutMs: number;
  attempts: number;
  retryDelayMs: number;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRYABLE_CODES = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNREFUSED']);
const MAX_ERROR_BODY_BYTES = 8 * 1024;

function respond(url: URL, headers: Record<string, string>, timeoutMs: number) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const client = url.protocol === 'http:' ? http : https;
    const request = client.request(url, { method: 'GET', headers }, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    const timer = setTimeout(
      () =>
        request.destroy(
          Object.assign(
            new Error(`Cloud Storage download took longer than ${timeoutMs / 1000} s to start`),
            {
              code: 'ETIMEDOUT',
            },
          ),
        ),
      timeoutMs,
    );
    request.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function readErrorBody(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of response) {
      const buffer = chunk as Buffer;
      chunks.push(buffer);
      size += buffer.byteLength;
      if (size >= MAX_ERROR_BODY_BYTES) break;
    }
  } catch {
    // The status is what matters; a broken error body only costs the message.
  } finally {
    response.destroy();
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Google's message from a JSON error body (`{"error":{"message":"..."}}`), or undefined. */
function messageFrom(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    return typeof message === 'string' && message !== '' ? message : undefined;
  } catch {
    return undefined;
  }
}

function sizeFromUnsatisfied(headers: IncomingHttpHeaders): number | undefined {
  const match = /^bytes \*\/(\d+)$/.exec(String(headers['content-range'] ?? ''));
  return match ? Number(match[1]) : undefined;
}

function checkServedRange(headers: IncomingHttpHeaders, range: { start: number; end: number }) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(headers['content-range'] ?? ''));
  if (!match || Number(match[1]) !== range.start || Number(match[2]) !== range.end) {
    throw new Error('Cloud Storage answered with a different byte range than requested');
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof GcsHttpError) return RETRYABLE_STATUS.has(error.code);
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_CODES.has(code);
}

async function attempt(request: MediaRequest): Promise<IncomingMessage> {
  const response = await respond(request.url, request.headers, request.timeoutMs);
  const status = response.statusCode ?? 0;
  if (status === 416) {
    const size = sizeFromUnsatisfied(response.headers);
    response.destroy();
    if (size !== undefined) throw new RangeNotSatisfiableError(size);
    throw new GcsHttpError(416, 'Requested range not satisfiable');
  }
  if (request.range ? status !== 206 : status !== 200) {
    if (status >= 200 && status < 300) {
      response.destroy();
      throw new Error(
        request.range
          ? 'Cloud Storage ignored the Range request'
          : `Cloud Storage answered a download with HTTP ${status}`,
      );
    }
    const message = messageFrom(await readErrorBody(response));
    throw new GcsHttpError(status, message ?? `Cloud Storage answered HTTP ${status}`);
  }
  if (request.range) {
    try {
      checkServedRange(response.headers, request.range);
    } catch (error) {
      response.destroy();
      throw error;
    }
  }
  return response;
}

/**
 * GETs one object (or one slice of it) and returns its body as a web stream. Failing to connect, a
 * 429 or a 5xx are retried before any byte is returned; once the body is flowing nothing is retried
 * (the caller has already started sending bytes). Cancelling the stream closes this connection.
 */
export async function openMediaStream(request: MediaRequest): Promise<ReadableStream<Uint8Array>> {
  for (let tried = 1; ; tried += 1) {
    try {
      const response = await attempt(request);
      return Readable.toWeb(response) as NodeWebStream as ReadableStream<Uint8Array>;
    } catch (error) {
      if (tried >= request.attempts || !isTransient(error)) throw error;
      await new Promise((done) => setTimeout(done, request.retryDelayMs * 2 ** (tried - 1)));
    }
  }
}
