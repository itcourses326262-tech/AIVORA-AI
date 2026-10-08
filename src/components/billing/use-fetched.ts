'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Fetched<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: unknown };

export interface FetchedHandle<T> {
  state: Fetched<T>;
  /** Asks again; the data already shown stays on screen until the new answer arrives. */
  reload: () => void;
  /** Replaces the data with an answer already known (the result of a write). */
  replace: (data: T) => void;
}

/**
 * Loads one resource when `enabled`, aborting the request when the component goes away or a newer
 * one starts. `load` must be a stable function (a module-level function, not a closure).
 */
export function useFetched<T>(
  load: (signal: AbortSignal) => Promise<T>,
  enabled: boolean = true,
): FetchedHandle<T> {
  const [state, setState] = useState<Fetched<T>>({ status: enabled ? 'loading' : 'idle' });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    loadRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ status: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A failed reload keeps what is already shown; only a first load turns into an error.
        setState((current) =>
          current.status === 'ready' ? current : { status: 'error', error },
        );
      });
    return () => controller.abort();
  }, [enabled, version]);

  const reload = useCallback(() => {
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    setVersion((current) => current + 1);
  }, []);
  const replace = useCallback((data: T) => setState({ status: 'ready', data }), []);

  return { state, reload, replace };
}
