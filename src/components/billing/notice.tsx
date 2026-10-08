import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger';

const SURFACE: Record<NoticeTone, string> = {
  info: 'border-info/30 bg-info-soft',
  success: 'border-success/30 bg-success-soft',
  warning: 'border-warning/30 bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft',
};

const ICON: Record<NoticeTone, { Icon: LucideIcon; className: string }> = {
  info: { Icon: Info, className: 'text-info' },
  success: { Icon: CircleCheck, className: 'text-success' },
  warning: { Icon: TriangleAlert, className: 'text-warning' },
  danger: { Icon: CircleAlert, className: 'text-danger' },
};

export interface NoticeProps {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A link or button on the inline end (below the text on a phone). */
  action?: ReactNode;
  /** `alert` for something that just went wrong, `status` for news, `note` for fixed information. */
  role?: 'alert' | 'status' | 'note';
  className?: string;
}

/** A boxed message with an icon: what happened and, when there is one, what to do about it. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  role = tone === 'danger' ? 'alert' : 'status',
  className,
}: NoticeProps) {
  const { Icon, className: iconClass } = ICON[tone];
  return (
    <div
      role={role}
      className={cn(
        'flex flex-wrap items-start gap-x-3 gap-y-3 rounded-xl border p-4 text-sm sm:flex-nowrap',
        SURFACE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', iconClass)} />
      <div className="grid min-w-0 flex-1 basis-56 gap-1">
        {title ? <p className="font-semibold text-foreground">{title}</p> : null}
        {children ? <div className="text-muted">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0 sm:self-center">{action}</div> : null}
    </div>
  );
}
