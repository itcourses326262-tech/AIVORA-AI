'use client';

import { Coins } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { cn, formatCredits } from '@/lib/utils';

const LOW_BALANCE = 5;

/** The live credit balance; a link to the account page. It pulses when the number changes. */
export function CreditsChip({ className }: { className?: string }) {
  const { t, locale } = useI18n();
  const { creditBalance } = useUser();
  // The number's key changes with the balance so the bump animation replays, but not on first paint.
  const [shown, setShown] = useState(creditBalance);
  const [bumps, setBumps] = useState(0);
  if (shown !== creditBalance) {
    setShown(creditBalance);
    setBumps((count) => count + 1);
  }

  const amount = formatCredits(creditBalance, locale);
  const low = creditBalance <= LOW_BALANCE;
  const empty = creditBalance <= 0;
  return (
    <Link
      href="/account"
      aria-label={
        low
          ? `${t('common.credits.balance', { amount })}. ${t('common.credits.low')}`
          : t('common.credits.balance', { amount })
      }
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm font-semibold tabular-nums transition-colors duration-150 pointer-coarse:h-11',
        empty
          ? 'border-danger/40 bg-danger-soft text-danger hover:bg-danger-soft/70'
          : low
            ? 'border-warning/40 bg-warning-soft text-warning hover:bg-warning-soft/70'
            : 'border-border bg-surface-raised text-foreground hover:border-border-strong hover:bg-surface-overlay',
        className,
      )}
    >
      <Coins aria-hidden="true" className={cn('size-4', !low && 'text-brand')} />
      <span key={bumps} className={cn(bumps > 0 && 'animate-bump')}>
        {amount}
      </span>
    </Link>
  );
}
