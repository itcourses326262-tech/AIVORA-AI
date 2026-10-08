'use client';

import { ImageOff, Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AssetDTO } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber } from '@/lib/utils';
import { IconButton } from '../ui/icon-button';
import {
  DOUBLE_TAP_SCALE,
  FIT,
  MAX_SCALE,
  ZOOM_STEP,
  centerOf,
  distanceBetween,
  midpoint,
  panBy,
  pinchView,
  zoomAt,
  type PinchStart,
  type Point,
  type Size,
  type View,
} from './zoom';

export interface ZoomPanProps {
  asset: AssetDTO;
  alt: string;
  className?: string;
}

type Gesture = { kind: 'pan'; last: Point } | { kind: 'pinch'; start: PinchStart } | null;

/** A second tap this soon, and this close, after the first is a double tap. */
const DOUBLE_TAP_MS = 320;
const TAP_SLOP_PX = 8;
const KEY_PAN_PX = 80;

/**
 * A picture that fills its parent (fitted inside it) and can be zoomed and moved: the + and -
 * buttons or keys, Ctrl or Cmd with the wheel (a trackpad pinch), two fingers, a double click or
 * double tap, and, once zoomed, dragging with a finger or the mouse and the arrow keys. At the
 * fitted size a finger still scrolls the page. Mount it with `key={asset.id}`: a new picture starts
 * fitted.
 */
