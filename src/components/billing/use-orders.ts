'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { OrderDTO, Page } from '@/lib/api-types';
import { fetchOrders } from './api';

export interface OrdersState {
  orders: readonly OrderDTO[];
  /** `loading`: the first page is on its way; `ready`: it arrived; `error`: it did not. */
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  /** Whether another page exists. */
  hasMore: boolean;
  /** A next page is being fetched. */
  busy: boolean;
  /** The next page failed: the orders already shown stay, and a retry is offered. */
  moreFailed: boolean;
  /** Fetches the next page (also the way to try again after `moreFailed`). */
  loadMore: () => void;
  /** Reads the first page again: after a failure, or after something changed the orders. */
  reload: () => void;
}

interface State {
  orders: readonly OrderDTO[];
  cursor: string | null;
  status: OrdersState['status'];
  error: unknown;
  busy: boolean;
  moreFailed: boolean;
}

type Action =
  | { type: 'first-start' }
  | { type: 'first-loaded'; page: Page<OrderDTO> }
  | { type: 'first-failed'; error: unknown }
  | { type: 'more-start' }
  | { type: 'more-loaded'; page: Page<OrderDTO> }
  | { type: 'more-failed'; error: unknown };

const INITIAL: State = {
  orders: [],
  cursor: null,
  status: 'loading',
  error: null,
  busy: false,
  moreFailed: false,
};

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'first-start':
      // A reload keeps what is on screen until the new answer arrives (and drops a next-page
      // request it has just cancelled).
      return state.status === 'ready'
        ? { ...state, busy: false, moreFailed: false }
        : { ...INITIAL };
    case 'first-loaded':
      return {
        ...INITIAL,
        orders: action.page.data,
        cursor: action.page.nextCursor,
        status: 'ready',
      };
    case 'first-failed':
      // A failed reload of a list that is already shown must not wipe it.
      return state.status === 'ready'
        ? state
        : { ...INITIAL, status: 'error', error: action.error };
    case 'more-start':
      return { ...state, busy: true, moreFailed: false };
    case 'more-loaded': {
      const known = new Set(state.orders.map((order) => order.id));
      return {
        ...state,
        orders: [...state.orders, ...action.page.data.filter((order) => !known.has(order.id))],
        cursor: action.page.nextCursor,
        busy: false,
      };
    }
    case 'more-failed':
      return { ...state, busy: false, moreFailed: true, error: action.error };
  }
}

/**
 * The buyer's orders, newest first, a page at a time with the server's cursor. A failure of the
 * first page replaces the list with an error to retry; a failure of a later page keeps what is
 * shown. Requests are cancelled when the list goes away or is read again.
 */
export function useOrders(): OrdersState {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [attempt, reload] = useReducer((count: number) => count + 1, 0);
  const more = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    more.current?.abort();
    dispatch({ type: 'first-start' });
    fetchOrders(undefined, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: 'first-loaded', page });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'first-failed', error });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => () => more.current?.abort(), []);

  const { cursor, busy } = state;
  const loadMore = useCallback(() => {
    if (cursor === null || busy) return;
    const controller = new AbortController();
    more.current = controller;
    dispatch({ type: 'more-start' });
    fetchOrders(cursor, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: 'more-loaded', page });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'more-failed', error });
      },
    );
  }, [cursor, busy]);

  return {
    orders: state.orders,
    status: state.status,
    error: state.error,
    hasMore: cursor !== null,
    busy,
    moreFailed: state.moreFailed,
    loadMore,
    reload,
  };
}
