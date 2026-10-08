import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type BadgeVariant =
  'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'border-transparent bg-foreground/[0.08] text-muted',
  brand: 'border-brand/25 bg-brand-soft text-brand',
  success: 'border-success/25 bg-success-soft text-success',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  danger: 'border-danger/25 bg-danger-soft text-danger',
  info: 'border-info/25 bg-info-soft text-info',
  outline: 'border-border-strong text-muted',
};

const DOT: Record<BadgeVariant, string> = {
  neutral: 'bg-muted',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
  outline: 'bg-muted',
};

export interface BadgeProps extends ComponentProps<'span'> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  /** A small status dot before the text. */
  dot?: boolean;
}

export function Badge({
  variant = 'neutral',
  size = 'md',
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap [&_svg]:size-3.5',
        size === 'sm' ? 'h-5 px-2 text-[0.6875rem]' : 'h-6 px-2.5 text-xs',
        VARIANTS[variant],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[variant])} />
      ) : null}
      {children}
    </span>
  );
}
