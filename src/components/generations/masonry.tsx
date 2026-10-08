'use client';

/**
 * A list of cards of different heights laid out in columns without holes. Each card goes to the
 * shortest column and then stays there (see `assignColumns`), so cards never jump between columns as
 * others load, finish or arrive. The number of columns follows the width of the list itself, not the
 * window, so it is right next to a sidebar as well.
 *
 * Props
 * - `items`, `getKey`: the cards, newest first, and a stable key for each.
 * - `estimateHeight(item, columnWidth)`: about how tall the card will be; `estimateCardHeight` for
 *   a `GenerationCard`.
 * - `renderItem(item)`: draws one card.
 * - `minColumnWidth` (default 300), `gap` (16), `maxColumns` (4): the shape of the grid.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { assignColumns, columnCount } from '@/lib/generations/masonry';

export interface MasonryProps<T> {
  items: readonly T[];
  getKey: (item: T) => string;
  estimateHeight: (item: T, columnWidth: number) => number;
  renderItem: (item: T) => ReactNode;
  minColumnWidth?: number;
  gap?: number;
  maxColumns?: number;
  className?: string;
}

function sameLayout(a: readonly (readonly string[])[], b: readonly (readonly string[])[]): boolean {
  return (
    a.length === b.length &&
    a.every((column, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        column.length === other.length &&
        column.every((key, i) => key === other[i])
      );
    })
  );
}

export function Masonry<T>({
  items,
  getKey,
  estimateHeight,
  renderItem,
  minColumnWidth = 300,
  gap = 16,
  maxColumns = 4,
  className,
}: MasonryProps<T>) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<string[][]>([]);

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const count = columnCount(width, { minColumnWidth, gap, maxColumns });
  const columnWidth =
    count > 0 ? (Math.max(width, minColumnWidth) - gap * (count - 1)) / count : width;
  const byKey = new Map(items.map((item) => [getKey(item), item]));
  const next = assignColumns(
    items.map(getKey),
    (key) => {
      const item = byKey.get(key);
      return item === undefined ? 0 : estimateHeight(item, columnWidth);
    },
    count,
    layout,
  );
  // The layout is remembered between renders; adjusting state while rendering is the supported way.
  const settled = sameLayout(next, layout);
  if (!settled) setLayout(next);
  const columns = settled ? layout : next;

  return (
    <div
      ref={root}
      className={className}
      style={{ display: 'flex', alignItems: 'flex-start', gap }}
    >
      {columns.map((column, index) => (
        <ul key={index} className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
          {column.map((key) => {
            const item = byKey.get(key);
            return item === undefined ? null : (
              <li key={key} className="min-w-0">
                {renderItem(item)}
              </li>
            );
          })}
        </ul>
      ))}
    </div>
  );
}
