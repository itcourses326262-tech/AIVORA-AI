// OWNER: storage
import 'server-only';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { getLogger } from '@/server/logger';
import type { StorageDriver } from '@/server/storage/types';
import { makeThumbnail, probeImage } from './image';
import { objectKeys, type ObjectKeys } from './keys';
import {
  extensionForMime,
  isMediaMimeType,
  normalizeMimeType,
  sniffMediaType,
  type MediaMimeType,
} from './sniff';
import { putObjects, sha256Hex, type ObjectToStore } from './store';
import type { PersistedOutput, PersistOutputInput } from './types';

/** Images and GIFs are decoded, so they are held in memory; this bounds that. */
const MAX_BUFFERED_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Sanity limit for streamed video; the engine applies its own, tighter download cap first. */
const MAX_STREAMED_OUTPUT_BYTES = 1024 * 1024 * 1024;
const SNIFF_BYTES = 16;

interface Described {
  mimeType: MediaMimeType;
  width?: number;
  height?: number;
  /** WebP preview. */
  thumb?: Uint8Array;
}

const unsupported = () =>
  AppError.of('bad_request', 'The provider returned an unsupported file', {
    reason: 'unsupported',
  });

const tooLarge = (limit: number) =>
  AppError.of('payload_too_large', `A generated output exceeds ${limit} bytes`);

function chunkOf(value: unknown): Buffer {
  return typeof value === 'string' ? Buffer.from(value) : Buffer.from(value as Uint8Array);
}

