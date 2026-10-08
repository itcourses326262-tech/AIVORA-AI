import { falModels } from './models/fal';
import { mockModels } from './models/mock';
import { openaiModels } from './models/openai';
import { replicateModels } from './models/replicate';
import type { ModelSpec } from './types';

let cache: { list: ModelSpec[]; byId: Map<string, ModelSpec> } | undefined;

function load() {
  if (cache) return cache;
  const list = [...mockModels, ...openaiModels, ...falModels, ...replicateModels];
  const byId = new Map<string, ModelSpec>();
  for (const model of list) {
    if (byId.has(model.id)) throw new Error(`Duplicate model id in the catalog: "${model.id}"`);
    byId.set(model.id, model);
  }
  cache = { list, byId };
  return cache;
}

/** Every declared model, regardless of whether its provider is configured. */
export function getModels(): ModelSpec[] {
  return [...load().list];
}

export function getModel(id: string): ModelSpec | undefined {
  return load().byId.get(id);
}

export * from './types';
export { computeCost } from './pricing';
export * from './aspect';
