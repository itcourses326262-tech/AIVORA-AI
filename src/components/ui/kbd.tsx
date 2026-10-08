import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A keyboard key cap: `<Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd>`. */
export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      {...props}
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border-strong bg-surface-raised px-1.5 font-sans text-[0.6875rem] font-medium text-muted shadow-[0_1px_0_var(--border-strong)]',
        className,
      )}
    />
  );
}
