import { AppError, isAppError } from '@/lib/errors';
import type { Db } from '@/server/db';
import { errorResponse } from '@/server/http/errors';
import { getLogger } from '@/server/logger';
import {
  RangeNotSatisfiableError,
  isRangeNotSatisfiable,
  type StorageDriver,
  type StorageReadResult,
} from '@/server/storage/types';
import { servableMimeType } from '@/server/uploads/sniff';
import { findVisibleAsset } from './access';
import {
  contentHeaders,
  etagFor,
  matchesIfNoneMatch,
  validatorHeaders,
  type MediaHeaderInput,
  type Variant,
} from './headers';
import { decideRange, type RangeDecision } from './range';

export interface ServeInput {
  req: Request;
  db: Db;
  storage: StorageDriver;
  assetId: string;
  /** The signed-in user (session or API key), or null. */
  viewerId: string | null;
  variant: Variant;
  download: boolean;
  /** HEAD: same headers, no body, no read of the object. */
  head: boolean;
}

const notFound = () => AppError.of('not_found', 'Asset not found');

/** 416 whose `Content-Range` tells the client the real size, so it can ask again. */
function unsatisfiable(size: number, headers: Headers): Response {
  const response = errorResponse(new RangeNotSatisfiableError(size));
  for (const [name, value] of headers) response.headers.set(name, value);
  response.headers.set('Content-Range', `bytes */${size}`);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * Ties an open file (or S3 socket) to the request. A client that disconnects while the handler is
 * still running, or before the framework starts reading the body, would otherwise leave the stream
 * unread and its file descriptor open for good.
 */
function releaseOnAbort(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const stop = () => {
    void reader.cancel().catch(() => undefined);
  };
  if (signal.aborted) stop();
  else signal.addEventListener('abort', stop, { once: true });
  const detach = () => signal.removeEventListener('abort', stop);
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            detach();
            controller.close();
          } else {
            controller.enqueue(value);
          }
        } catch (error) {
          detach();
          controller.error(error);
        }
      },
      async cancel(reason) {
        detach();
        await reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}

function respond(
  decision: RangeDecision,
  size: number,
  headers: Headers,
  body: ReadableStream<Uint8Array> | null,
  served?: StorageReadResult['range'],
): Response {
  const range = served ?? (decision.kind === 'partial' ? decision : undefined);
  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(body, { status: 206, headers });
  }
  headers.set('Content-Length', String(size));
  return new Response(body, { status: 200, headers });
}

/**
 * The whole of `GET|HEAD /api/v1/media/:assetId`: authorisation (404 for anything the caller may
 * not see, so existence never leaks), conditional requests, ranges, and a streamed body.
 *
 * Files are always streamed through the app, never redirected to a signed S3 URL: the site's CSP
 * allows `img-src`/`media-src` only for `'self'`, so a cross-origin redirect would be blocked, and
 * streaming keeps authorisation on every request instead of for the lifetime of a link.
 */
export async function serveAsset(input: ServeInput): Promise<Response> {
  const visible = findVisibleAsset(input.db, input.assetId, input.viewerId);
  if (!visible) throw notFound();
  const { asset, access } = visible;
  const thumb = input.variant === 'thumb';
  const key = thumb ? asset.thumbKey : asset.storageKey;
  if (!key) throw notFound();

  const servable = thumb ? 'image/webp' : servableMimeType(asset.mimeType);
  const headerInput: MediaHeaderInput = {
    asset,
    access,
    variant: input.variant,
    contentType: servable ?? 'application/octet-stream',
    // A type we do not recognise is never displayed inline.
    attachment: input.download || servable === null,
  };
  const etag = etagFor(asset.id, input.variant);
  const { headers: requestHeaders } = input.req;

  if (matchesIfNoneMatch(requestHeaders.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers: validatorHeaders(headerInput) });
  }

  const rangeFor = (size: number): RangeDecision =>
    thumb
      ? { kind: 'full' }
      : decideRange(requestHeaders.get('range'), size, {
          ifRange: requestHeaders.get('if-range'),
          etag,
        });

  try {
    if (input.head) {
      const info = await input.storage.head(key);
      if (!info) throw notFound();
      const decision = rangeFor(info.size);
      if (decision.kind === 'unsatisfiable') {
        return unsatisfiable(info.size, validatorHeaders(headerInput));
      }
      return respond(decision, info.size, contentHeaders(headerInput), null);
    }

    const decision = rangeFor(asset.bytes);
    if (decision.kind === 'unsatisfiable') {
      return unsatisfiable(asset.bytes, validatorHeaders(headerInput));
    }
    const result = await input.storage.get(
      key,
      decision.kind === 'partial' ? { start: decision.start, end: decision.end } : undefined,
    );
    const body = releaseOnAbort(result.stream, input.req.signal);
    return respond(decision, result.size, contentHeaders(headerInput), body, result.range);
  } catch (error) {
    if (isRangeNotSatisfiable(error)) {
      return unsatisfiable(error.size, validatorHeaders(headerInput));
    }
    if (isAppError(error) && error.code === 'not_found') {
      getLogger().warn('Asset row without a stored object', { assetId: asset.id });
      throw notFound();
    }
    throw error;
  }
}
