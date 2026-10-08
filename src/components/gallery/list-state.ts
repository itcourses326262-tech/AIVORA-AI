import type { GenerationDTO } from '@/lib/api-types';

/**
 * The loaded part of the gallery. `key` names the filters the list belongs to: an answer for other
 * filters (the user typed on while a request was in flight) is ignored instead of replacing newer
 * results.
 */
export interface ListState {
  key: string;
  items: GenerationDTO[];
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** The next page, or null on the last one (and while the first page loads). */
  cursor: string | null;
  loadingMore: boolean;
  /** Set when "load more" failed; the list itself is still fine. */
  moreError: unknown;
}

export type ListAction =
  | { type: 'load'; key: string }
  | { type: 'loaded'; key: string; items: GenerationDTO[]; cursor: string | null }
  | { type: 'failed'; key: string; error: unknown }
  | { type: 'more-start'; key: string }
  | { type: 'more'; key: string; items: GenerationDTO[]; cursor: string | null }
  | { type: 'more-failed'; key: string; error: unknown }
  | { type: 'update'; generations: readonly GenerationDTO[] }
  | { type: 'remove'; ids: readonly string[] };

export function initialListState(key: string): ListState {
  return {
    key,
    items: [],
    status: 'loading',
    error: undefined,
    cursor: null,
    loadingMore: false,
    moreError: undefined,
  };
}

/** Newest first, no id twice: polling and paging can both return the same generation. */
function appendNew(current: GenerationDTO[], more: GenerationDTO[]): GenerationDTO[] {
  const known = new Set(current.map((generation) => generation.id));
  return [...current, ...more.filter((generation) => !known.has(generation.id))];
}

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case 'load':
      // The old results stay on screen (dimmed) until the new ones arrive.
      return {
        ...state,
        key: action.key,
        status: 'loading',
        error: undefined,
        cursor: null,
        loadingMore: false,
        moreError: undefined,
      };
    case 'loaded':
      if (action.key !== state.key) return state;
      return {
        ...state,
        status: 'ready',
        error: undefined,
        items: action.items,
        cursor: action.cursor,
      };
    case 'failed':
      if (action.key !== state.key) return state;
      return { ...state, status: 'error', error: action.error, items: [], cursor: null };
    case 'more-start':
      if (action.key !== state.key) return state;
      return { ...state, loadingMore: true, moreError: undefined };
    case 'more':
      if (action.key !== state.key) return state;
      return {
        ...state,
        loadingMore: false,
        items: appendNew(state.items, action.items),
        cursor: action.cursor,
      };
    case 'more-failed':
      if (action.key !== state.key) return state;
      return { ...state, loadingMore: false, moreError: action.error };
    case 'update': {
      const fresh = new Map(action.generations.map((generation) => [generation.id, generation]));
      let changed = false;
      const items = state.items.map((item) => {
        const next = fresh.get(item.id);
        if (!next) return item;
        changed = true;
        return next;
      });
      return changed ? { ...state, items } : state;
    }
    case 'remove': {
      const gone = new Set(action.ids);
      const items = state.items.filter((item) => !gone.has(item.id));
      return items.length === state.items.length ? state : { ...state, items };
    }
  }
}
