import 'server-only';
import { ProviderError } from '../errors';
import type { ProviderInput, ProviderOutput } from '../types';
import type { FalFile, FalResult } from './schemas';

function positiveInt(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.round(value)
    : undefined;
}

/** The engine downloads these through its SSRF guard, which only accepts https. */
function isHttps(url: string): boolean {
  return url.startsWith('https://');
}

function seedOf(result: FalResult): number | undefined {
  const { seed } = result;
  return typeof seed === 'number' && Number.isSafeInteger(seed) ? seed : undefined;
}

function imageOutput(file: FalFile, seed: number | undefined): ProviderOutput {
  const mimeType = file.content_type?.startsWith('image/') ? file.content_type : undefined;
  const width = positiveInt(file.width);
  const height = positiveInt(file.height);
  return {
    kind: 'image',
    url: file.url,
    ...(mimeType === undefined ? {} : { mimeType }),
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    ...(seed === undefined ? {} : { seed }),
  };
}

function imageOutputs(result: FalResult): ProviderOutput[] {
  const files = (result.images ?? []).filter((file) => isHttps(file.url));
  if (files.length === 0) {
    // A Gemini-based model that declines answers with text and no image; there is nothing to retry.
    const declined = (result.description ?? '').trim() !== '';
    throw new ProviderError(
      declined ? 'content_policy' : 'unknown',
      declined ? 'fal returned an explanation and no image' : 'fal returned no image',
      { retryable: false },
    );
  }
  // With the safety checker on, a flagged image is replaced by a black one and flagged here.
  const flagged = result.has_nsfw_concepts ?? [];
  const seed = seedOf(result);
  const kept = files.filter((_, index) => flagged[index] !== true);
  if (kept.length === 0) {
    throw new ProviderError('content_policy', 'fal safety checker flagged every image', {
      retryable: false,
    });
  }
  return kept.map((file) => imageOutput(file, seed));
}

function videoOutputs(result: FalResult, input: ProviderInput): ProviderOutput[] {
  const file = result.video;
  if (!file || !isHttps(file.url)) {
    throw new ProviderError('unknown', 'fal returned no video', { retryable: false });
  }
  const reported = file.duration;
  const requested = input.params.durationSec ?? input.model.limits.defaultDuration;
  const seconds =
    typeof reported === 'number' && reported >= 0.5 && reported <= 600 ? reported : requested;
  const width = positiveInt(file.width);
  const height = positiveInt(file.height);
  const seed = seedOf(result);
  return [
    {
      kind: 'video',
      url: file.url,
      mimeType: file.content_type?.startsWith('video/') ? file.content_type : 'video/mp4',
      ...(seconds === undefined ? {} : { durationMs: Math.round(seconds * 1000) }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(seed === undefined ? {} : { seed }),
    },
  ];
}

/** The generated files of a finished request; throws a ProviderError when there is no usable one. */
export function outputsFromResult(result: FalResult, input: ProviderInput): ProviderOutput[] {
  return input.model.kind === 'video' ? videoOutputs(result, input) : imageOutputs(result);
}
