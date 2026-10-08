'use client';

import { useCallback, useEffect, useReducer } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { DEFAULT_PAGE_SIZE, fetchGenerationPage } from '@/lib/generations/api';

/** One card of the canvas. `key` stays the same when an optimistic card becomes the real one. */
export interface FeedItem {
  key: string;
  generation: GenerationDTO;
  /** The request that creates it has not been accepted yet. */
  pending: boolean;
}

export interface FeedState {
  items: FeedItem[];
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  cursor: string | null;
  loadingMore: boolean;
  /** Set when "load more" failed; the list itself is still fine. */
  moreError: unknown;
}

export type FeedAction =
  | { type: 'loading' }
  | { type: 'loaded'; items: GenerationDTO[]; cursor: string | null }
  | { type: 'failed'; error: unknown }
  | { type: 'more-start' }
  | { type: 'more'; items: GenerationDTO[]; cursor: string | null }
  | { type: 'more-failed'; error: unknown }
  | { type: 'add'; item: FeedItem }
  | { type: 'settle'; key: string; generation: GenerationDTO }
  | { type: 'drop'; key: string }
  | { type: 'update'; generations: readonly GenerationDTO[] }
  | { type: 'remove'; ids: readonly string[] };

export const INITIAL_FEED: FeedState = {
  items: [],
  status: 'loading',
  error: undefined,
  cursor: null,
  loadingMore: false,
  moreError: undefined,
};

const asItem = (generation: GenerationDTO): FeedItem => ({
  key: generation.id,
  generation,
  pending: false,
});

/** Newest first, no id twice: a card created in this session may also come back from the server. */
function mergeNewest(local: FeedItem[], fetched: GenerationDTO[]): FeedItem[] {
  const known = new Set(local.map((item) => item.generation.id));
  return [...local, ...fetched.filter((generation) => !known.has(generation.id)).map(asItem)];
}

export function feedReducer(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'loading':
      return { ...state, status: 'loading', error: undefined };
    case 'loaded':
      return {
        ...state,
        status: 'ready',
        error: undefined,
        cursor: action.cursor,
        items: mergeNewest(state.items, action.items),
      };
    case 'failed':
      return { ...state, status: 'error', error: action.error };
    case 'more-start':
      return { ...state, loadingMore: true, moreError: undefined };
    case 'more':
      return {
        ...state,
        loadingMore: false,
        cursor: action.cursor,
        items: mergeNewest(state.items, action.items),
      };
    case 'more-failed':
      return { ...state, loadingMore: false, moreError: action.error };
    case 'add':
      return { ...state, items: [action.item, ...state.items] };
    case 'settle':
      return {
        ...state,
        items: state.items.map((item) =>
          item.key === action.key
            ? { key: item.key, generation: action.generation, pending: false }
            : item,
        ),
      };
    case 'drop':
      return { ...state, items: state.items.filter((item) => item.key !== action.key) };
    case 'update': {
      const fresh = new Map(action.generations.map((generation) => [generation.id, generation]));
      return {
        ...state,
        items: state.items.map((item) => {
          const next = fresh.get(item.generation.id);
          return next ? { ...item, generation: next } : item;
        }),
      };
    }
    case 'remove': {
      const gone = new Set(action.ids);
      return { ...state, items: state.items.filter((item) => !gone.has(item.generation.id)) };
    }
  }
}

export interface GenerationFeed {
  state: FeedState;
  reload: () => void;
  loadMore: () => void;
  /** Puts an optimistic card on top. */
  add: (item: FeedItem) => void;
  /** Swaps the optimistic card for the real generation, keeping its place and key. */
  settle: (key: string, generation: GenerationDTO) => void;
  /** Removes a card by key (the request behind an optimistic card failed). */
  drop: (key: string) => void;
  /** Replaces generations by id with newer copies. */
  update: (generations: readonly GenerationDTO[]) => void;
  /** Removes generations by id. */
  remove: (ids: readonly string[]) => void;
}

/** The user's recent generations, newest first, with "load more" and the edits the studio makes. */
export function useGenerationFeed(pageSize = DEFAULT_PAGE_SIZE): GenerationFeed {
  const [state, dispatch] = useReducer(feedReducer, INITIAL_FEED);

  const [attempt, reload] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'loading' });
    fetchGenerationPage({ limit: pageSize, signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'loaded', items: page.data, cursor: page.nextCursor });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', error });
      },
    );
    return () => controller.abort();
  }, [attempt, pageSize]);

  const { cursor, loadingMore } = state;
  const loadMore = useCallback(() => {
    if (cursor === null || loadingMore) return;
    dispatch({ type: 'more-start' });
    fetchGenerationPage({ limit: pageSize, cursor }).then(
      (page) => dispatch({ type: 'more', items: page.data, cursor: page.nextCursor }),
      (error: unknown) => dispatch({ type: 'more-failed', error }),
    );
  }, [cursor, loadingMore, pageSize]);

  return {
    state,
    reload,
    loadMore,
    add: useCallback((item: FeedItem) => dispatch({ type: 'add', item }), []),
    settle: useCallback(
      (key: string, generation: GenerationDTO) => dispatch({ type: 'settle', key, generation }),
      [],
    ),
    drop: useCallback((key: string) => dispatch({ type: 'drop', key }), []),
    update: useCallback(
      (generations: readonly GenerationDTO[]) => dispatch({ type: 'update', generations }),
      [],
    ),
    remove: useCallback((ids: readonly string[]) => dispatch({ type: 'remove', ids }), []),
  };
}
