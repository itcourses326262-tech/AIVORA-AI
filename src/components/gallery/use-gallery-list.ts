'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { filtersKey, type GalleryFilters } from './filters';
import { fetchGalleryPage, MAX_PAGE_SIZE, PAGE_SIZE } from './gallery-api';
import { initialListState, listReducer, type ListState } from './list-state';

export interface GalleryList {
  state: ListState;
  /** Fetches the first page again (the retry button). */
  reload: () => void;
  /** Fetches the next page; does nothing while one is on its way or there is none. */
  loadMore: () => void;
  /** Replaces generations by id with newer copies. */
  update: (generations: readonly GenerationDTO[]) => void;
  /** Takes generations out of the list. */
  remove: (ids: readonly string[]) => void;
}

/**
 * The user's creations for the given filters, newest first, page by page. A change of filters
 * aborts the request in flight and starts over; the old results stay visible until the new ones
 * arrive. `firstPageSize` applies to the first successful load only: coming back from a detail page
 * asks for as many items as the list had, so the scroll position still points at the same card.
 */
export function useGalleryList(filters: GalleryFilters, firstPageSize = PAGE_SIZE): GalleryList {
  const key = filtersKey(filters);
  const [state, dispatch] = useReducer(listReducer, key, initialListState);
  const [attempt, reload] = useReducer((count: number) => count + 1, 0);

  // The effects below outlive renders; they read the newest filters through this ref.
  const latest = useRef(filters);
  useEffect(() => {
    latest.current = filters;
  });
  const pageSize = useRef(Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, Math.trunc(firstPageSize))));
  const fetching = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetching.current = false;
    dispatch({ type: 'load', key });
    fetchGalleryPage(latest.current, {
      limit: pageSize.current,
      signal: controller.signal,
    }).then(
      (page) => {
        if (controller.signal.aborted) return;
        pageSize.current = PAGE_SIZE;
        dispatch({ type: 'loaded', key, items: page.data, cursor: page.nextCursor });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', key, error });
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const { cursor, status } = state;
  const loadMore = useCallback(() => {
    if (cursor === null || status !== 'ready' || fetching.current) return;
    fetching.current = true;
    dispatch({ type: 'more-start', key });
    fetchGalleryPage(latest.current, { cursor }).then(
      (page) => {
        fetching.current = false;
        dispatch({ type: 'more', key, items: page.data, cursor: page.nextCursor });
      },
      (error: unknown) => {
        fetching.current = false;
        dispatch({ type: 'more-failed', key, error });
      },
    );
  }, [cursor, status, key]);

  return {
    state,
    reload,
    loadMore,
    update: useCallback(
      (generations: readonly GenerationDTO[]) => dispatch({ type: 'update', generations }),
      [],
    ),
    remove: useCallback((ids: readonly string[]) => dispatch({ type: 'remove', ids }), []),
  };
}
