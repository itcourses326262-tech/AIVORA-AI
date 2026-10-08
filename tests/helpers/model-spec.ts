import { computeCost } from '@/lib/catalog/pricing';
import { PROVIDER_IDS, type GenerationParams, type ModelSpec } from '@/lib/catalog/types';
import { getTool } from '@/lib/tools';

/** Section 5: image models offer 1-4 images per request. */
const MAX_IMAGE_COUNT = 4;

/**
 * Every request the validator would accept for this model: each count for an image model, each
 * allowed duration at each allowed resolution for a video model. Pricing must cover all of them,
 * otherwise `createGeneration` would pass validation and then fail while computing the cost.
 */
function acceptedRequests(model: ModelSpec): GenerationParams[] {
  const { limits } = model;
  const base = { aspectRatio: limits.defaultAspectRatio };
  if (model.kind === 'image') {
    const counts = Math.max(0, Math.min(Math.trunc(limits.maxCount), 2 * MAX_IMAGE_COUNT));
    return Array.from({ length: counts }, (_, index) => ({ ...base, count: index + 1 }));
  }
  return (limits.durations ?? []).flatMap((durationSec) =>
    (limits.resolutions ?? []).map((resolution) => ({
      ...base,
      count: 1,
      durationSec,
      resolution,
    })),
  );
}

function describeRequest(params: GenerationParams): string {
  return params.resolution === undefined
    ? `a request for ${params.count} image(s)`
    : `a ${params.durationSec}s ${params.resolution} request`;
}

/** One problem per accepted request that cannot be priced to a positive whole number of credits. */
function pricingProblems(model: ModelSpec): string[] {
  const problems: string[] = [];
  for (const params of acceptedRequests(model)) {
    try {
      const cost = computeCost(model, params);
      if (!Number.isInteger(cost) || cost < 1) {
        problems.push(`${describeRequest(params)} costs ${cost}`);
      }
    } catch (error) {
      problems.push(`${describeRequest(params)} cannot be priced: ${(error as Error).message}`);
    }
  }
  return problems;
}

/**
 * Internal-consistency problems of a model declaration (empty when it is sound). Provider owners
 * can assert `expect(modelSpecProblems(model)).toEqual([])` for the models they add.
 */
export function modelSpecProblems(model: ModelSpec): string[] {
  const problems: string[] = [];
  const { limits } = model;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(model.id)) problems.push('id must be lowercase kebab-case');
  if (!PROVIDER_IDS.includes(model.provider)) problems.push(`unknown provider ${model.provider}`);
  if (model.providerModel.trim() === '') problems.push('providerModel is empty');
  if (model.label.trim() === '') problems.push('label is empty');

  if (model.tools.length === 0) problems.push('serves no tools');
  for (const tool of model.tools) {
    if (getTool(tool)?.kind !== model.kind)
      problems.push(`tool ${tool} is not of kind ${model.kind}`);
  }

  if (model.description.en.trim() === '') problems.push('English description is empty');
  if (!/[؀-ۿ]/.test(model.description.ar)) problems.push('Arabic description has no Arabic text');

  if (!limits.aspectRatios.includes(limits.defaultAspectRatio)) {
    problems.push('defaultAspectRatio is not an allowed aspect ratio');
  }
  if (limits.maxPromptChars < 1) problems.push('maxPromptChars must be positive');
  if (limits.defaultCount < 1 || limits.defaultCount > limits.maxCount) {
    problems.push('defaultCount is outside 1..maxCount');
  }
  if (model.kind === 'video' && limits.maxCount !== 1)
    problems.push('video models must have maxCount 1');
  if (
    model.kind === 'image' &&
    (!Number.isInteger(limits.maxCount) || limits.maxCount < 1 || limits.maxCount > MAX_IMAGE_COUNT)
  ) {
    problems.push(`image models must have an integer maxCount from 1 to ${MAX_IMAGE_COUNT}`);
  }
  if (model.kind === 'video') {
    if (!limits.durations?.length) problems.push('video models must list durations');
    if (!limits.resolutions?.length) problems.push('video models must list resolutions');
  }
  if (limits.defaultDuration !== undefined && !limits.durations?.includes(limits.defaultDuration)) {
    problems.push('defaultDuration is not an allowed duration');
  }
  if (
    limits.defaultResolution !== undefined &&
    !limits.resolutions?.includes(limits.defaultResolution)
  ) {
    problems.push('defaultResolution is not an allowed resolution');
  }

  if (model.pricing.type !== model.kind)
    problems.push(`pricing type ${model.pricing.type} does not match kind`);
  try {
    const cost = computeCost(model, {
      aspectRatio: limits.defaultAspectRatio,
      count: limits.defaultCount,
      durationSec: limits.defaultDuration,
      resolution: limits.defaultResolution,
    });
    if (!Number.isInteger(cost) || cost < 1) problems.push(`default request costs ${cost}`);
  } catch (error) {
    problems.push(`default request cannot be priced: ${(error as Error).message}`);
  }
  problems.push(...pricingProblems(model));
  return problems;
}
