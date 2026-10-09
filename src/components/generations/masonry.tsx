'use client';

/**
 * A list of cards of different heights laid out in columns without holes. Each card goes to the
 * shortest column and then stays there (see `assignColumns`), so cards never jump between columns as
 * others load, finish or arrive. The number of columns follows the width of the list itself, not the
 * window, so it is right next to a sidebar as well.
 *
 * The cards are ONE list in the order given (newest first), which is the order of the DOM, of the
 * Tab key and of a screen reader; a CSS grid with fine rows only places them: each card sits in its
 * column and spans as many rows as it is tall, so the reading order is the order of arrival even
 * though the eye reads the columns.
 *
 * The width is observed on an empty probe, not on the list: the list changes height whenever a card
 * is fitted, and an observer that watches something its own callbacks resize makes the browser
 * report "ResizeObserver loop completed with undelivered notifications".
 *
 * Props
 * - `items`, `getKey`: the cards, newest first, and a stable key for each.
 * - `estimateHeight(item, columnWidth)`: about how tall the card will be before it is measured;
 *   `estimateCardHeight` for a `GenerationCard`.
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

/** The height of one grid row, in px. A card takes whole rows, so spacing varies by less than this. */
const ROW = 4;

/** How many rows a card of `height` px needs, with the gap below it. */
function rowsFor(height: number, gap: number): number {
  return Math.max(1, Math.ceil((height + gap) / ROW));
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

function MasonryItem({
  column,
  estimate,
  gap,
  children,
}: {
  column: number;
  estimate: number;
  gap: number;
  children: ReactNode;
}) {
  const item = useRef<HTMLLIElement>(null);
  const body = useRef<HTMLDivElement>(null);
  // Fixed for the life of the card: React must never write over the height the observer measured.
  const [firstGuess] = useState(() => rowsFor(estimate, gap));

  useLayoutEffect(() => {
    const cell = item.current;
    const content = body.current;
    if (!cell || !content) return;
    const fit = () => {
      cell.style.gridRowEnd = `span ${rowsFor(content.offsetHeight, gap)}`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    return () => observer.disconnect();
  }, [gap]);

  return (
    <li
      ref={item}
      className="min-w-0"
      style={{ gridColumn: column + 1, gridRowEnd: `span ${firstGuess}` }}
    >
      <div ref={body}>{children}</div>
    </li>
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
  const probe = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<string[][]>([]);

  useLayoutEffect(() => {
    const element = root.current;
    const watched = probe.current;
    if (!element || !watched) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(watched);
    return () => observer.disconnect();
  }, []);

  const count = columnCount(width, { minColumnWidth, gap, maxColumns });
  const columnWidth =
    count > 0 ? (Math.max(width, minColumnWidth) - gap * (count - 1)) / count : width;
  const estimates = new Map(items.map((item) => [getKey(item), estimateHeight(item, columnWidth)]));
  const next = assignColumns(items.map(getKey), (key) => estimates.get(key) ?? 0, count, layout);
  // The layout is remembered between renders; adjusting state while rendering is the supported way.
  const settled = sameLayout(next, layout);
  if (!settled) setLayout(next);
  const columns = settled ? layout : next;
  const columnOf = new Map(
    columns.flatMap((column, index) => column.map((key) => [key, index] as const)),
  );

  return (
    <div ref={root} className={className} style={{ position: 'relative' }}>
      <span
        ref={probe}
        aria-hidden="true"
        style={{ position: 'absolute', insetInline: 0, top: 0, height: 0, pointerEvents: 'none' }}
      />
      <ul
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
          gridAutoRows: ROW,
          // Dense: every card goes to the first free place in its own column, straight under the
          // one before it, whatever the order of the list.
          gridAutoFlow: 'row dense',
          columnGap: gap,
          alignItems: 'start',
        }}
      >
        {items.map((item) => {
          const key = getKey(item);
          return (
            <MasonryItem
              key={key}
              column={columnOf.get(key) ?? 0}
              estimate={estimates.get(key) ?? 0}
              gap={gap}
            >
              {renderItem(item)}
            </MasonryItem>
          );
        })}
      </ul>
    </div>
  );
}
