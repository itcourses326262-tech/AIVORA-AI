import type { ModelDTO } from '@/lib/api-types';
import { getModels } from '@/lib/catalog';
import { KINDS, type ModelSpec } from '@/lib/catalog/types';
import type { Env } from '@/server/env';
import { isProviderAvailable } from '@/server/providers/registry';

function toModelDTO(model: ModelSpec, env: Env): ModelDTO {
  // The upstream model id is an implementation detail of the provider adapter.
  const { providerModel: _providerModel, ...rest } = model;
  const available = isProviderAvailable(model.provider, env);
  return { ...rest, available, ...(available ? {} : { unavailableReason: 'not_configured' }) };
}

/** Available models first, then images before videos, then by label (ties by id). */
function byListingOrder(a: ModelDTO, b: ModelDTO): number {
  if (a.available !== b.available) return a.available ? -1 : 1;
  const kind = KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind);
  if (kind !== 0) return kind;
  return (
    a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** What `GET /models` returns: Demo models only while `ENABLE_MOCK_PROVIDER` is on. */
export function listModelDTOs(env: Env): ModelDTO[] {
  return getModels()
    .filter((model) => model.provider !== 'mock' || env.ENABLE_MOCK_PROVIDER)
    .map((model) => toModelDTO(model, env))
    .sort(byListingOrder);
}
