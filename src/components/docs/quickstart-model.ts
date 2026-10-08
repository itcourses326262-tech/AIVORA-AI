import type { ModelDTO } from '@/lib/api-types';
import { computeCost, getModel } from '@/lib/catalog';
import type { AspectRatio } from '@/lib/catalog/types';

export interface QuickstartModel {
  modelId: string;
  aspectRatio: AspectRatio;
  /** Credits one image of this model costs at that ratio. */
  cost: number;
  /** False when no image model can be used on this deployment right now. */
  usable: boolean;
}

const PREFERRED_RATIO: AspectRatio = '16:9';

/**
 * The model the quickstart code uses: the first text-to-image model the deployment can actually
 * run (the list comes sorted with available models first), so the examples work as pasted.
 */
export function pickQuickstartModel(models: readonly ModelDTO[]): QuickstartModel | undefined {
  const candidates = models.filter((model) => model.tools.includes('text-to-image'));
  const model = candidates.find((candidate) => candidate.available) ?? candidates[0];
  if (!model) return undefined;
  const aspectRatio = model.limits.aspectRatios.includes(PREFERRED_RATIO)
    ? PREFERRED_RATIO
    : model.limits.defaultAspectRatio;
  // The price comes from the catalog entry the DTO was made from, so it can never disagree with it.
  const spec = getModel(model.id);
  return {
    modelId: model.id,
    aspectRatio,
    cost: spec ? computeCost(spec, { aspectRatio, count: 1 }) : 1,
    usable: model.available,
  };
}
