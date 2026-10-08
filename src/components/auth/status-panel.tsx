import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'danger' | 'warning' | 'info';

const TONES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-brand-soft text-brand',
};

export interface StatusPanelProps {
  tone: StatusTone;
  icon: LucideIcon;
  /** The page's `<h1>`. */
  title: string;
  /** Replaces the icon (a spinner while a request is pending). */
  mark?: ReactNode;
  children?: ReactNode;
  /** Buttons or links that move the user forward. */
  actions?: ReactNode;
  className?: string;
}

/**
 * What an account-recovery page says when the form is gone: one outcome with an icon, a heading,
 * a few words and the next step. The whole panel is a polite live region, so the change from
 * "confirming…" to "confirmed" is announced.
 */
export function StatusPanel({
  tone,
  icon: Icon,
  title,
  mark,
  children,
  actions,
  className,
}: StatusPanelProps) {
  return (
    <div role="status" className={cn('grid justify-items-center gap-4 text-center', className)}>
      <span
        aria-hidden="true"
        className={cn('flex size-14 items-center justify-center rounded-2xl', TONES[tone])}
      >
        {mark ?? <Icon className="size-7" />}
      </span>
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-foreground rtl:font-bold">
        {title}
      </h1>
      {children ? <div className="grid gap-2 text-sm text-muted">{children}</div> : null}
      {actions ? <div className="mt-2 grid w-full gap-2">{actions}</div> : null}
    </div>
  );
}
