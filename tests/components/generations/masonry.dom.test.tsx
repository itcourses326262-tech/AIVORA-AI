import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Masonry } from '@/components/generations';
import { renderUi } from '../render';

let width = 700;
let notify: (() => void) | undefined;

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
      observe() {}
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

const columns = () => screen.getAllByRole('list').map((list) => list.textContent);

describe('Masonry', () => {
  it('uses as many columns as the width of the list allows and deals cards to the shortest', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd']} />);
    // 700 px: two columns of at least 300 px. `a` is tall, so the rest pile into the second one.
    expect(columns()).toEqual(['a', 'bcd']);
  });

  it('follows the width of the list, not the window', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd', 'e', 'f']} />);
    expect(screen.getAllByRole('list')).toHaveLength(2);
    width = 1000;
    act(() => notify?.());
    expect(screen.getAllByRole('list')).toHaveLength(3);
    width = 250;
    act(() => notify?.());
    expect(screen.getAllByRole('list')).toHaveLength(1);
    expect(columns()).toEqual(['abcdef']);
  });

  it('keeps cards where they are, without remounting them, when a newer card arrives', () => {
    const { rerender } = renderUi(<List keys={['a', 'b', 'c']} />);
    const before = ['a', 'b', 'c'].map((key) => screen.getByText(key));
    rerender(<List keys={['n', 'a', 'b', 'c']} />);
    expect(['a', 'b', 'c'].map((key) => screen.getByText(key))).toEqual(before);
    expect(columns()?.join('').split('').sort().join('')).toBe('abcn');
    // The new card sits on top of the shorter column.
    expect(columns()).toEqual(['a', 'nbc']);
  });

  it('lists every card exactly once', () => {
    renderUi(<List keys={['a', 'b', 'c', 'd', 'e', 'f']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });
});
