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

  it('starts over when most cards are gone, so a filter never leaves a hole', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const before = assignColumns(keys, heights({}), 3, []);
    // Only the two cards that sat in the first and third columns survive the filter.
    const survivors = [before[0]?.[0], before[2]?.[0]].filter((key): key is string => Boolean(key));
    const after = assignColumns(survivors, heights({}), 3, before);
    expect(after.map((column) => column.length)).toEqual([1, 1, 0]);
  });

  it('starts over when removals leave an empty column before a filled one', () => {
    const before = assignColumns(['a', 'b', 'c'], heights({}), 3, []);
    expect(before).toEqual([['a'], ['b'], ['c']]);
    // The middle card is deleted: two cards must not leave the middle column empty.
    expect(assignColumns(['a', 'c'], heights({}), 3, before)).toEqual([['a'], ['c'], []]);
  });

  it('keeps what is left in place when one card of many is deleted', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'f'];
    const before = assignColumns(keys, heights({}), 3, []);
    const after = assignColumns(['a', 'b', 'c', 'd', 'f'], heights({}), 3, before);
    expect(after.flat().sort()).toEqual(['a', 'b', 'c', 'd', 'f']);
    expect(after[0]).toEqual(before[0]?.filter((key) => key !== 'e'));
    expect(after[1]).toEqual(before[1]?.filter((key) => key !== 'e'));
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
