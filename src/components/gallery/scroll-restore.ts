/**
 * Puts the page back where the person left it when they return to the gallery from a detail page.
 *
 * A single `scrollTo` after the first frame is not enough: the masonry only knows its column count
 * after it has measured itself, and until then the page is far taller (every card in one column) than
 * it ends up. Scrolling into that transient layout lands on the right pixel for the wrong layout, and
 * the browser then moves the position when the columns appear. So the target is applied again on
 * every frame until the page has held still, and the loop gives way at once to the person's own
 * scrolling.
 */

/** Frames in a row with the target reached and the page height unchanged before the work is done. */
const STABLE_FRAMES = 12;
/** The longest the page is held in place, in case it never settles (a late image, a slow device). */
const MAX_HOLD_MS = 2500;
/** Events that mean the person has taken over the scroll position. */
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;

/** The furthest the page can scroll right now. */
function maxScrollTop(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

/**
 * Scrolls to `top` and holds it there while the layout settles. Returns a function that stops it
 * early (the view unmounted). A target below the end of the page counts as reached at the end.
 */
export function restoreScroll(top: number): () => void {
  const startedAt = performance.now();
  let frame = 0;
  let lastHeight = -1;
  let stable = 0;

  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of TAKEOVER_EVENTS) window.removeEventListener(type, stop);
  };
  for (const type of TAKEOVER_EVENTS) window.addEventListener(type, stop, { passive: true });

  const step = () => {
    const goal = Math.min(top, maxScrollTop());
    if (Math.abs(window.scrollY - goal) > 1) window.scrollTo({ top, behavior: 'instant' });
    const height = document.documentElement.scrollHeight;
    const reached = Math.abs(window.scrollY - Math.min(top, maxScrollTop())) <= 1;
    stable = reached && height === lastHeight ? stable + 1 : 0;
    lastHeight = height;
    if (stable >= STABLE_FRAMES || performance.now() - startedAt > MAX_HOLD_MS) {
      stop();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return stop;
}
