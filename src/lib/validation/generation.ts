import { z } from 'zod';
import { ASPECT_RATIOS, RESOLUTIONS, TOOLS } from '@/lib/catalog/types';
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
