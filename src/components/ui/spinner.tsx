'use client';

import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { SpinnerIcon } from './spinner-icon';

const SIZES = { sm: 'size-4', md: 'size-6', lg: 'size-9' } as const;

export interface SpinnerProps {
  size?: keyof typeof SIZES;
  /** Accessible name; defaults to the localized "Loading". */
  label?: string;
  className?: string;
}

/** A stand-alone loading indicator announced politely as a status. */
export function Spinner({ size = 'md', label, className }: SpinnerProps) {
  const { t } = useI18n();
  return (
    <span role="status" className={cn('inline-flex text-brand', className)}>
      <SpinnerIcon className={SIZES[size]} />
      <span className="sr-only">{label ?? t('common.a11y.loading')}</span>
    </span>
  );
}
