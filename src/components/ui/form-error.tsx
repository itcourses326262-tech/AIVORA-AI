'use client';

import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { errorMessage } from './error-message';

export interface FormErrorProps {
  /** Anything that was thrown; its code picks the localized message. */
  error?: unknown;
  /** Custom content instead of the message derived from `error`. */
  children?: ReactNode;
  className?: string;
}

/** The banner at the top of a form for a failure that belongs to the whole form. Renders nothing without an error. */
export function FormError({ error, children, className }: FormErrorProps) {
  const { t } = useI18n();
  const content =
    children ?? (error === undefined || error === null ? null : errorMessage(t, error));
  if (!content) return null;
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger',
        className,
      )}
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{content}</div>
    </div>
  );
}
