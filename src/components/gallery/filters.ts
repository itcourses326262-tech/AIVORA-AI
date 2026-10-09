/**
 * What the gallery shows: the filters, how they travel in the address bar (`/gallery?kind=image&q=...`)
 * and how they become a `GET /generations` query. The address is untrusted input, so anything that is
 * not one of the known values is dropped instead of half-applied.
 */
import { GENERATION_STATUSES, type GenerationStatus } from '@/lib/api-types';
import { KINDS, type Kind } from '@/lib/catalog/types';

export type KindFilter = 'all' | Kind;
export type StatusFilter = 'all' | GenerationStatus;

export interface GalleryFilters {
  kind: KindFilter;
  status: StatusFilter;
  /** Only favorites. */
  favorite: boolean;
  /** The search text as it is sent: normalized, never longer than {@link MAX_SEARCH_CHARS}. */
  q: string;
}

export const DEFAULT_FILTERS: GalleryFilters = {
  kind: 'all',
  status: 'all',
  favorite: false,
  q: '',
};

/** The server rejects a longer search (`q` is 1 to 200 characters). */
export const MAX_SEARCH_CHARS = 200;

// Invisible characters that arrive with pasted text and would stop a plain substring match:
// zero-width space, left/right marks, embeddings and isolates, and the byte order mark.
const INVISIBLE = /[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/**
 * The search text as the server should see it: one Unicode form (an Arabic letter typed with a
 * combining mark equals the precomposed one), no invisible direction marks, single spaces, trimmed,
 * at most {@link MAX_SEARCH_CHARS} characters as a person counts them.
 */
export function normalizeSearch(text: string): string {
  const flat = text.normalize('NFC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return Array.from(flat).slice(0, MAX_SEARCH_CHARS).join('').trim();
}

type RawParams = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isKind(value: string | undefined): value is Kind {
  return (KINDS as readonly string[]).includes(value ?? '');
}

function isStatus(value: string | undefined): value is GenerationStatus {
  return (GENERATION_STATUSES as readonly string[]).includes(value ?? '');
}

/** Reads the filters out of the page's search params. */
export function parseGalleryFilters(params: RawParams): GalleryFilters {
  const kind = first(params.kind);
  const status = first(params.status);
  const favorite = first(params.favorite);
  return {
    kind: isKind(kind) ? kind : 'all',
    status: isStatus(status) ? status : 'all',
    favorite: favorite === '1' || favorite === 'true',
    q: normalizeSearch(first(params.q) ?? ''),
  };
}

/** `/gallery` plus the filters that differ from the defaults, in a fixed order. */
export function galleryHref(filters: GalleryFilters = DEFAULT_FILTERS): string {
  const query = new URLSearchParams();
  if (filters.kind !== 'all') query.set('kind', filters.kind);
  if (filters.status !== 'all') query.set('status', filters.status);
  if (filters.favorite) query.set('favorite', '1');
  if (filters.q !== '') query.set('q', filters.q);
  const text = query.toString();
  return text ? `/gallery?${text}` : '/gallery';
}

/** Equal filters give equal keys: it tells one list from another. */
export function filtersKey(filters: GalleryFilters): string {
  return galleryHref(filters);
}

/** True when something narrows the list (the "no results" empty state versus "no creations yet"). */
export function isFiltered(filters: GalleryFilters): boolean {
  return filters.kind !== 'all' || filters.status !== 'all' || filters.favorite || filters.q !== '';
}

/** The query of `GET /generations` for these filters; unset filters are left out. */
export function toListQuery(
  filters: GalleryFilters,
  paging: { limit: number; cursor?: string | null },
): Record<string, string | number | boolean | undefined> {
  return {
    kind: filters.kind === 'all' ? undefined : filters.kind,
    status: filters.status === 'all' ? undefined : filters.status,
    favorite: filters.favorite ? true : undefined,
    q: filters.q === '' ? undefined : filters.q,
    limit: paging.limit,
    cursor: paging.cursor ?? undefined,
  };
}
