'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  /** Defaults to the localized "Nothing here yet". */
  title?: string;
  description?: ReactNode;
  /** Buttons or links that move the user forward. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** What a list or page shows when there is nothing to show yet: say why and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  headingLevel = 3,
  className,
}: EmptyStateProps) {
  const { t } = useI18n();
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border-strong px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="mb-1 flex size-14 items-center justify-center rounded-2xl border border-border bg-surface-raised text-brand shadow-sm [&_svg]:size-6"
        >
          {icon}
        </span>
      ) : null}
      <Heading className="text-base font-semibold text-foreground">
        {title ?? t('common.states.emptyTitle')}
      </Heading>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
