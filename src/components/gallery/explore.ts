/**
 * The kind filter of `/explore` as an address: `/explore` shows everything, `/explore?kind=video`
 * only videos. The address is untrusted, so anything but a known kind means "all".
 */
import { KINDS, type Kind } from '@/lib/catalog/types';

export type ExploreKind = 'all' | Kind;

export const EXPLORE_KINDS: readonly ExploreKind[] = ['all', ...KINDS];

type RawParams = Readonly<Record<string, string | string[] | undefined>>;

export function parseExploreKind(params: RawParams): ExploreKind {
  const raw = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  return (KINDS as readonly string[]).includes(raw ?? '') ? (raw as Kind) : 'all';
}

export function exploreHref(kind: ExploreKind = 'all'): string {
  return kind === 'all' ? '/explore' : `/explore?kind=${kind}`;
}

/** Creations per page of the feed: four rows of a five-column grid. */
export const EXPLORE_PAGE_SIZE = 24;
