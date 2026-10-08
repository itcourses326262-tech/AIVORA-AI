import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './marketing.module.css';

export interface SectionProps {
  /** Anchor target (`/#features`); also names the heading `${id}-title`. */
  id: string;
  /** `muted` lays a faint band behind the section to separate it from its neighbours. */
  tone?: 'plain' | 'muted';
  className?: string;
  children: ReactNode;
}

/** A landing page section: landmark region labelled by its heading, with the page's vertical rhythm. */
export function Section({ id, tone = 'plain', className, children }: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(tone === 'muted' && 'border-y border-border bg-surface/40', className)}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 sm:py-24">{children}</div>
    </section>
  );
}

export interface SectionHeaderProps {
  id: string;
  eyebrow: string;
  title: string;
  description?: string;
  align?: 'center' | 'start';
  className?: string;
}

export function SectionHeader({
  id,
  eyebrow,
  title,
  description,
  align = 'center',
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'grid max-w-2xl gap-3',
        styles.reveal,
        align === 'center' ? 'mx-auto justify-items-center text-center' : 'justify-items-start',
        className,
      )}
    >
      <p className="inline-flex items-center gap-2.5 text-sm font-semibold text-brand">
        <span aria-hidden="true" className="h-px w-6 bg-brand-gradient" />
        {eyebrow}
        <span
          aria-hidden="true"
          className={cn('h-px w-6 bg-brand-gradient', align === 'start' && 'hidden')}
        />
      </p>
      <h2
        id={`${id}-title`}
        className="text-3xl leading-tight font-semibold tracking-tight text-foreground sm:text-4xl rtl:leading-snug rtl:font-bold"
      >
        {title}
      </h2>
      {description ? <p className="text-base text-muted sm:text-lg">{description}</p> : null}
    </div>
  );
}
