'use client';

import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import type { PasswordStrength, StrengthLevel } from './password-strength';

const BAR: Record<StrengthLevel, string> = {
  empty: 'bg-foreground/15',
  weak: 'bg-danger',
  fair: 'bg-warning',
  good: 'bg-info',
  strong: 'bg-success',
};

const TEXT: Record<StrengthLevel, string> = {
  empty: '',
  weak: 'text-danger',
  fair: 'text-warning',
  good: 'text-info',
  strong: 'text-success',
};

/**
 * Four segments and a word. Built from inline elements so it can live inside a field's hint (a
 * paragraph) and be part of the input's description. The segments are decoration; the word is
 * announced politely, and only when the level changes.
 */
export function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  const { t } = useI18n();
  return (
    <span className="mt-1.5 flex items-center gap-3">
      <span aria-hidden="true" className="grid flex-1 grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((segment) => (
          <span
            key={segment}
            className={cn(
              'h-1.5 rounded-full transition-colors duration-200',
              segment <= strength.score ? BAR[strength.level] : BAR.empty,
            )}
          />
        ))}
      </span>
      <span
        aria-live="polite"
        className={cn('min-w-14 text-end text-xs font-semibold', TEXT[strength.level])}
      >
        {strength.level === 'empty' ? null : (
          <>
            <span className="sr-only">{t('auth.strength.label')}: </span>
            {t(`auth.strength.${strength.level}`)}
          </>
        )}
      </span>
    </span>
  );
}
