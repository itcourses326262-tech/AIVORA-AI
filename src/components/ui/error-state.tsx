'use client';

import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from './button';
import { errorMessage } from './error-message';

export interface ErrorStateProps {
  /** Anything that was thrown; its code picks the localized message (`errors.<code>`). */
  error?: unknown;
  /** Overrides the message derived from `error`. */
  message?: string;
  title?: string;
  /** Shows a retry button. */
  onRetry?: () => void;
  retryLabel?: string;
  /** While a retry is running. */
  retrying?: boolean;
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

/** A recoverable failure: what went wrong, in the user's language, and a way to try again. */
export function ErrorState({
  error,
  message,
  title,
  onRetry,
  retryLabel,
  retrying = false,
  headingLevel = 3,
  className,
}: ErrorStateProps) {
  const { t } = useI18n();
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger-soft px-6 py-10 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger ring-1 ring-danger/30 [&_svg]:size-6"
      >
        <TriangleAlert />
      </span>
      <Heading className="text-base font-semibold text-foreground">
        {title ?? t('common.states.errorTitle')}
      </Heading>
      <p className="max-w-sm text-sm text-muted">{message ?? errorMessage(t, error)}</p>
      {onRetry ? (
        <Button
          variant="secondary"
          size="sm"
          className="mt-1"
          loading={retrying}
          startIcon={<RefreshCw />}
          onClick={onRetry}
        >
          {retryLabel ?? t('common.actions.retry')}
        </Button>
      ) : null}
    </div>
  );
}
