'use client';

import { useCallback, useEffect, useReducer } from 'react';
import { api } from '@/lib/api-client';
import type { ApiKeyDTO } from '@/lib/api-types';

export interface ApiKeysState {
  keys: readonly ApiKeyDTO[];
  status: 'loading' | 'ready' | 'error';
  error: unknown;
  reload: () => void;
  /** Puts a key the server just created at the top of the list. */
  add: (key: ApiKeyDTO) => void;
  /** Shows a key as revoked now, without asking the server for the list again. */
  markRevoked: (id: string) => void;
}

interface State {
  keys: readonly ApiKeyDTO[];
  status: ApiKeysState['status'];
  error: unknown;
}

type Action =
  | { type: 'load' }
  | { type: 'loaded'; keys: readonly ApiKeyDTO[] }
  | { type: 'failed'; error: unknown }
  | { type: 'add'; key: ApiKeyDTO }
  | { type: 'revoked'; id: string; at: number };

const INITIAL: State = { keys: [], status: 'loading', error: null };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return state.status === 'loading' ? state : { ...state, status: 'loading' };
    case 'loaded':
      return { keys: action.keys, status: 'ready', error: null };
    case 'failed':
      return { ...state, status: 'error', error: action.error };
    case 'add':
      return { ...state, keys: [action.key, ...state.keys] };
    case 'revoked':
      return {
        ...state,
        keys: state.keys.map((key) =>
          key.id === action.id ? { ...key, revokedAt: action.at } : key,
        ),
      };
  }
}

/** The account's keys (`GET /keys`: every active key and the latest revoked ones, newest first). */
export function useApiKeys(): ApiKeysState {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const [attempt, reload] = useReducer((count: number) => count + 1, 0);

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'load' });
    api.page<ApiKeyDTO>('/keys', { signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) dispatch({ type: 'loaded', keys: page.data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) dispatch({ type: 'failed', error });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const add = useCallback((key: ApiKeyDTO) => dispatch({ type: 'add', key }), []);
  const markRevoked = useCallback(
    (id: string) => dispatch({ type: 'revoked', id, at: Date.now() }),
    [],
  );

  return { ...state, reload, add, markRevoked };
}
