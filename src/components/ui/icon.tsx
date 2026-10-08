import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * Wraps an arrow/chevron icon that points along the reading direction so it flips in
 * right-to-left layouts: `<Directional><ArrowRight /></Directional>`.
 */
export function Directional({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span aria-hidden="true" className={cn('inline-flex rtl:-scale-x-100', className)} {...props} />
  );
}
