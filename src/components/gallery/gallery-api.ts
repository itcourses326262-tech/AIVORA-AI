/**
 * The gallery's own calls. Updating, deleting and cancelling are shared with the studio
 * (`@/lib/generations/api`); listing with filters and the public feed are the gallery's.
 */
import { api } from '@/lib/api-client';
import type { GenerationDTO, Kind, Page } from '@/lib/api-types';
import { toListQuery, type GalleryFilters } from './filters';

/** 24 per page: four rows of a six-column grid, or a screenful on a phone. */
export const PAGE_SIZE = 24;

/** The server answers at most this many rows per page. */
export const MAX_PAGE_SIZE = 100;

export function fetchGalleryPage(
  filters: GalleryFilters,
  options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<Page<GenerationDTO>> {
  return api.page<GenerationDTO>('/generations', {
    query: toListQuery(filters, { limit: options.limit ?? PAGE_SIZE, cursor: options.cursor }),
    signal: options.signal,
  });
}

/** One page of the public feed (`GET /explore`, no account needed). */
export function fetchExplorePage(
  options: { kind?: Kind; limit?: number; cursor?: string | null; signal?: AbortSignal } = {},
): Promise<Page<GenerationDTO>> {
  return api.page<GenerationDTO>('/explore', {
    query: { kind: options.kind, limit: options.limit ?? PAGE_SIZE, cursor: options.cursor },
    signal: options.signal,
  });
}
