'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { api } from '@/lib/api-client';
import type { LedgerEntryDTO } from '@/lib/api-types';

/** How many entries one request brings. */
export const LEDGER_PAGE_SIZE = 20;

export interface LedgerState {
  entries: readonly LedgerEntryDTO[];
  /** `loading`: the first page is on its way; `ready`: it arrived; `error`: it did not. */
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** Whether another page exists. */
  hasMore: boolean;
  /** A next page is being fetched. */
  busy: boolean;
  /** The next page failed: the entries already shown stay, and a retry is offered. */
  moreFailed: boolean;
  /** Fetches the next page (also the way to try again after `moreFailed`). */
  loadMore: () => void;
  /** Fetches the first page again after it failed. */
  retry: () => void;
}

interface State {
  entries: readonly LedgerEntryDTO[];
  cursor: string | null;
  status: LedgerState['status'];
  error: unknown;
  busy: boolean;
  moreFailed: boolean;
}

type Page = { data: LedgerEntryDTO[]; nextCursor: string | null };

type Action =
  | { type: 'first-start' }
  | { type: 'first-loaded'; page: Page }
  | { type: 'first-failed'; error: unknown }
  | { type: 'more-start' }
  | { type: 'more-loaded'; page: Page }
  | { type: 'more-failed'; error: unknown };

const INITIAL: State = {
  entries: [],
  cursor: null,
  status: 'loading',
  error: null,
  busy: false,
  moreFailed: false,
};

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'first-start':
      return state.status === 'loading' ? state : { ...INITIAL };
    case 'first-loaded':
      return {
        ...INITIAL,
        entries: action.page.data,
        cursor: action.page.nextCursor,
        status: 'ready',
      };
    case 'first-failed':
      return { ...INITIAL, status: 'error', error: action.error };
    case 'more-start':
      return { ...state, busy: true, moreFailed: false };
    case 'more-loaded':
      return {
        ...state,
        entries: [...state.entries, ...action.page.data],
        cursor: action.page.nextCursor,
        busy: false,
      };
    case 'more-failed':
      return { ...state, busy: false, moreFailed: true, error: action.error };
  }
}

/**
 * The credit history, newest first, a page at a time with the server's cursor. A failure of the
 * first page replaces the list with an error to retry; a failure of a later page keeps what is
 * shown. Requests are cancelled when the panel goes away.
 */
export function useLedger(): LedgerState {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [attempt, retry] = useReducer((count: number) => count + 1, 0);
  const next = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    next.current?.abort();
    dispatch({ type: 'first-start' });
    api
      .page<LedgerEntryDTO>('/account/ledger', {
        query: { limit: LEDGER_PAGE_SIZE },
        signal: controller.signal,
      })
      .then(
        (page) => {
          if (!controller.signal.aborted) dispatch({ type: 'first-loaded', page });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) dispatch({ type: 'first-failed', error });
        },
      );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => () => next.current?.abort(), []);

  const { cursor, busy } = state;
  const loadMore = useCallback(() => {
    if (cursor === null || busy) return;
    const controller = new AbortController();
    next.current = controller;
    dispatch({ type: 'more-start' });
    api
      .page<LedgerEntryDTO>('/account/ledger', {
        query: { limit: LEDGER_PAGE_SIZE, cursor },
        signal: controller.signal,
      })
      .then(
        (page) => {
          if (!controller.signal.aborted) dispatch({ type: 'more-loaded', page });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) dispatch({ type: 'more-failed', error });
        },
      );
  }, [cursor, busy]);

  return {
    entries: state.entries,
    status: state.status,
    error: state.error,
    hasMore: cursor !== null,
    busy,
    moreFailed: state.moreFailed,
    loadMore,
    retry,
  };
}
