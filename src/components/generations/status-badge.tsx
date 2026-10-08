'use client';

import { Ban, CircleAlert, CircleCheck, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenerationStatus } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Badge, type BadgeVariant } from '../ui/badge';
import { SpinnerIcon } from '../ui/spinner-icon';

const VARIANT: Record<GenerationStatus, BadgeVariant> = {
  queued: 'neutral',
  processing: 'info',
  succeeded: 'success',
  failed: 'danger',
  canceled: 'outline',
};

const ICON: Record<GenerationStatus, ReactNode> = {
  queued: <Clock aria-hidden="true" />,
  processing: <SpinnerIcon className="size-3.5" />,
  succeeded: <CircleCheck aria-hidden="true" />,
  failed: <CircleAlert aria-hidden="true" />,
  canceled: <Ban aria-hidden="true" />,
};

export interface StatusBadgeProps {
  status: GenerationStatus;
  size?: 'sm' | 'md';
  className?: string;
}

/** The state of a generation as a labelled pill: the text always says it, the colour only adds. */
export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const { t } = useI18n();
  return (
    <Badge variant={VARIANT[status]} size={size} className={cn(className)} data-status={status}>
      {ICON[status]}
      {t(`studio.generations.status.${status}`)}
    </Badge>
  );
}
