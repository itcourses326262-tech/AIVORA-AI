import type { GenerationParams, ModelSpec } from './types';

// Prices may be fractional (e.g. 0.7 credits per second); rounding away binary noise first keeps
// 0.7 * 10 from becoming 7.000000000000001 and then 8 after `ceil`.
function roundOffNoise(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Credits charged for one request: pure, rounded up, never below 1.
 *
 * Images cost `perImage * count`. Video costs `perSecond[resolution] * durationSec * count`,
 * falling back to the model's default resolution and duration when the params omit them.
 * Params are expected to be validated against the model already, so an unpriced combination
 * (a catalog bug rather than user input) throws a `RangeError`.
 */
export function computeCost(model: ModelSpec, params: GenerationParams): number {
  const { count } = params;
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }

  if (model.pricing.type === 'image') {
    return Math.max(1, Math.ceil(roundOffNoise(model.pricing.perImage * count)));
  }

  const resolution = params.resolution ?? model.limits.defaultResolution;
  const durationSec =
    params.durationSec ?? model.limits.defaultDuration ?? model.limits.durations?.[0];
  if (resolution === undefined || durationSec === undefined) {
    throw new RangeError(`Model ${model.id} needs a resolution and a duration to be priced`);
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError(`durationSec must be positive, got ${durationSec}`);
  }
  const perSecond = model.pricing.perSecond[resolution];
  if (perSecond === undefined) {
    throw new RangeError(`Model ${model.id} has no price for resolution ${resolution}`);
  }
  return Math.max(1, Math.ceil(roundOffNoise(perSecond * durationSec * count)));
}
