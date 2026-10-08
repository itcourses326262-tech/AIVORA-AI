import { isAspectRatio } from '@/lib/catalog/aspect';
import type { GenerationParams, ModelSpec, Tool } from '@/lib/catalog/types';
import { isRecord } from '@/lib/utils';

export type GenerationValidationCode =
  | 'invalid_request'
  | 'invalid_type'
  | 'required'
  | 'unknown_field'
  | 'unknown_tool'
  | 'unknown_model'
  | 'model_tool_mismatch'
  | 'too_long'
  | 'not_allowed'
  | 'out_of_range'
  | 'unsupported'
  | 'unpriced';

export type ReportIssue = (path: string, code: GenerationValidationCode, message: string) => void;

const PARAM_KEYS = ['aspectRatio', 'count', 'durationSec', 'resolution', 'seed', 'strength'];
const MAX_SEED = 4_294_967_295;

/** What a request that names no parameters runs with on `model`. */
export function defaultParamsFor(model: ModelSpec): GenerationParams {
  const { limits } = model;
  const params: GenerationParams = {
    aspectRatio: limits.defaultAspectRatio,
    count: limits.defaultCount,
  };
  const durationSec = limits.defaultDuration ?? limits.durations?.[0];
  if (limits.durations?.length && durationSec !== undefined) params.durationSec = durationSec;
  const resolution = limits.defaultResolution ?? limits.resolutions?.[0];
  if (limits.resolutions?.length && resolution !== undefined) params.resolution = resolution;
  return params;
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Checks `raw` (the request's `params`) against the model's allowed sets and returns the
 * normalized params with defaults filled. Problems go to `report`; the return value is then only
 * meaningful when nothing was reported. Options the model does not offer are errors rather than
 * being dropped, so a client never believes a seed or negative prompt was honoured when it was not.
 */
export function normalizeParams(
  raw: unknown,
  model: ModelSpec,
  tool: Tool | undefined,
  toolNeedsImage: boolean | undefined,
  report: ReportIssue,
): GenerationParams {
  const params = defaultParamsFor(model);
  if (raw === undefined) return params;
  if (!isRecord(raw)) {
    report('params', 'invalid_type', 'params must be an object');
    return params;
  }
  const { limits } = model;
  for (const key of Object.keys(raw)) {
    if (!PARAM_KEYS.includes(key)) report(`params.${key}`, 'unknown_field', 'Unknown parameter');
  }

  const { aspectRatio, count, durationSec, resolution, seed, strength } = raw;

  if (aspectRatio !== undefined) {
    if (isAspectRatio(aspectRatio) && limits.aspectRatios.includes(aspectRatio)) {
      params.aspectRatio = aspectRatio;
    } else {
      report(
        'params.aspectRatio',
        'not_allowed',
        `aspectRatio must be one of ${limits.aspectRatios.join(', ')} for this model`,
      );
    }
  }

  if (count !== undefined) {
    if (isWhole(count) && count >= 1 && count <= limits.maxCount) {
      params.count = count;
    } else {
      report(
        'params.count',
        typeof count === 'number' ? 'out_of_range' : 'invalid_type',
        limits.maxCount === 1
          ? 'count must be 1 for this model'
          : `count must be a whole number from 1 to ${limits.maxCount}`,
      );
    }
  }

  if (durationSec !== undefined) {
    if (!limits.durations?.length) {
      report('params.durationSec', 'unsupported', 'This model does not take a duration');
    } else if (typeof durationSec === 'number' && limits.durations.includes(durationSec)) {
      params.durationSec = durationSec;
    } else {
      report(
        'params.durationSec',
        'not_allowed',
        `durationSec must be one of ${limits.durations.join(', ')} for this model`,
      );
    }
  }

  if (resolution !== undefined) {
    if (!limits.resolutions?.length) {
      report('params.resolution', 'unsupported', 'This model does not take a resolution');
    } else if (
      typeof resolution === 'string' &&
      (limits.resolutions as readonly string[]).includes(resolution)
    ) {
      params.resolution = resolution as GenerationParams['resolution'];
    } else {
      report(
        'params.resolution',
        'not_allowed',
        `resolution must be one of ${limits.resolutions.join(', ')} for this model`,
      );
    }
  }

  if (seed !== undefined) {
    if (!limits.supportsSeed) {
      report('params.seed', 'unsupported', 'This model does not support a seed');
    } else if (isWhole(seed) && seed >= 0 && seed <= MAX_SEED) {
      params.seed = seed;
    } else {
      report(
        'params.seed',
        typeof seed === 'number' ? 'out_of_range' : 'invalid_type',
        `seed must be a whole number from 0 to ${MAX_SEED}`,
      );
    }
  }

  if (strength !== undefined) {
    if (!limits.supportsStrength) {
      report('params.strength', 'unsupported', 'This model does not support strength');
    } else if (tool !== undefined && toolNeedsImage === false) {
      report(
        'params.strength',
        'unsupported',
        'strength only applies to tools with an input image',
      );
    } else if (typeof strength === 'number' && strength >= 0 && strength <= 1) {
      params.strength = strength;
    } else {
      report(
        'params.strength',
        typeof strength === 'number' ? 'out_of_range' : 'invalid_type',
        'strength must be a number from 0 to 1',
      );
    }
  }

  return params;
}
