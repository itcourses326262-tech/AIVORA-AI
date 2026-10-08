import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,filter,transform] duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-60 aria-busy:cursor-progress [&_svg]:shrink-0';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary-gradient text-primary-foreground shadow-[var(--highlight),var(--elev-sm)] hover:-translate-y-px hover:shadow-glow active:translate-y-0 active:brightness-95',
  secondary:
    'border border-border bg-surface-raised text-foreground shadow-xs hover:border-border-strong hover:bg-surface-overlay',
  ghost: 'text-foreground hover:bg-foreground/[0.07] active:bg-foreground/10',
  outline: 'border border-field text-foreground hover:bg-foreground/[0.06] active:bg-foreground/10',
  danger:
    'bg-danger-solid text-danger-solid-foreground shadow-xs hover:bg-danger-solid-hover active:brightness-95',
  link: 'h-auto rounded-sm px-0 text-brand underline-offset-4 hover:underline active:scale-100',
};

// On a touch screen (`pointer-coarse`) the small sizes grow to 44px, the smallest comfortable target.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-md px-3 text-sm pointer-coarse:h-11',
  md: 'h-10 rounded-lg px-4 text-sm pointer-coarse:h-11',
  lg: 'h-12 rounded-xl px-6 text-base',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Class names of a button, for styling a `Link` or any element like one. */
export function buttonVariants({
  variant = 'primary',
  size = 'md',
  fullWidth,
  className,
}: ButtonStyleOptions = {}): string {
  return cn(
    BASE,
    VARIANTS[variant],
    variant !== 'link' && SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}
