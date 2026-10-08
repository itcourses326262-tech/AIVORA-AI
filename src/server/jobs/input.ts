import 'server-only';
import { and, eq, inArray } from 'drizzle-orm';
import type { ModelSpec } from '@/lib/catalog/types';
import { getTool } from '@/lib/tools';
import { assets, type GenerationRow } from '@/server/db/schema';
import { INPUT_ASSET_ROLES } from '@/server/generations/queries';
import type { ProviderInput } from '@/server/providers/types';
import { JobFailure } from './failure';
import type { JobRuntime } from './runtime';

/** The normalized upload is at most 4096 px; this only stops a damaged object from filling memory. */
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

const MISSING_INPUT = 'The input image is no longer available.';

async function readAll(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new JobFailure('invalid_input', MISSING_INPUT);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Uint8Array(Buffer.concat(chunks, total));
}

/** The input image of an `image-to-*` generation (an upload or an earlier result), read back from storage. */
async function loadInputImage(
  job: GenerationRow,
  rt: JobRuntime,
): Promise<NonNullable<ProviderInput['inputImage']>> {
  const asset = job.inputAssetId
    ? rt.db
        .select()
        .from(assets)
        .where(
          and(
            eq(assets.id, job.inputAssetId),
            eq(assets.userId, job.userId),
            inArray(assets.role, INPUT_ASSET_ROLES),
          ),
        )
        .get()
    : undefined;
  if (!asset) throw new JobFailure('invalid_input', MISSING_INPUT);
  try {
    const object = await rt.storage.get(asset.storageKey);
    return {
      bytes: await readAll(object.stream, MAX_INPUT_BYTES),
      mimeType: asset.mimeType,
      ...(asset.width === null ? {} : { width: asset.width }),
      ...(asset.height === null ? {} : { height: asset.height }),
    };
  } catch (error) {
    if (error instanceof JobFailure) throw error;
    // A file that vanished from storage is the user's problem; a broken driver is ours. Storage
    // only says `not_found` for the first, which is the case worth a specific message.
    if ((error as { code?: unknown }).code === 'not_found') {
      throw new JobFailure('invalid_input', MISSING_INPUT);
    }
    throw error;
  }
}

/** The provider-facing description of a claimed job (section 6.4). */
export async function buildProviderInput(
  job: GenerationRow,
  model: ModelSpec,
  rt: JobRuntime,
): Promise<ProviderInput> {
  const needsImage = getTool(job.tool)?.needsInputImage === true;
  return {
    generationId: job.id,
    tool: job.tool,
    model,
    prompt: job.prompt,
    ...(job.negativePrompt === null ? {} : { negativePrompt: job.negativePrompt }),
    params: job.params,
    ...(needsImage ? { inputImage: await loadInputImage(job, rt) } : {}),
  };
}
