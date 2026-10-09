import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreScroll } from '@/components/gallery/scroll-restore';

/**
 * A page whose height and scroll position the test controls. `scrollTo` is clamped to the end of
 * the page like a browser does, which is what lost the position in the gallery: asked to go to 1200
 * while the masonry was still one tall column, the page then shrank and moved.
 */
function fakePage(initialHeight: number) {
  const page = { height: initialHeight, scrollY: 0, viewport: 800 };
  const clamp = (top: number) =>
    Math.min(Math.max(0, top), Math.max(0, page.height - page.viewport));
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockImplementation(() => page.height);
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => page.viewport);
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => page.scrollY);
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    page.scrollY = clamp(options.top ?? 0);
  });
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  return {
    page,
    scrollTo,
    /** The layout changes: the browser keeps the position inside the new page. */
    resize(height: number) {
      page.height = height;
      page.scrollY = clamp(page.scrollY);
    },
  };
}

/** Runs `count` animation frames, 16 ms apart. */
async function frames(count: number) {
  for (let index = 0; index < count; index += 1) await vi.advanceTimersByTimeAsync(16);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('restoreScroll', () => {
  it('scrolls to the saved position', async () => {
    const { page } = fakePage(5000);
    restoreScroll(1200);
    await frames(2);
    expect(page.scrollY).toBe(1200);
  });

  it('puts the position back after the layout changes under it', async () => {
    // First a single tall column, then the real columns: the browser moves the position on its own.
    const view = fakePage(12_000);
    restoreScroll(1200);
    await frames(1);
    expect(view.page.scrollY).toBe(1200);
    view.resize(1500);
    expect(view.page.scrollY).toBe(700);
    view.resize(5000);
    await frames(3);
    expect(view.page.scrollY).toBe(1200);
  });

  it('settles for the end of the page when the page is shorter than the saved position', async () => {
    const view = fakePage(2000);
    restoreScroll(5000);
    await frames(40);
    expect(view.page.scrollY).toBe(1200);
    // It gave up holding the position: later calls are not piling up.
    const calls = view.scrollTo.mock.calls.length;
    await frames(60);
    expect(view.scrollTo.mock.calls.length).toBe(calls);
  });

  it('stops holding the position once the page has been still for a while', async () => {
    const view = fakePage(5000);
    restoreScroll(1200);
    await frames(30);
    // Layout changes after that belong to the browser, not to the restore.
    view.resize(900);
    view.resize(5000);
    await frames(10);
    expect(view.page.scrollY).toBe(100);
  });

  it.each(['wheel', 'touchstart', 'pointerdown', 'keydown'])(
    'lets go at once when the person takes over (%s)',
    async (type) => {
      const view = fakePage(12_000);
      restoreScroll(1200);
      await frames(1);
      window.dispatchEvent(new Event(type));
      view.page.scrollY = 300;
      await frames(5);
      expect(view.page.scrollY).toBe(300);
    },
  );

  it('can be stopped by whoever started it', async () => {
    const view = fakePage(12_000);
    const stop = restoreScroll(1200);
    stop();
    await frames(5);
    expect(view.scrollTo).not.toHaveBeenCalled();
  });

  it('does not hold the position forever when the page never settles', async () => {
    const view = fakePage(5000);
    restoreScroll(1200);
    // A page that keeps changing height for as long as the test runs.
    for (let index = 0; index < 400; index += 1) {
      view.resize(5000 + (index % 2) * 200);
      await vi.advanceTimersByTimeAsync(16);
    }
    const calls = view.scrollTo.mock.calls.length;
    view.page.scrollY = 0;
    await frames(20);
    expect(view.scrollTo.mock.calls.length).toBe(calls);
  });
});
