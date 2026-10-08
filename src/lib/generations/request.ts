import type { CreateGenerationRequest, GenerationDTO } from '@/lib/api-types';

/**
 * A fresh `Idempotency-Key`: one per click on Generate. `crypto.randomUUID` only exists in secure
 * contexts (HTTPS or localhost), so a plain-HTTP deployment falls back to random bytes.
 */
export function newIdempotencyKey(): string {
  const { crypto } = globalThis;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The request that would create the same generation again (Try again, Reuse settings). It carries
 * the input image only when the original had one: an uploaded input stays valid as an
 * `inputAssetId`, since inputs are never deleted with the generation.
 */
export function requestFromGeneration(generation: GenerationDTO): CreateGenerationRequest {
  const { params } = generation;
  return {
    tool: generation.tool,
    modelId: generation.modelId,
    prompt: generation.prompt,
    ...(generation.negativePrompt ? { negativePrompt: generation.negativePrompt } : {}),
    params: {
      aspectRatio: params.aspectRatio,
      count: params.count,
      ...(params.durationSec === undefined ? {} : { durationSec: params.durationSec }),
      ...(params.resolution === undefined ? {} : { resolution: params.resolution }),
      ...(params.seed === undefined ? {} : { seed: params.seed }),
      ...(params.strength === undefined ? {} : { strength: params.strength }),
    },
    ...(generation.input ? { inputAssetId: generation.input.id } : {}),
    isPublic: false,
  };
}
