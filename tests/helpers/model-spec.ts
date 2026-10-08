import { computeCost } from '@/lib/catalog/pricing';
import { PROVIDER_IDS, type ModelSpec } from '@/lib/catalog/types';
import { getTool } from '@/lib/tools';

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
  return problems;
}
