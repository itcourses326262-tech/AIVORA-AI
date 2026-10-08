import { z } from 'zod';
import type { CreateGenerationRequest, ValidationIssue } from '@/lib/api-types';
import { computeCost, getModel } from '@/lib/catalog';
import {
  ASPECT_RATIOS,
  RESOLUTIONS,
  TOOLS,
  type GenerationParams,
  type ModelSpec,
} from '@/lib/catalog/types';
import { isValidId } from '@/lib/id';
import { getTool, isTool } from '@/lib/tools';
import { isRecord } from '@/lib/utils';
import {
  normalizeParams,
  type GenerationValidationCode,
  type ReportIssue,
} from './generation-params';

export { defaultParamsFor, type GenerationValidationCode } from './generation-params';

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

/**
 * `path` is the request field (`prompt`, `params.count`, `inputAssetId`, ...), the same name
 * `ValidationDetails.issues` uses; `code` is a stable machine-readable reason.
 */
export interface GenerationValidationIssue extends ValidationIssue {
  code: GenerationValidationCode;
}

export type GenerationValidationResult =
  | {
      ok: true;
      model: ModelSpec;
      /** The prompt, trimmed. */
      prompt: string;
      /** Trimmed; absent when the request had none or only whitespace. */
      negativePrompt?: string;
      /** Defaults filled in; every value is one the model allows. */
      params: GenerationParams;
      /** Credits the request will cost (`computeCost` of the normalized params). */
      cost: number;
    }
  | { ok: false; errors: GenerationValidationIssue[] };

const REQUEST_KEYS = [
  'tool',
  'modelId',
  'prompt',
  'negativePrompt',
  'params',
  'inputAssetId',
  'isPublic',
];

/** Prompt length in characters as a person counts them: an emoji is one, not two UTF-16 units. */
function lengthOf(text: string): number {
  let count = 0;
  for (const _char of text) count += 1;
  return count;
}

function checkText(
  value: unknown,
  field: 'prompt' | 'negativePrompt',
  maxChars: number | undefined,
  report: ReportIssue,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    report(field, 'invalid_type', `${field} must be a string`);
    return undefined;
  }
  const text = value.trim();
  if (maxChars !== undefined && lengthOf(text) > maxChars) {
    report(field, 'too_long', `${field} must be at most ${maxChars} characters for this model`);
  }
  return text;
}

function validateRequest(
  request: unknown,
  findModel: (id: string) => ModelSpec | undefined,
): GenerationValidationResult {
  if (!isRecord(request)) {
    return {
      ok: false,
      errors: [{ path: '', code: 'invalid_request', message: 'Request must be an object' }],
    };
  }
  const errors: GenerationValidationIssue[] = [];
  const report: ReportIssue = (path, code, message) => errors.push({ path, code, message });

  for (const key of Object.keys(request)) {
    if (!REQUEST_KEYS.includes(key)) report(key, 'unknown_field', 'Unknown field');
  }

  const tool = isTool(request.tool) ? request.tool : undefined;
  if (tool === undefined) {
    report('tool', 'unknown_tool', `tool must be one of ${TOOLS.join(', ')}`);
  }

  const modelId = typeof request.modelId === 'string' ? request.modelId.trim() : '';
  const model = modelId === '' ? undefined : findModel(modelId);
  if (model === undefined) {
    if (modelId === '') report('modelId', 'required', 'modelId is required');
    else report('modelId', 'unknown_model', `Unknown model "${modelId.slice(0, 100)}"`);
  } else if (tool !== undefined && !model.tools.includes(tool)) {
    report('modelId', 'model_tool_mismatch', `Model "${model.id}" does not support ${tool}`);
  }

  const prompt = checkText(request.prompt, 'prompt', model?.limits.maxPromptChars, report);
  if (request.prompt === undefined || prompt === '') {
    report('prompt', 'required', 'prompt must not be empty');
  }

  let negativePrompt = checkText(
    request.negativePrompt,
    'negativePrompt',
    model?.limits.supportsNegativePrompt ? model.limits.maxPromptChars : undefined,
    report,
  );
  if (negativePrompt === '') negativePrompt = undefined;
  else if (negativePrompt !== undefined && model && !model.limits.supportsNegativePrompt) {
    report('negativePrompt', 'unsupported', 'This model does not support a negative prompt');
  }

  const needsImage = tool === undefined ? undefined : getTool(tool)?.needsInputImage;
  let params: GenerationParams | undefined;
  if (model !== undefined) {
    params = normalizeParams(request.params, model, tool, needsImage, report);
  } else if (request.params !== undefined && !isRecord(request.params)) {
    report('params', 'invalid_type', 'params must be an object');
  }

  const { inputAssetId } = request;
  if (inputAssetId !== undefined && (typeof inputAssetId !== 'string' || inputAssetId === '')) {
    report('inputAssetId', 'invalid_type', 'inputAssetId must be an asset id');
  } else if (needsImage === true && inputAssetId === undefined) {
    report('inputAssetId', 'required', `${tool} needs an input image (inputAssetId)`);
  } else if (needsImage === false && inputAssetId !== undefined) {
    report('inputAssetId', 'unsupported', `${tool} does not take an input image`);
  }

  if (request.isPublic !== undefined && typeof request.isPublic !== 'boolean') {
    report('isPublic', 'invalid_type', 'isPublic must be true or false');
  }

  let cost = 0;
  if (errors.length === 0 && model !== undefined && params !== undefined) {
    try {
      cost = computeCost(model, params);
    } catch {
      // A catalog entry that validates but cannot be priced is a declaration bug, not user input.
      report('params', 'unpriced', 'This combination of options is not available');
    }
  }

  if (errors.length > 0 || model === undefined || params === undefined || prompt === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    model,
    prompt,
    ...(negativePrompt === undefined ? {} : { negativePrompt }),
    params,
    cost,
  };
}

/**
 * Checks a request against the model catalog: the model exists and serves the tool, the prompt is
 * within the model's length, the aspect ratio, duration, resolution and count are allowed,
 * `inputAssetId` is present exactly when the tool needs an input image, and unsupported options
 * (negative prompt, seed, strength) are rejected. Never throws for bad input; it reports `errors`,
 * all of them at once, in request-field order.
 */
export function validateGenerationRequest(
  request: CreateGenerationRequest,
  env: GenerationValidationEnv = {},
): GenerationValidationResult {
  return validateRequest(request, (id) => {
    const model = getModel(id);
    return model?.provider === 'mock' && env.ENABLE_MOCK_PROVIDER === false ? undefined : model;
  });
}

/**
 * The same checks for a model you already hold, e.g. a client previewing a request before it is
 * sent. `request.modelId` must name `model`.
 */
export function validateForModel(
  request: CreateGenerationRequest,
  model: ModelSpec,
): GenerationValidationResult {
  return validateRequest(request, (id) => (id === model.id ? model : undefined));
}
