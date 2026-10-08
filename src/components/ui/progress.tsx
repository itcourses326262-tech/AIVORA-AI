'use client';

import { useI18n } from '@/lib/i18n/client';
import { clamp, cn, formatNumber } from '@/lib/utils';

export interface ProgressProps {
  /** 0 to 100. Omit it for an indeterminate bar. */
  value?: number;
  /** Accessible name; defaults to the localized "Progress". */
  label?: string;
  /** Show the percentage at the inline end. */
  showValue?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

/** A progress bar (`role="progressbar"`) that fills from the inline start. */
export function Progress({
  value,
  label,
  showValue = false,
  size = 'md',
  className,
}: ProgressProps) {
  const { t, locale } = useI18n();
  const determinate = value !== undefined;
  const percent = determinate ? clamp(value, 0, 100) : 0;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label ?? t('common.a11y.progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? Math.round(percent) : undefined}
        className={cn(
          'relative w-full overflow-hidden rounded-full bg-surface-overlay ring-1 ring-border ring-inset',
          size === 'sm' ? 'h-1.5' : 'h-2.5',
        )}
      >
        {determinate ? (
          <div
            className="h-full rounded-full bg-primary-gradient transition-[width] duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        ) : (
          <div className="absolute inset-y-0 start-0 w-1/3 animate-indeterminate rounded-full bg-primary-gradient" />
        )}
      </div>
      {showValue && determinate ? (
        <span aria-hidden="true" className="w-10 shrink-0 text-end text-xs text-muted tabular-nums">
          {formatNumber(Math.round(percent) / 100, locale, { style: 'percent' })}
        </span>
      ) : null}
    </div>
  );
}
