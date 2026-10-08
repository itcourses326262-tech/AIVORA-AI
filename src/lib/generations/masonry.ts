/**
 * Stable column assignment for a masonry list. Cards of different shapes (a square picture next to a
 * wide video) leave holes in a plain CSS grid, so each card goes to the currently shortest column and
 * then stays there: a card that finishes loading, or a new card arriving on top, never makes the others
 * jump to another column (which would also remount them).
 *
 * `previous` is the layout of the last render; the keys that are still present keep their column.
 * New keys that precede every known one (a fresh generation, newest first) are placed on top of the
 * shortest column, the others (older pages, "load more") at the bottom of it.
 */

export function assignColumns(
  keys: readonly string[],
  heightOf: (key: string) => number,
  count: number,
  previous: readonly (readonly string[])[],
): string[][] {
  const columns: string[][] =
    previous.length === count
      ? previous.map((column) => [...column])
      : Array.from({ length: count }, () => []);
  const present = new Set(keys);
  for (const column of columns) {
    for (let i = column.length - 1; i >= 0; i -= 1) {
      if (!present.has(column[i] as string)) column.splice(i, 1);
    }
  }
  const placed = new Set(columns.flat());
  const heights = columns.map((column) => column.reduce((sum, key) => sum + heightOf(key), 0));
  const shortest = () => heights.indexOf(Math.min(...heights));

  const firstKnown = keys.findIndex((key) => placed.has(key));
  const newer = firstKnown < 0 ? [] : keys.slice(0, firstKnown).filter((key) => !placed.has(key));
  const rest = keys.filter((key) => !placed.has(key) && !newer.includes(key));

  // Oldest of the newer ones first, so the newest ends up on top.
  for (const key of newer.toReversed()) {
    const column = shortest();
    columns[column]?.unshift(key);
    heights[column] = (heights[column] ?? 0) + heightOf(key);
  }
  for (const key of rest) {
    const column = shortest();
    columns[column]?.push(key);
    heights[column] = (heights[column] ?? 0) + heightOf(key);
  }
  return columns;
}

/** How many columns fit: as many as `minColumnWidth` allows, at least one, at most `maxColumns`. */
export function columnCount(
  width: number,
  { minColumnWidth, gap, maxColumns }: { minColumnWidth: number; gap: number; maxColumns: number },
): number {
  if (!(width > 0)) return 1;
  return Math.max(1, Math.min(maxColumns, Math.floor((width + gap) / (minColumnWidth + gap))));
}
