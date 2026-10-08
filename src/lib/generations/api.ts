/**
 * The generation endpoints as functions. Every call goes through the shared `api` client, so a
 * failure is an `ApiError` whose `code` the UI maps to text. `signal` cancels a request in flight.
 */
import { api } from '@/lib/api-client';
import type {
  CreateGenerationRequest,
  EnhancePromptRequest,
  EnhancePromptResponse,
  GenerationDTO,
  ModelDTO,
  Page,
  UpdateGenerationRequest,
} from '@/lib/api-types';
import { isValidId } from '@/lib/id';

/** The server accepts this many ids per `?ids=` request. */
export const MAX_POLL_IDS = 50;

/** 24 per page: four rows of a six-column grid, or a screenful on a phone. */
export const DEFAULT_PAGE_SIZE = 24;

export function fetchModels(signal?: AbortSignal): Promise<ModelDTO[]> {
  return api.get<ModelDTO[]>('/models', { signal });
}

export function fetchGenerationPage(
  options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<Page<GenerationDTO>> {
  return api.page<GenerationDTO>('/generations', {
    query: { limit: options.limit ?? DEFAULT_PAGE_SIZE, cursor: options.cursor ?? undefined },
    signal: options.signal,
  });
}

/** The current state of up to {@link MAX_POLL_IDS} generations; ids that no longer exist are absent. */
export async function fetchGenerationsByIds(
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<GenerationDTO[]> {
  const valid = ids.filter((id) => isValidId(id, 'gen')).slice(0, MAX_POLL_IDS);
  if (valid.length === 0) return [];
  const page = await api.page<GenerationDTO>('/generations', { query: { ids: valid }, signal });
  return page.data;
}

export function createGeneration(
  request: CreateGenerationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<GenerationDTO> {
  return api.post<GenerationDTO>('/generations', request, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });
}

export function cancelGeneration(id: string): Promise<GenerationDTO> {
  return api.post<GenerationDTO>(`/generations/${id}/cancel`);
}

export function updateGeneration(
  id: string,
  patch: UpdateGenerationRequest,
): Promise<GenerationDTO> {
  return api.patch<GenerationDTO>(`/generations/${id}`, patch);
}

export function deleteGeneration(id: string): Promise<void> {
  return api.delete(`/generations/${id}`);
}

export function enhancePrompt(
  request: EnhancePromptRequest,
  signal?: AbortSignal,
): Promise<EnhancePromptResponse> {
  return api.post<EnhancePromptResponse>('/prompt/enhance', request, { signal });
}