async function collect(stream: AsyncIterable<unknown>, limit: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of stream) {
    const chunk = chunkOf(value);
    total += chunk.byteLength;
    if (total > limit) throw tooLarge(limit);
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

const isVideoType = (type: string): type is MediaMimeType =>
  isMediaMimeType(type) && type.startsWith('video/');

/** The detected type wins over the claimed one; a claim is only believed for video containers. */
function videoType(head: Uint8Array, claimed: string): MediaMimeType | null {
  const sniffed = sniffMediaType(head);
  if (sniffed === 'image/gif' || (sniffed && isVideoType(sniffed))) return sniffed;
  const normalized = normalizeMimeType(claimed);
  return isVideoType(normalized) ? normalized : null;
}

async function describeImage(bytes: Uint8Array): Promise<Described> {
  const info = await probeImage(bytes);
  if (!isMediaMimeType(info.mimeType)) throw unsupported();
  const thumb = await makeThumbnail(bytes);
  return { mimeType: info.mimeType, width: info.width, height: info.height, thumb: thumb.bytes };
}

/** A bad preview must not cost the user a finished video, so failures only drop the thumbnail. */
async function providerThumbnail(input: PersistOutputInput): Promise<Uint8Array | undefined> {
  if (!input.thumbBytes) return undefined;
  try {
    return (await makeThumbnail(input.thumbBytes)).bytes;
  } catch (err) {
    getLogger().warn('Ignoring an unreadable provider thumbnail', { err });
    return undefined;
  }
}

/** A video container we cannot decode: size from the provider, preview only if it sent one. */
async function describeContainer(
  mimeType: MediaMimeType,
  input: PersistOutputInput,
): Promise<Described> {
  const thumb = await providerThumbnail(input);
  return {
    mimeType,
    ...(input.width === undefined ? {} : { width: input.width }),
    ...(input.height === undefined ? {} : { height: input.height }),
    ...(thumb ? { thumb } : {}),
  };
}

function plan(input: PersistOutputInput, described: Described) {
  const assetId = newId('ast');
  const keys = objectKeys({
    userId: input.userId,
    folder: input.generationId,
    assetId,
    extension: extensionForMime(described.mimeType),
  });
  const thumbObject: ObjectToStore[] = described.thumb
    ? [{ key: keys.thumbKey, body: described.thumb, mimeType: 'image/webp' }]
    : [];
  return { assetId, keys, thumbObject };
}

function toPersisted(
  input: PersistOutputInput,
  described: Described,
  stored: { assetId: string; keys: ObjectKeys; size: number; sha256: string },
): PersistedOutput {
  return {
    assetId: stored.assetId,
    index: input.index,
    kind: input.kind,
    storageKey: stored.keys.storageKey,
    ...(described.thumb ? { thumbKey: stored.keys.thumbKey } : {}),
    mimeType: described.mimeType,
    bytes: stored.size,
    ...(described.width === undefined ? {} : { width: described.width }),
    ...(described.height === undefined ? {} : { height: described.height }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    sha256: stored.sha256,
  };
}

async function persistBuffered(
  storage: StorageDriver,
  input: PersistOutputInput,
  bytes: Uint8Array,
): Promise<PersistedOutput> {
  let described: Described;
  if (input.kind === 'image') {
    described = await describeImage(bytes);
  } else {
    const mimeType = videoType(bytes, input.mimeType);
    if (!mimeType) throw unsupported();
    // The Demo provider's "video" is an animated GIF: sharp reads its size and first frame.
    described =
      mimeType === 'image/gif'
        ? { ...(await describeImage(bytes)), mimeType }
        : await describeContainer(mimeType, input);
  }
  const { assetId, keys, thumbObject } = plan(input, described);
  await putObjects(storage, [
    { key: keys.storageKey, body: bytes, mimeType: described.mimeType },
    ...thumbObject,
  ]);
  return toPersisted(input, described, {
    assetId,
    keys,
    size: bytes.byteLength,
    sha256: sha256Hex(bytes),
  });
}

/**
 * Reads just enough of a stream to recognise the file. `whole()` replays it from the start and
 * releases the source when it ends or is abandoned; `close()` releases it when it never starts.
 */
async function peek(stream: NodeJS.ReadableStream) {
  const iterator = stream[Symbol.asyncIterator]();
  let head: Buffer = Buffer.alloc(0);
  while (head.byteLength < SNIFF_BYTES) {
    const next = await iterator.next();
    if (next.done) break;
    head = Buffer.concat([head, chunkOf(next.value)]);
  }
  async function* whole(): AsyncGenerator<Buffer> {
    try {
      if (head.byteLength > 0) yield head;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield chunkOf(next.value);
      }
    } finally {
      await iterator.return?.();
    }
  }
  const close = async () => {
    await iterator.return?.();
  };
  return { head, whole, close };
}

async function persistStream(
  storage: StorageDriver,
  input: PersistOutputInput,
  stream: NodeJS.ReadableStream,
): Promise<PersistedOutput> {
  if (input.kind === 'image') {
    return persistBuffered(storage, input, await collect(stream, MAX_BUFFERED_OUTPUT_BYTES));
  }
  const { head, whole, close } = await peek(stream);
  const mimeType = videoType(head, input.mimeType);
  if (head.byteLength === 0 || !mimeType) {
    await close();
    throw unsupported();
  }
  if (mimeType === 'image/gif') {
    const bytes = await collect(whole(), MAX_BUFFERED_OUTPUT_BYTES);
    return persistBuffered(storage, input, bytes);
  }

  const described = await describeContainer(mimeType, input);
  const { assetId, keys, thumbObject } = plan(input, described);
  const hash = createHash('sha256');
  let size = 0;
  async function* measured(): AsyncGenerator<Buffer> {
    for await (const chunk of whole()) {
      size += chunk.byteLength;
      if (size > MAX_STREAMED_OUTPUT_BYTES) throw tooLarge(MAX_STREAMED_OUTPUT_BYTES);
      hash.update(chunk);
      yield chunk;
    }
  }
  await putObjects(storage, [
    { key: keys.storageKey, body: Readable.from(measured(), { objectMode: false }), mimeType },
    ...thumbObject,
  ]);
  return toPersisted(input, described, { assetId, keys, size, sha256: hash.digest('hex') });
}

/**
 * Writes a generated output (and, when it can be decoded or the provider sent a preview, its
 * thumbnail) to `storage` under `u/<userId>/<generationId>/<assetId>.<ext>` and returns what the
 * asset row needs. It does not insert the row.
 *
 * The real type and size come from the bytes, not from the provider: images are probed with sharp
 * (SVG and other non-browser formats are refused), videos are recognised by their container.
 * Throws `bad_request` for output that is not a usable image or video so the engine can fail the
 * generation and refund it; nothing is left in storage when it throws.
 */
export async function persistOutput(
  storage: StorageDriver,
  input: PersistOutputInput,
): Promise<PersistedOutput> {
  return input.bytes instanceof Uint8Array
    ? persistBuffered(storage, input, input.bytes)
    : persistStream(storage, input, input.bytes);
}
