'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from '@/lib/utils';
import { useFloatingPosition, type Align, type Side } from './floating';
import { Slot } from './slot';
import { Portal } from './portal';

export interface TooltipProps {
  content: ReactNode;
  side?: Side;
  align?: Align;
  /** Hover delay in ms before the tooltip appears (focus shows it immediately). */
  delay?: number;
  disabled?: boolean;
  /** The single element the tooltip describes; it must forward `ref` and accept event props. */
  children: ReactElement<HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> }>;
}

function isFocusVisible(element: HTMLElement): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}

const HIDE_DELAY_MS = 90;
const WARM_WINDOW_MS = 400;
let lastClosedAt = 0;

/**
 * A short text hint for a control. It describes the trigger (`aria-describedby`), shows on hover
 * after a delay and on keyboard focus, stays open while the pointer is over it, and closes on
 * Escape. It is a hint, never the only place important information lives.
 */
export function Tooltip({
  content,
  side = 'top',
  align = 'center',
  delay = 450,
  disabled,
  children,
}: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLElement | null>(null);
  const floatingRef = useRef<HTMLDivElement | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerFocus = useRef(false);

  const show = useCallback(
    (immediately: boolean) => {
      clearTimeout(hideTimer.current);
      clearTimeout(showTimer.current);
      const warm = Date.now() - lastClosedAt < WARM_WINDOW_MS;
      if (immediately || warm || delay <= 0) setOpen(true);
      else showTimer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );

  const hide = useCallback((immediately: boolean) => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    const close = () => {
      lastClosedAt = Date.now();
      setOpen(false);
    };
    if (immediately) close();
    else hideTimer.current = setTimeout(close, HIDE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide(true);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, hide]);

  useEffect(
    () => () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  const visible = open && !disabled;
  useFloatingPosition({ open: visible, anchorRef, floatingRef, side, align, offset: 8 });

  const describedBy = visible ? id : undefined;

  return (
    <>
      <Slot
        ref={anchorRef}
        aria-describedby={describedBy}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') show(false);
        }}
        onPointerLeave={() => hide(false)}
        onPointerDown={() => {
          pointerFocus.current = true;
          hide(true);
        }}
        onFocus={(event) => {
          // A click focuses the control too, but the pointer already had its say; focus moved by a
          // script (a dialog picking its first control) is not the keyboard user's doing either.
          if (!pointerFocus.current && isFocusVisible(event.currentTarget)) show(true);
          pointerFocus.current = false;
        }}
        onBlur={() => hide(true)}
      >
        {children}
      </Slot>
      {visible ? (
        <Portal>
          <div
            ref={floatingRef}
            id={id}
            role="tooltip"
            onPointerEnter={() => clearTimeout(hideTimer.current)}
            onPointerLeave={() => hide(false)}
            className={cn(
              'fixed z-[90] max-w-[18rem] animate-fade-in rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-snug font-medium text-background shadow-md',
            )}
          >
            {content}
          </div>
        </Portal>
      ) : null}
    </>
  );
}
