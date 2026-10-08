'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { IconButton } from './icon-button';
import { Portal } from './portal';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds before it closes itself; `Infinity` keeps it until dismissed. Errors linger longer. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  /** Reusing an id replaces the toast with that id instead of stacking a second one. */
  id?: string;
}

export interface ToastRecord {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  action?: { label: string; onClick: () => void };
  closing: boolean;
}

const MAX_VISIBLE = 4;
const EXIT_MS = 170;
const DEFAULT_DURATION: Record<ToastVariant, number> = {
  info: 5000,
  success: 4000,
  warning: 7000,
  error: 8000,
};

// The queue is module state, not React state: any code (an API error handler, an event listener)
// can raise a toast, and it survives client-side navigation between layouts.
let records: readonly ToastRecord[] = [];
const EMPTY: readonly ToastRecord[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function commit(next: readonly ToastRecord[]) {
  records = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(options: ToastOptions): string {
  counter += 1;
  const id = options.id ?? `toast-${counter}`;
  const variant = options.variant ?? 'info';
  const record: ToastRecord = {
    id,
    title: options.title,
    description: options.description,
    variant,
    duration: options.duration ?? DEFAULT_DURATION[variant],
    action: options.action,
    closing: false,
  };
  const others = records.filter((existing) => existing.id !== id);
  commit([...others, record].slice(-MAX_VISIBLE));
  return id;
}

function dismiss(id: string): void {
  if (!records.some((record) => record.id === id && !record.closing)) return;
  commit(records.map((record) => (record.id === id ? { ...record, closing: true } : record)));
  // Only remove what is still closing: the id may have been reused by a fresh toast meanwhile.
  setTimeout(
    () => commit(records.filter((record) => !(record.id === id && record.closing))),
    EXIT_MS,
  );
}

function dismissAll(): void {
  for (const record of records) dismiss(record.id);
}

type Shortcut = (title: string, options?: Omit<ToastOptions, 'title' | 'variant'>) => string;
const shortcut =
  (variant: ToastVariant): Shortcut =>
  (title, options) =>
    show({ ...options, title, variant });

export interface ToastApi {
  (options: ToastOptions): string;
  success: Shortcut;
  error: Shortcut;
  info: Shortcut;
  warning: Shortcut;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

/** Raises a toast from anywhere: `toast.success('Saved')`, `toast({ title, variant, action })`. */
export const toast: ToastApi = Object.assign((options: ToastOptions) => show(options), {
  success: shortcut('success'),
  error: shortcut('error'),
  info: shortcut('info'),
  warning: shortcut('warning'),
  dismiss,
  dismissAll,
});

/** The toast API for components. It is a stable object, safe in dependency lists. */
export function useToast(): ToastApi {
  return toast;
}

const ICONS: Record<ToastVariant, ReactNode> = {
  info: <Info className="text-info" />,
  success: <CircleCheck className="text-success" />,
  warning: <TriangleAlert className="text-warning" />,
  error: <CircleAlert className="text-danger" />,
};

function ToastItem({ record }: { record: ToastRecord }) {
  const { t } = useI18n();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(record.duration);
  const { id, duration } = record;

  // The countdown stops while the pointer or keyboard focus is on the toast and resumes with what
  // was left, so a message being read or acted on never disappears under the user.
  useEffect(() => {
    if (paused || !Number.isFinite(duration)) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismiss(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, duration, id]);

  return (
    <li
      data-variant={record.variant}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      className={cn(
        'pointer-events-auto flex w-[min(24rem,calc(100vw-2rem))] items-start gap-3 rounded-xl border bg-surface-overlay p-3.5 shadow-lg',
        record.closing ? 'animate-toast-out' : 'animate-toast-in',
        record.variant === 'error' ? 'border-danger/45' : 'border-border-strong',
      )}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0 [&_svg]:size-5">
        {ICONS[record.variant]}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="text-sm leading-6 font-semibold text-foreground">{record.title}</p>
        {record.description ? <p className="text-sm text-muted">{record.description}</p> : null}
        {record.action ? (
          <Button
            variant="link"
            size="sm"
            className="mt-1 justify-self-start"
            onClick={() => {
              record.action?.onClick();
              dismiss(id);
            }}
          >
            {record.action.label}
          </Button>
        ) : null}
      </div>
      <IconButton
        label={t('common.a11y.dismissNotification')}
        size="sm"
        tooltip={false}
        className="-me-1 -mt-1"
        onClick={() => dismiss(id)}
      >
        <X />
      </IconButton>
    </li>
  );
}

/**
 * Renders the toast queue. Mount it once per layout. Two live regions are always present:
 * a polite one for info, success and warning, and an assertive one for errors.
 */
export function Toaster() {
  const { t } = useI18n();
  const items = useSyncExternalStore(
    subscribe,
    () => records,
    () => EMPTY,
  );
  const errors = items.filter((record) => record.variant === 'error');
  const others = items.filter((record) => record.variant !== 'error');
  const region = 'flex flex-col items-center gap-2 sm:items-end';
  return (
    <Portal>
      <div
        data-inert-exempt=""
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 p-4 pb-[calc(1rem+var(--shell-bottom-inset,0px))] sm:items-end"
      >
        <ol
          role="status"
          aria-live="polite"
          aria-label={t('common.a11y.notifications')}
          className={region}
        >
          {others.map((record) => (
            <ToastItem key={record.id} record={record} />
          ))}
        </ol>
        <ol role="alert" aria-live="assertive" className={region}>
          {errors.map((record) => (
            <ToastItem key={record.id} record={record} />
          ))}
        </ol>
      </div>
    </Portal>
  );
}
