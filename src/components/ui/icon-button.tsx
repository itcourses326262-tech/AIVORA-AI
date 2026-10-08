'use client';

import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { buttonVariants, type ButtonVariant } from './button-variants';
import { SpinnerIcon } from './spinner-icon';
import { Tooltip } from './tooltip';
import type { Side } from './floating';

export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<IconButtonSize, string> = {
  sm: 'size-8 rounded-md px-0 [&_svg:not([class*=size-])]:size-4',
  md: 'size-10 rounded-lg px-0 [&_svg:not([class*=size-])]:size-5',
  lg: 'size-12 rounded-xl px-0 [&_svg:not([class*=size-])]:size-6',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** The accessible name; also the tooltip text. Required: an icon alone says nothing. */
  label: string;
  variant?: Exclude<ButtonVariant, 'link'>;
  size?: IconButtonSize;
  loading?: boolean;
  /** Show the label as a tooltip (default), or set the side, or `false` for none. */
  tooltip?: boolean | Side;
}

/** A square, icon-only button. Directional icons should be wrapped in `Directional`. */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  tooltip = true,
  className,
  children,
  type = 'button',
  onClick,
  ...props
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      {...props}
      className={cn(buttonVariants({ variant, size: 'md' }), SIZES[size], className)}
      onClick={(event) => {
        if (loading) event.preventDefault();
        else onClick?.(event);
      }}
    >
      {loading ? <SpinnerIcon /> : children}
    </button>
  );
  if (tooltip === false) return button;
  return (
    <Tooltip content={label} side={tooltip === true ? 'top' : tooltip}>
      {button}
    </Tooltip>
  );
}
