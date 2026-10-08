import { computeCost } from '@/lib/catalog/pricing';
import type { ModelSpec, Resolution } from '@/lib/catalog/types';

export interface CreditSample {
  id: string;
  label: string;
  /** Credits for one generation with the model's default settings (video: a 5 s clip when offered). */
  credits: number;
  /** Video only. */
  seconds?: number;
  resolution?: Resolution;
}

export interface CreditSamples {
  images: CreditSample[];
  videos: CreditSample[];
}

const MAX_SAMPLES_PER_KIND = 3;

/** The clip length every price quotes when a model offers it, so videos compare like for like. */
export const QUOTED_CLIP_SECONDS = 5;

function costOf(model: ModelSpec): CreditSample | null {
  const { limits } = model;
  if (model.kind === 'image') {
    const credits = computeCost(model, { aspectRatio: limits.defaultAspectRatio, count: 1 });
    return { id: model.id, label: model.label, credits };
  }
  const seconds = limits.durations?.includes(QUOTED_CLIP_SECONDS)
    ? QUOTED_CLIP_SECONDS
    : (limits.defaultDuration ?? limits.durations?.[0]);
  const resolution = limits.defaultResolution ?? limits.resolutions?.[0];
  if (seconds === undefined || resolution === undefined) return null;
  const credits = computeCost(model, {
    aspectRatio: limits.defaultAspectRatio,
    count: 1,
    durationSec: seconds,
    resolution,
  });
  return { id: model.id, label: model.label, credits, seconds, resolution };
}

/** Evenly spread picks that always include the cheapest and the most expensive entry. */
function spread<T>(sorted: readonly T[]): T[] {
  if (sorted.length <= MAX_SAMPLES_PER_KIND) return [...sorted];
  const middle = sorted[Math.floor((sorted.length - 1) / 2)] as T;
  return [sorted[0] as T, middle, sorted[sorted.length - 1] as T];
}

function samplesFor(models: readonly ModelSpec[], kind: ModelSpec['kind']): CreditSample[] {
  const pool = models.filter(
    (model) => model.kind === kind && model.tools.includes(`text-to-${kind}`),
  );
  // The Demo models are a way to try the studio without a key, not a price list worth showing,
  // unless they are all there is.
  const real = pool.filter((model) => !model.badges?.includes('demo'));
  const cheapestByLabel = new Map<string, CreditSample>();
  for (const model of real.length > 0 ? real : pool) {
    const sample = costOf(model);
    const known = cheapestByLabel.get(model.label);
    if (sample && (!known || sample.credits < known.credits)) {
      cheapestByLabel.set(model.label, sample);
    }
  }
  return spread([...cheapestByLabel.values()].sort((a, b) => a.credits - b.credits));
}

/**
 * Example prices for the credits section, taken from the model catalog so they never go stale:
 * up to three text-to-image and three text-to-video models, from the cheapest to the dearest.
 */
export function pickCreditSamples(models: readonly ModelSpec[]): CreditSamples {
  return { images: samplesFor(models, 'image'), videos: samplesFor(models, 'video') };
}
