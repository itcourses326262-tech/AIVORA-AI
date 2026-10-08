'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_FILTERS,
  galleryHref,
  normalizeSearch,
  type GalleryFilters,
  type KindFilter,
  type StatusFilter,
} from './filters';

/** How long typing must pause before the search is sent (the server limits searches to 60 a minute). */
export const SEARCH_DEBOUNCE_MS = 400;

export interface GalleryFilterControls {
  /** The filters the list is loaded with. */
  applied: GalleryFilters;
  /** What the search box shows: ahead of `applied.q` while the person is still typing. */
  searchText: string;
  setSearchText: (text: string) => void;
  /** Sends the search now (Enter) instead of waiting for a pause. */
  submitSearch: () => void;
  setKind: (kind: KindFilter) => void;
  setStatus: (status: StatusFilter) => void;
  setFavorite: (favorite: boolean) => void;
  clearAll: () => void;
}

/**
 * The gallery's filters. The kind, status and favorites apply at once; the search text is debounced.
 * The address bar follows (`replaceState`, no history entries) so a filtered view can be reloaded,
 * bookmarked and returned to.
 */
export function useGalleryFilters(initial: GalleryFilters): GalleryFilterControls {
  const [applied, setApplied] = useState(initial);
  const [searchText, setSearchText] = useState(initial.q);

  useEffect(() => {
    const next = normalizeSearch(searchText);
    if (next === applied.q) return;
    const timer = setTimeout(
      () => setApplied((current) => ({ ...current, q: next })),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchText, applied.q]);

  useEffect(() => {
    const href = galleryHref(applied);
    if (`${window.location.pathname}${window.location.search}` !== href) {
      window.history.replaceState(window.history.state, '', href);
    }
  }, [applied]);

  const submitSearch = useCallback(() => {
    const next = normalizeSearch(searchText);
    setApplied((current) => (current.q === next ? current : { ...current, q: next }));
  }, [searchText]);

  return {
    applied,
    searchText,
    setSearchText,
    submitSearch,
    setKind: useCallback((kind) => setApplied((current) => ({ ...current, kind })), []),
    setStatus: useCallback((status) => setApplied((current) => ({ ...current, status })), []),
    setFavorite: useCallback((favorite) => setApplied((current) => ({ ...current, favorite })), []),
    clearAll: useCallback(() => {
      setSearchText('');
      setApplied(DEFAULT_FILTERS);
    }, []),
  };
}
