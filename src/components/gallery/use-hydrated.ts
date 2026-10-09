'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * False while the server renders and during hydration, true afterwards. Anything that only the
 * browser can know (the current time, the time zone) belongs behind it, so the markup the server
 * sent is exactly what the first client render produces.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
