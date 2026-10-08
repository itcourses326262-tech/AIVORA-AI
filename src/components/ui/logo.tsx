import { useId, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Geometry shared with `public/logo.svg` and `public/icon.svg`. */
const SPARK = 'M16 7C17 15 21 19 29 20C21 21 17 25 16 33C15 25 11 21 3 20C11 19 15 15 16 7Z';
const SPARK_SMALL =
  'M28 3C28.4 6 30 7.6 33 8C30 8.4 28.4 10 28 13C27.6 10 26 8.4 23 8C26 7.6 27.6 6 28 3Z';
const WORDMARK = [
  'M1.7 26.3 12 1.7l10.3 24.6M5.6 17.5h12.8', // A
  'M31.7 1.7v24.6', // I
  'M41.1 1.7 51.4 26.3 61.7 1.7', // V
  'M80.1 1.7h0a10.3 10.3 0 0 1 10.3 10.3v4.1a10.3 10.3 0 0 1-10.3 10.3h0A10.3 10.3 0 0 1 69.8 16.1V12A10.3 10.3 0 0 1 80.1 1.7Z', // O
  'M101.1 26.3V1.7h9.8a6.9 6.9 0 0 1 0 13.8h-9.8M111.2 15.5l9.4 10.8', // R
  'M149.7 1.7h-18.6v24.6h18.6M131.1 14h15.3', // E
];

export interface LogoProps extends Omit<ComponentProps<'svg'>, 'viewBox'> {
  /** `glyph` is the spark alone (favicon, collapsed sidebar); `full` adds the wordmark. */
  variant?: 'glyph' | 'full';
  /** Accessible name. Pass `null` when the logo sits next to the brand name (decorative). */
  label?: string | null;
}

/**
 * The AIVORE mark: a violet-to-cyan spark and, in the full variant, the geometric wordmark in the
 * current text colour, so it reads on dark and light surfaces. The lockup never mirrors in RTL.
 */
export function Logo({ variant = 'full', label = 'AIVORE', className, ...props }: LogoProps) {
  const gradientId = `logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const full = variant === 'full';
  return (
    <svg
      viewBox={full ? '0 0 197 36' : '0 0 36 36'}
      fill="none"
      role={label === null ? undefined : 'img'}
      aria-label={label ?? undefined}
      aria-hidden={label === null ? true : undefined}
      className={cn(full ? 'h-8 w-auto' : 'size-8', className)}
      {...props}
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="3"
          y1="7"
          x2="33"
          y2="33"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0.3" style={{ stopColor: 'var(--brand-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--brand-to)' }} />
        </linearGradient>
      </defs>
      <path d={SPARK} fill={`url(#${gradientId})`} />
      <path d={SPARK_SMALL} fill={`url(#${gradientId})`} />
      {full ? (
        <g
          transform="translate(46 4)"
          stroke="currentColor"
          strokeWidth="3.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {WORDMARK.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
