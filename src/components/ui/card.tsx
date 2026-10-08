import Link from 'next/link';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export type CardVariant = 'default' | 'raised' | 'glass' | 'gradient';

const VARIANTS: Record<CardVariant, string> = {
  default: 'border border-border bg-surface shadow-xs',
  raised: 'border border-border bg-surface-raised shadow-sm',
  glass: 'border border-border bg-surface/70 shadow-sm backdrop-blur-xl',
  gradient: 'border-gradient-brand shadow-sm',
};

const INTERACTIVE =
  'transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md active:translate-y-0';

interface CardOwnProps {
  variant?: CardVariant;
  /** Lift on hover; use for cards that are (or contain) the one link/button of the card. */
  interactive?: boolean;
}

export type CardProps = CardOwnProps &
  (
    | (ComponentProps<'div'> & { href?: undefined })
    | (Omit<ComponentProps<'a'>, 'href'> & { href: string })
  );

/** A surface that groups related content. With `href` the whole card is one link. */
export function Card(props: CardProps) {
  const { variant = 'default', interactive, className, ...rest } = props;
  const classes = cn(
    'block rounded-2xl text-foreground',
    VARIANTS[variant],
    (interactive || typeof rest.href === 'string') && INTERACTIVE,
    className,
  );
  if (typeof rest.href === 'string') {
    const { href, ...anchor } = rest as Omit<ComponentProps<'a'>, 'href'> & { href: string };
    return <Link href={href} {...anchor} className={classes} />;
  }
  return <div {...(rest as ComponentProps<'div'>)} className={classes} />;
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid gap-1.5 p-5 pb-0', className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h3'>) {
  return <h3 className={cn('text-base leading-6 font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted', className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex items-center gap-2 p-5 pt-0', className)} {...props} />;
}
