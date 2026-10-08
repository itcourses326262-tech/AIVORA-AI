'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ControlSectionProps {
  title: string;
  /** Something at the inline end of the title row (a value, a link). */
  aside?: ReactNode;
  /** A sentence under the title. */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Receives the id of the title, to name the control inside (`aria-labelledby`). */
  labelId?: string;
}

/** A titled group of the control panel. The title names the group for assistive technology. */
export function ControlSection({
  title,
  aside,
  hint,
  className,
  children,
  labelId,
}: ControlSectionProps) {
  const generated = useId();
  const id = labelId ?? `section-${generated.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <section aria-labelledby={id} className={cn('grid grid-cols-1 gap-2.5', className)}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h3 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {aside ? <div className="text-xs text-muted">{aside}</div> : null}
      </div>
      {hint ? <p className="-mt-1 text-xs text-muted">{hint}</p> : null}
      {children}
    </section>
  );
}
