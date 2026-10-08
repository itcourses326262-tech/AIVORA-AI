'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  neighborsOf,
  parseNavSnapshot,
  readRawNavSnapshot,
  type Neighbors,
  type NavSnapshot,
} from './nav-snapshot';

const subscribe = () => () => {};

/**
 * The list the person came from, read from this tab's storage. Neither the server nor the first
 * client render knows it (both see null), so the markup always matches while hydrating, and the
 * previous / next links appear right after.
 */
export function useNavSnapshot(): NavSnapshot | null {
  const raw = useSyncExternalStore(subscribe, readRawNavSnapshot, () => null);
  return useMemo(() => parseNavSnapshot(raw), [raw]);
}

/** Previous and next of `id` in the remembered list, or null when the person did not come from it. */
export function useNeighbors(id: string): { neighbors: Neighbors | null; backHref: string } {
  const snapshot = useNavSnapshot();
  return {
    neighbors: useMemo(() => neighborsOf(snapshot, id), [snapshot, id]),
    backHref: snapshot?.from ?? '/gallery',
  };
}
