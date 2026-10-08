import { useEffect, useState } from 'react';

/**
 * Keeps an element mounted for `exitMs` after `open` turns false so its exit animation can play.
 * `state` is what to put in `data-state`.
 */
export function usePresence(
  open: boolean,
  exitMs: number,
): { mounted: boolean; state: 'open' | 'closed' } {
  const [lingering, setLingering] = useState(open);
  // Re-open immediately; the effect below clears `lingering` after the exit delay.
  if (open && !lingering) setLingering(true);

  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setLingering(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);

  return { mounted: open || lingering, state: open ? 'open' : 'closed' };
}
