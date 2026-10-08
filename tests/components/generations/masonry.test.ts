import { describe, expect, it } from 'vitest';
import { assignColumns, columnCount } from '@/lib/generations/masonry';

const heights = (map: Record<string, number>) => (key: string) => map[key] ?? 100;

describe('assignColumns', () => {
  it('deals new cards to the shortest column', () => {
    const columns = assignColumns(
      ['a', 'b', 'c', 'd'],
      heights({ a: 300, b: 100, c: 100, d: 100 }),
      2,
      [],
    );
    // `a` is as tall as the other three together: they all pile into the short column.
    expect(columns).toEqual([['a'], ['b', 'c', 'd']]);
  });

  it('keeps every card in its column when others arrive or change', () => {
    const before = assignColumns(['a', 'b', 'c'], heights({ a: 300, b: 100, c: 100 }), 2, []);
    // Card `a` turns out much shorter than estimated: nothing may move.
    const after = assignColumns(['a', 'b', 'c'], heights({ a: 10, b: 100, c: 100 }), 2, before);
    expect(after).toEqual(before);
  });

  it('puts a newer card on top of the shortest column', () => {
    const before = assignColumns(['a', 'b'], heights({ a: 300, b: 100 }), 2, []);
    const after = assignColumns(['n', 'a', 'b'], heights({ n: 100, a: 300, b: 100 }), 2, before);
    expect(after).toEqual([['a'], ['n', 'b']]);
  });

  it('puts older cards (load more) at the bottom', () => {
    const before = assignColumns(['a', 'b'], heights({ a: 300, b: 100 }), 2, []);
    const after = assignColumns(['a', 'b', 'o'], heights({ a: 300, b: 100, o: 100 }), 2, before);
    expect(after[1]).toEqual(['b', 'o']);
  });

  it('forgets cards that are gone', () => {
    const before = assignColumns(['a', 'b', 'c'], heights({}), 2, []);
    const after = assignColumns(['a', 'c'], heights({}), 2, before);
    expect(after.flat().sort()).toEqual(['a', 'c']);
  });

  it('starts over when the number of columns changes, and never loses a card', () => {
    const keys = ['a', 'b', 'c', 'd', 'e'];
    const two = assignColumns(keys, heights({}), 2, []);
    const three = assignColumns(keys, heights({}), 3, two);
    expect(three).toHaveLength(3);
    expect(three.flat().sort()).toEqual(keys);
    expect(assignColumns(keys, heights({}), 1, three)).toEqual([keys]);
  });

  it('handles an empty list', () => {
    expect(assignColumns([], heights({}), 3, [])).toEqual([[], [], []]);
  });
});

describe('columnCount', () => {
  const shape = { minColumnWidth: 300, gap: 16, maxColumns: 4 };

  it('fits as many columns as the width allows', () => {
    expect(columnCount(299, shape)).toBe(1);
    expect(columnCount(616, shape)).toBe(2);
    expect(columnCount(932, shape)).toBe(3);
    expect(columnCount(5000, shape)).toBe(4);
  });

  it('is one column while the width is unknown', () => {
    expect(columnCount(0, shape)).toBe(1);
    expect(columnCount(Number.NaN, shape)).toBe(1);
  });
});
