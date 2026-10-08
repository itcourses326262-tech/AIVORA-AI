import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * A placeholder block that shimmers. It is hidden from assistive technology: mark the loading
 * region itself with `aria-busy="true"` and give it an accessible loading label.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      {...props}
      className={cn('animate-shimmer rounded-md bg-shimmer', className)}
    />
  );
}

/** A few lines of placeholder text; the last one is shorter, like a real paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('grid gap-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          className={cn('h-3.5', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')}
        />
      ))}
    </div>
  );
}