export function ZoomPan({ asset, alt, className }: ZoomPanProps) {
  const { t, locale } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>(FIT);
  // Pointer handlers need the newest view without waiting for a render between two events.
  const current = useRef<View>(FIT);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture>(null);
  const lastTap = useRef<{ at: number; point: Point } | null>(null);
  const moved = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const setView = (next: View) => {
    current.current = next;
    setViewState(next);
  };
  const sizeOf = (): Size => {
    const box = stage.current?.getBoundingClientRect();
    return { width: box?.width ?? 0, height: box?.height ?? 0 };
  };
  const localPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = stage.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const zoomTo = (scale: number, focal: Point) =>
    setView(zoomAt(current.current, sizeOf(), scale, focal));
  const zoomBy = (factor: number) => zoomTo(current.current.scale * factor, centerOf(sizeOf()));

  // React registers wheel listeners as passive, which cannot stop the page from zooming.
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = node.getBoundingClientRect();
      const focal = { x: event.clientX - box.left, y: event.clientY - box.top };
      const next = zoomAt(
        current.current,
        { width: box.width, height: box.height },
        current.current.scale * Math.exp(-event.deltaY * 0.01),
        focal,
      );
      current.current = next;
      setViewState(next);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    gesture.current = {
      kind: 'pinch',
      start: { view: current.current, center: midpoint(a, b), distance: distanceBetween(a, b) },
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (typeof stage.current?.setPointerCapture === 'function') {
      stage.current.setPointerCapture(event.pointerId);
    }
    pointers.current.set(event.pointerId, localPoint(event));
    moved.current = 0;
    if (pointers.current.size === 2) startPinch();
    else gesture.current = { kind: 'pan', last: localPoint(event) };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.current.set(event.pointerId, point);
    const active = gesture.current;
    if (active?.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (a && b) {
        setView(
          pinchView(
            active.start,
            { center: midpoint(a, b), distance: distanceBetween(a, b) },
            sizeOf(),
          ),
        );
      }
      moved.current = TAP_SLOP_PX + 1;
    } else if (active?.kind === 'pan') {
      const dx = point.x - active.last.x;
      const dy = point.y - active.last.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      active.last = point;
      if (current.current.scale > 1) setView(panBy(current.current, sizeOf(), dx, dy));
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const point = localPoint(event);
    pointers.current.delete(event.pointerId);
    const remaining = [...pointers.current.values()];
    if (remaining.length === 1 && remaining[0]) {
      gesture.current = { kind: 'pan', last: remaining[0] };
      return;
    }
    gesture.current = null;
    setDragging(false);
    if (event.type !== 'pointerup' || moved.current > TAP_SLOP_PX) {
      lastTap.current = null;
      return;
    }
    const previous = lastTap.current;
    if (
      previous &&
      event.timeStamp - previous.at < DOUBLE_TAP_MS &&
      distanceBetween(previous.point, point) < TAP_SLOP_PX * 3
    ) {
      lastTap.current = null;
      if (current.current.scale > 1) setView(FIT);
      else zoomTo(DOUBLE_TAP_SCALE, point);
    } else {
      lastTap.current = { at: event.timeStamp, point };
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const zoomed = current.current.scale > 1;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_PX, 0],
      ArrowRight: [-KEY_PAN_PX, 0],
      ArrowUp: [0, KEY_PAN_PX],
      ArrowDown: [0, -KEY_PAN_PX],
    };
    if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') setView(FIT);
    else if (zoomed && step[event.key]) {
      const [dx, dy] = step[event.key] as [number, number];
      setView(panBy(current.current, sizeOf(), dx, dy));
    } else return;
    event.preventDefault();
  };

  const percent = formatNumber(view.scale, locale, { style: 'percent', maximumFractionDigits: 0 });
  const zoomed = view.scale > 1;

  return (
    <div
      ref={stage}
      role="group"
      tabIndex={0}
      aria-roledescription={t('gallery.detail.zoom.role')}
      aria-label={t('gallery.detail.zoom.label', { alt })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      className={cn(
        'relative size-full overflow-hidden outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset',
        zoomed && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
        // Zoomed in, a finger moves the picture; fitted, it still scrolls the page.
        zoomed ? 'touch-none' : 'touch-pan-y',
        className,
      )}
    >
      {state === 'loading' ? (
        <span aria-hidden="true" className="absolute inset-0 animate-shimmer bg-shimmer" />
      ) : null}
      {state === 'error' ? (
        <span
          role="img"
          aria-label={t('studio.generations.media.loadFailed')}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-sm text-muted"
        >
          <ImageOff aria-hidden="true" className="size-8 text-subtle" />
          {t('studio.generations.media.loadFailed')}
        </span>
      ) : (
        <div
          className="absolute inset-0 will-change-transform"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: '0 0',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- user media is served by our own route; the image optimizer would add nothing */}
          <img
            ref={(node) => {
              // A cached file can finish loading before React attaches `onLoad`.
              if (node?.complete && node.naturalWidth > 0) setState('loaded');
            }}
            src={asset.url}
            alt={alt}
            width={asset.width}
            height={asset.height}
            draggable={false}
            decoding="async"
            onLoad={() => setState('loaded')}
            onError={() => setState('error')}
            className={cn(
              'size-full object-contain transition-opacity duration-300',
              state === 'loading' && 'opacity-0',
            )}
          />
        </div>
      )}

      {state === 'loaded' ? (
        <div
          // The controls must not start a drag of the picture.
          onPointerDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          className="absolute end-3 bottom-3 flex items-center gap-0.5 rounded-xl bg-black/65 p-1 text-white backdrop-blur-sm"
        >
          <IconButton
            label={t('gallery.detail.zoom.out')}
            size="sm"
            disabled={!zoomed}
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <ZoomOut />
          </IconButton>
          <span aria-live="polite" className="min-w-11 text-center text-xs tabular-nums">
            {percent}
          </span>
          <IconButton
            label={t('gallery.detail.zoom.in')}
            size="sm"
            disabled={view.scale >= MAX_SCALE}
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <ZoomIn />
          </IconButton>
          <IconButton
            label={t('gallery.detail.zoom.fit')}
            size="sm"
            disabled={!zoomed}
            className="text-white hover:bg-white/20 hover:text-white"
            onClick={() => setView(FIT)}
          >
            <Maximize />
          </IconButton>
        </div>
      ) : null}
    </div>
  );
}

