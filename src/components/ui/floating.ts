import { useLayoutEffect, type RefObject } from 'react';
import { isRtl } from './dir';

/** `start`/`end` are inline-logical: they swap sides in right-to-left layouts. */
export type Side = 'top' | 'bottom' | 'start' | 'end';
export type Align = 'start' | 'center' | 'end';
type PhysicalSide = 'top' | 'bottom' | 'left' | 'right';

export interface Placement {
  side: Side;
  align: Align;
  /** Gap between anchor and floating element, in px. */
  offset: number;
  /** Make the floating element at least as wide as its anchor. */
  matchWidth?: boolean;
}

const VIEWPORT_PADDING = 8;

function physicalSide(side: Side, rtl: boolean): PhysicalSide {
  if (side === 'start') return rtl ? 'right' : 'left';
  if (side === 'end') return rtl ? 'left' : 'right';
  return side;
}

const OPPOSITE: Record<PhysicalSide, PhysicalSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/**
 * Positions a `position: fixed` element next to its anchor, flipping to the opposite side when the
 * preferred one does not fit and keeping it inside the viewport. Writes straight to the DOM (no
 * React state), so it can run on every scroll. Returns the side that was finally used.
 */
export function placeFloating(
  anchor: HTMLElement,
  floating: HTMLElement,
  { side, align, offset, matchWidth }: Placement,
): PhysicalSide {
  const rtl = isRtl(anchor);
  const rect = anchor.getBoundingClientRect();
  if (matchWidth) floating.style.minWidth = `${rect.width}px`;
  // Measure at natural size first; a tall panel is then capped to the room it was given.
  floating.style.maxHeight = '';
  const width = floating.offsetWidth;
  const height = floating.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = document.documentElement.clientHeight;

  const room: Record<PhysicalSide, number> = {
    top: rect.top - offset - VIEWPORT_PADDING,
    bottom: viewportHeight - rect.bottom - offset - VIEWPORT_PADDING,
    left: rect.left - offset - VIEWPORT_PADDING,
    right: viewportWidth - rect.right - offset - VIEWPORT_PADDING,
  };
  const need = (physical: PhysicalSide) =>
    physical === 'top' || physical === 'bottom' ? height : width;

  let used = physicalSide(side, rtl);
  if (room[used] < need(used) && room[OPPOSITE[used]] > room[used]) used = OPPOSITE[used];

  let left: number;
  let top: number;
  if (used === 'top' || used === 'bottom') {
    top = used === 'top' ? rect.top - offset - height : rect.bottom + offset;
    // `start` aligns the inline-start edges: left edges in LTR, right edges in RTL.
    const alignLeftEdges = (align === 'start') !== rtl;
    if (align === 'center') left = rect.left + rect.width / 2 - width / 2;
    else left = alignLeftEdges ? rect.left : rect.right - width;
  } else {
    left = used === 'left' ? rect.left - offset - width : rect.right + offset;
    const alignTop = align === 'start';
    if (align === 'center') top = rect.top + rect.height / 2 - height / 2;
    else top = alignTop ? rect.top : rect.bottom - height;
  }

  if ((used === 'top' || used === 'bottom') && height > room[used]) {
    floating.style.maxHeight = `${Math.max(room[used], 96)}px`;
    if (used === 'top') top = rect.top - offset - floating.offsetHeight;
  }

  const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - height - VIEWPORT_PADDING);
  floating.style.left = `${Math.min(Math.max(left, VIEWPORT_PADDING), maxLeft)}px`;
  floating.style.top = `${Math.min(Math.max(top, VIEWPORT_PADDING), maxTop)}px`;
  floating.dataset.side = used;
  return used;
}

interface UseFloatingOptions extends Placement {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  floatingRef: RefObject<HTMLElement | null>;
}

/** Keeps a floating element glued to its anchor while `open` (scroll and resize included). */
export function useFloatingPosition({
  open,
  anchorRef,
  floatingRef,
  side,
  align,
  offset,
  matchWidth,
}: UseFloatingOptions): void {
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      const floating = floatingRef.current;
      if (anchor && floating) placeFloating(anchor, floating, { side, align, offset, matchWidth });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, floatingRef, side, align, offset, matchWidth]);
}
