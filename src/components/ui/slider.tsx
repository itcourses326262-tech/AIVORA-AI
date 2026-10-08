'use client';

import { useId, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { cn, clamp } from '@/lib/utils';
import { isRtl } from './dir';
import { useControllableState } from './use-controllable-state';

export interface SliderProps {
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Fires on every change while dragging or typing. */
  onValueChange?: (value: number) => void;
  /** Fires once when a drag or key press ends. */
  onValueCommit?: (value: number) => void;
  disabled?: boolean;
  /** Spoken value, e.g. "5 seconds"; defaults to the number. */
  formatValue?: (value: number) => string;
  id?: string;
  name?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}

const THUMB = '1.25rem';

function snap(value: number, min: number, max: number, step: number): number {
  const stepped = Math.round((value - min) / step) * step + min;
  // Trim float noise (0.1 steps) before clamping.
  return clamp(Number(stepped.toFixed(8)), min, max);
}

/**
 * A single-value slider. The track fills from the inline start (the right edge in Arabic), the
 * thumb is `role="slider"` with arrow, Page, Home and End keys, and pointer drag is captured so it
 * keeps working when the pointer leaves the track.
 */
export function Slider({
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  onValueChange,
  onValueCommit,
  disabled = false,
  formatValue,
  id,
  name,
  className,
  ...aria
}: SliderProps) {
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue: defaultValue ?? min,
    onChange: onValueChange,
  });
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const fallbackId = useId();
  const thumbId = id ?? `slider-${fallbackId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fraction = max === min ? 0 : (current - min) / (max - min);
  const percent = fraction * 100;

  const update = (next: number, commit: boolean) => {
    const snapped = snap(next, min, max, step);
    if (snapped !== current) setCurrent(snapped);
    if (commit) onValueCommit?.(snapped);
  };

  const valueFromPointer = (event: PointerEvent<HTMLDivElement>): number => {
    const track = trackRef.current;
    if (!track) return current;
    const rect = track.getBoundingClientRect();
    const thumbWidth = thumbRef.current?.getBoundingClientRect().width ?? 0;
    const travel = rect.width - thumbWidth;
    if (travel <= 0) return current;
    // The thumb centre travels between half a thumb from each edge.
    const offset = isRtl(track) ? rect.right - event.clientX : event.clientX - rect.left;
    const ratio = clamp((offset - thumbWidth / 2) / travel, 0, 1);
    return min + ratio * (max - min);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rtl = isRtl(event.currentTarget);
    const big = Math.max(step, (max - min) / 10);
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowUp':
        next = current + step;
        break;
      case 'ArrowDown':
        next = current - step;
        break;
      // Left/right follow the thumb on screen: in RTL the minimum is on the right.
      case 'ArrowRight':
        next = current + (rtl ? -step : step);
        break;
      case 'ArrowLeft':
        next = current + (rtl ? step : -step);
        break;
      case 'PageUp':
        next = current + big;
        break;
      case 'PageDown':
        next = current - big;
        break;
      case 'Home':
        next = min;
        break;
      case 'End':
        next = max;
        break;
      default:
        return;
    }
    event.preventDefault();
    update(next, true);
  };

  return (
    <div
      className={cn(
        'relative flex h-6 w-full touch-none items-center',
        disabled && 'opacity-50',
        className,
      )}
      style={{ '--thumb': THUMB } as CSSProperties}
    >
      <div
        ref={trackRef}
        className={cn('relative h-6 w-full', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
        onPointerDown={(event) => {
          if (disabled) return;
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          update(valueFromPointer(event), false);
          thumbRef.current?.focus();
        }}
        onPointerMove={(event) => {
          if (draggingRef.current) update(valueFromPointer(event), false);
        }}
        onPointerUp={(event) => {
          if (!draggingRef.current) return;
          draggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
          update(valueFromPointer(event), true);
        }}
        onPointerCancel={() => {
          draggingRef.current = false;
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-surface-overlay ring-1 ring-border ring-inset">
          <div
            className="h-full rounded-full bg-primary-gradient"
            style={{ width: `calc(${percent}% - ${fraction} * var(--thumb) + var(--thumb) / 2)` }}
          />
        </div>
        <div
          ref={thumbRef}
          id={thumbId}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={current}
          aria-valuetext={formatValue?.(current)}
          aria-disabled={disabled || undefined}
          aria-orientation="horizontal"
          {...aria}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 size-5 -translate-y-1/2 rounded-full border-2 border-primary bg-white shadow-md transition-shadow duration-150 hover:shadow-glow"
          style={{ insetInlineStart: `calc(${percent}% - ${fraction} * var(--thumb))` }}
        />
      </div>
      {name ? <input type="hidden" name={name} value={current} /> : null}
    </div>
  );
}
