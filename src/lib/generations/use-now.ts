'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * The current time in milliseconds, refreshed every `intervalMs` while `enabled` (an elapsed timer
 * needs a tick, a finished card does not, so it costs nothing once the work is done).
 */
export function useNow(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);
  return now;
}

// One interval for every card on the page: "2 minutes ago" only needs a fresh time once a minute.
const MINUTE_MS = 60_000;
const clockListeners = new Set<() => void>();
let clockTimer: ReturnType<typeof setInterval> | undefined;
let clockValue = 0;

// A snapshot must not change between two reads, so it is a stored value that only the interval moves.
function readClock(): number {
  if (clockValue === 0) clockValue = Date.now();
  return clockValue;
}

function subscribeClock(listener: () => void): () => void {
  if (clockListeners.size === 0) {
    clockValue = Date.now();
    clockTimer = setInterval(() => {
      clockValue = Date.now();
      for (const notify of clockListeners) notify();
    }, MINUTE_MS);
  }
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
}

/** The time, refreshed once a minute and shared by every component that asks (relative times). */
export function useMinuteClock(): number {
  return useSyncExternalStore(subscribeClock, readClock, readClock);
}
