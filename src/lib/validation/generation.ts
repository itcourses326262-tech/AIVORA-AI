import { z } from 'zod';
import type { CreateGenerationRequest, ValidationIssue } from '@/lib/api-types';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  TOOLS,
  type GenerationParams,
  type ModelSpec,
} from '@/lib/catalog/types';
import { NotImplementedError } from '@/lib/errors';
import { isValidId } from '@/lib/id';

// Generous hard ceilings that only bound abuse. Everything model-specific (allowed ratios,
// durations, counts, prompt length) is checked later against the chosen model's limits.
export const MAX_PROMPT_CHARS_HARD = 4000;
export const MAX_NEGATIVE_PROMPT_CHARS_HARD = 2000;

const generationParamsSchema = z
  .object({
    aspectRatio: z.enum(ASPECT_RATIOS),
    count: z.int().min(1).max(8),
    durationSec: z.int().min(1).max(120),
    resolution: z.enum(RESOLUTIONS),
    seed: z.int().min(0).max(4_294_967_295),
    strength: z.number().min(0).max(1),
  })
  .partial()
  .strict();

/** Shape of `POST /generations`. Unknown keys are rejected so typos do not silently fall back to defaults. */
export const createGenerationRequestSchema = z
  .object({
    tool: z.enum(TOOLS),
    modelId: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(MAX_PROMPT_CHARS_HARD),
    negativePrompt: z.string().trim().max(MAX_NEGATIVE_PROMPT_CHARS_HARD).optional(),
    params: generationParamsSchema.optional(),
    inputAssetId: z
      .string()
      .refine((value): boolean => isValidId(value, 'ast'), { message: 'Invalid asset id' })
      .optional(),
    isPublic: z.boolean().optional(),
  })
  .strict();

export type CreateGenerationInput = z.infer<typeof createGenerationRequestSchema>;

/** The part of the server `Env` that validation looks at, so `lib/` needs no server import. */
export interface GenerationValidationEnv {
  /** When false, Demo (mock) models are rejected as unknown. Defaults to true. */
  ENABLE_MOCK_PROVIDER?: boolean;
}

export type GenerationValidationResult =
  | {
      ok: true;
      model: ModelSpec;
      /** Defaults filled in and values clamped to the model's limits. */
      params: GenerationParams;
      /** Credits the request will cost (`computeCost` of the normalized params). */
      cost: number;
    }
  | { ok: false; errors: ValidationIssue[] };

// OWNER: catalog — replace this stub
/**
 * Checks a request against the model catalog: the model exists and serves the tool, the prompt is
 * within the model's length, the aspect ratio, duration, resolution and count are allowed,
 * `inputAssetId` is present exactly when the tool needs an input image, and unsupported options
 * (negative prompt, seed, strength) are rejected. Never throws for bad input; it reports `errors`.
 */
export function validateGenerationRequest(
  _request: CreateGenerationRequest,
  _env?: GenerationValidationEnv,
): GenerationValidationResult {
  throw new NotImplementedError('validation.validateGenerationRequest');
}
