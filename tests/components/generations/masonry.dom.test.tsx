import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Masonry } from '@/components/generations';
import { renderUi } from '../render';

let width = 700;
let notify: (() => void) | undefined;
let observed: Element[] = [];

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe(target: Element) {
        observed.push(target);
      }
      disconnect() {
        notify = undefined;
      }
    },
  );
});

afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  vi.unstubAllGlobals();
  width = 700;
  observed = [];
});

const heights: Record<string, number> = { a: 400, b: 100, c: 100, d: 100, e: 100, f: 100 };

function List({ keys }: { keys: string[] }) {
  return (
    <Masonry
      items={keys}
      getKey={(key) => key}
      estimateHeight={(key) => heights[key] ?? 100}
      renderItem={(key) => <p>{key}</p>}
    />
  );
}

const cards = () => screen.getAllByRole('listitem');
/** The column (1-based, as the grid says it) of every card, in DOM order. */
const columns = () => cards().map((card) => `${card.textContent}${card.style.gridColumn}`);
const columnTracks = () => screen.getByRole('list').style.gridTemplateColumns;

describe('Masonry', () => {
  it('uses as many columns as the width of the list allows and deals cards to the shortest', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd']} />);
    // 700 px: two columns of at least 300 px. `a` is tall, so the rest pile into the second one.
    expect(columnTracks()).toBe('repeat(2, minmax(0, 1fr))');
    expect(columns()).toEqual(['a1', 'b2', 'c2', 'd2']);
  });

  it('is one list in the order given, so Tab and a screen reader follow the order of arrival', () => {
    // Column by column the cards would read a, c, e / b, d, f; the list says a to f.
    renderUi(<List keys={['a', 'b', 'c', 'd', 'e', 'f']} />);
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(cards().map((card) => card.textContent)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('follows the width of the list, not the window', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd', 'e', 'f']} />);
    expect(columnTracks()).toBe('repeat(2, minmax(0, 1fr))');
    width = 1000;
    act(() => notify?.());
    expect(columnTracks()).toBe('repeat(3, minmax(0, 1fr))');
    width = 250;
    act(() => notify?.());
    expect(columnTracks()).toBe('repeat(1, minmax(0, 1fr))');
    expect(columns()).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
  });

  it('keeps cards where they are, without remounting them, when a newer card arrives', () => {
    const { rerender } = renderUi(<List keys={['a', 'b', 'c']} />);
    const before = ['a', 'b', 'c'].map((key) => screen.getByText(key));
    rerender(<List keys={['n', 'a', 'b', 'c']} />);
    expect(['a', 'b', 'c'].map((key) => screen.getByText(key))).toEqual(before);
    // The new card sits on top of the shorter column, and first in the list.
    expect(columns()).toEqual(['n2', 'a1', 'b2', 'c2']);
  });

  it('watches the width on an empty probe, never on the list that its own callbacks resize', () => {
    renderUi(<List keys={['a', 'b', 'c']} />);
    const list = screen.getByRole('list');
    // Fitting a card changes the height of the list: observing it would make the browser report
    // "ResizeObserver loop completed with undelivered notifications".
    expect(observed).not.toContain(list);
    const probes = observed.filter((target) => target.tagName === 'SPAN');
    expect(probes).toHaveLength(1);
    expect(probes[0]).toHaveAttribute('aria-hidden', 'true');
    expect(probes[0]?.textContent).toBe('');
    expect(probes[0]?.parentElement).toBe(list.parentElement);
  });

  it('lists every card exactly once', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd', 'e', 'f']} />);
    expect(cards()).toHaveLength(6);
  });
});
