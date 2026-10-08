import 'server-only';
import { isAppError } from '@/lib/errors';
import type { GenerationRow } from '@/server/db/schema';
import type { ProviderOutput } from '@/server/providers/types';
import { removeAssetObjects, type PersistedOutput } from '@/server/uploads';
import type { JobRuntime } from './runtime';

const MB = 1024 * 1024;
/** Section 6.6: provider downloads are capped at 500 MB; images are far smaller than that. */
const MAX_DOWNLOAD_BYTES = { image: 64 * MB, video: 500 * MB } as const;
const MAX_THUMBNAIL_BYTES = 10 * MB;
const ALLOWED_TYPES = ['image/*', 'video/*'] as const;
const THUMBNAIL_TYPES = ['image/*'] as const;
const MIN_DOWNLOAD_MS = 30_000;
const MAX_DOWNLOAD_MS = 5 * 60_000;
const DOWNLOAD_RETRY_MS = 1_000;

/** Errors that make one output unusable without saying anything about the others. */
const PER_OUTPUT_CODES = new Set([
  'bad_request',
  'payload_too_large',
  'unsupported_media_type',
  'provider_error',
]);

export interface MaterializeArgs {
  job: GenerationRow;
  rt: JobRuntime;
  /** The job's signal: downloads and waits stop as soon as it aborts. */
  signal: AbortSignal;
  /** Milliseconds left until the job's deadline. */
  remainingMs(): number;
}

interface Downloaded {
  bytes: Uint8Array;
  mimeType: string;
}

function downloadTimeout(args: MaterializeArgs): number {
  return Math.min(MAX_DOWNLOAD_MS, Math.max(MIN_DOWNLOAD_MS, args.remainingMs()));
}

/** Downloads a provider URL through the SSRF-safe fetch; one retry for a transient failure. */
async function download(url: string, kind: GenerationRow['kind'], args: MaterializeArgs) {
  const { rt, signal } = args;
  const options = {
    maxBytes: MAX_DOWNLOAD_BYTES[kind],
    timeoutMs: downloadTimeout(args),
    allowedContentTypes: ALLOWED_TYPES,
    signal,
  };
  try {
    return await rt.fetchOutput(url, options);
  } catch (error) {
    if (signal.aborted || !isAppError(error) || error.code !== 'provider_error') throw error;
    await rt.sleep(DOWNLOAD_RETRY_MS, signal);
    return rt.fetchOutput(url, options);
  }
}

async function bytesOf(output: ProviderOutput, args: MaterializeArgs): Promise<Downloaded | null> {
  if (output.bytes && output.bytes.byteLength > 0) {
    return { bytes: output.bytes, mimeType: output.mimeType ?? 'application/octet-stream' };
  }
  if (!output.url) return null;
  const fetched = await download(output.url, args.job.kind, args);
  return { bytes: fetched.bytes, mimeType: output.mimeType ?? fetched.contentType };
}

/** A preview is a nicety: any problem with it only costs the thumbnail. */
async function thumbnailOf(
  output: ProviderOutput,
  args: MaterializeArgs,
): Promise<Uint8Array | undefined> {
  if (args.job.kind !== 'video' || !output.thumbUrl) return undefined;
  try {
    const fetched = await args.rt.fetchOutput(output.thumbUrl, {
      maxBytes: MAX_THUMBNAIL_BYTES,
      timeoutMs: MIN_DOWNLOAD_MS,
      allowedContentTypes: THUMBNAIL_TYPES,
      signal: args.signal,
    });
    return fetched.bytes;
  } catch (error) {
    if (args.signal.aborted) throw error;
    args.rt.log.warn('Ignoring an unusable output thumbnail', {
      generationId: args.job.id,
      code: isAppError(error) ? error.code : 'unknown',
    });
    return undefined;
  }
}

/** Removes files written for a job that did not complete (failed, canceled, deleted, lease lost). */
export async function discardOutputs(
  rt: Pick<JobRuntime, 'storage'>,
  persisted: readonly PersistedOutput[],
): Promise<void> {
  await removeAssetObjects(
    rt.storage,
    persisted.map((output) => ({
      storageKey: output.storageKey,
      thumbKey: output.thumbKey ?? null,
    })),
  );
}

/**
 * Turns what a provider returned into stored files: downloads URLs (SSRF-safe, size capped, media
 * types only) and hands every output to `persistOutput`. At most `params.count` outputs are kept.
 * An output that cannot be downloaded or is not a usable image or video is skipped with a warning
 * so the others still arrive (the missing share is refunded by `completeGeneration`). Anything
 * else, such as a storage failure or an abort, discards the files already written and throws.
 */
export async function materializeOutputs(
  outputs: readonly ProviderOutput[],
  args: MaterializeArgs,
): Promise<PersistedOutput[]> {
  const { job, rt, signal } = args;
  const persisted: PersistedOutput[] = [];
  try {
    for (const [position, output] of outputs.slice(0, job.params.count).entries()) {
      signal.throwIfAborted();
      try {
        const file = await bytesOf(output, args);
        if (!file) {
          rt.log.warn('Provider output has neither bytes nor url', {
            generationId: job.id,
            position,
          });
          continue;
        }
        const thumbBytes = await thumbnailOf(output, args);
        persisted.push(
          await rt.persistOutput(rt.storage, {
            userId: job.userId,
            generationId: job.id,
            index: persisted.length,
            kind: job.kind,
            bytes: file.bytes,
            mimeType: file.mimeType,
            ...(output.durationMs === undefined ? {} : { durationMs: output.durationMs }),
            ...(output.width === undefined ? {} : { width: output.width }),
            ...(output.height === undefined ? {} : { height: output.height }),
            ...(thumbBytes ? { thumbBytes } : {}),
          }),
        );
      } catch (error) {
        if (signal.aborted || !isAppError(error) || !PER_OUTPUT_CODES.has(error.code)) throw error;
        rt.log.warn('Skipping an unusable provider output', {
          generationId: job.id,
          position,
          code: error.code,
        });
      }
    }
  } catch (error) {
    await discardOutputs(rt, persisted);
    throw error;
  }
  return persisted;
}
