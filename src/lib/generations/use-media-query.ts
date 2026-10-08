'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches. It is `null` on the server and during hydration (the answer
 * is only known in the browser), so a page that lays itself out from it renders a neutral
 * placeholder first instead of guessing and flashing the wrong layout. `fallback` is the answer in
 * an environment without `matchMedia` (jsdom).
 */
export function useMediaQuery(query: string, fallback = false): boolean | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : fallback),
    [query, fallback],
  );
  return useSyncExternalStore<boolean | null>(subscribe, getSnapshot, () => null);
}

/** True when the user asked the system to reduce motion (also false until known). */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)') === true;
}
