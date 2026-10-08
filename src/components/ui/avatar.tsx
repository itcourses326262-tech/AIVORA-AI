import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// Every pair keeps white initials above 4.5:1.
const TONES = [
  'from-[#6d4aff] to-[#3b6cf0]',
  'from-[#0e7490] to-[#155e75]',
  'from-[#be185d] to-[#9d174d]',
  'from-[#b45309] to-[#92400e]',
  'from-[#047857] to-[#065f46]',
  'from-[#7c3aed] to-[#5b21b6]',
] as const;

const SIZES = {
  sm: 'size-7 text-xs',
  md: 'size-9 text-sm',
  lg: 'size-12 text-base',
} as const;

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return result;
}

/** The letter that stands for a word: Arabic names skip the article "ال" (العلي is ع). */
function initialOf(word: string): string {
  const letters = Array.from(word);
  const start = letters[0] === 'ا' && letters[1] === 'ل' && letters.length > 3 ? 2 : 0;
  return letters[start]?.toUpperCase() ?? '';
}

/** Up to two initials from the first and last word; works for Arabic and Latin names. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return [first, last]
    .filter((word): word is string => word !== undefined)
    .map(initialOf)
    .join('');
}

export interface AvatarProps extends ComponentProps<'span'> {
  /** Person's name: shown as initials and used as the accessible name. */
  name: string;
  size?: keyof typeof SIZES;
}

/** A round initials badge with a colour picked deterministically from the name. */
export function Avatar({ name, size = 'md', className, ...props }: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      {...props}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.18)] select-none',
        TONES[hash(name) % TONES.length],
        SIZES[size],
        className,
      )}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  );
}
