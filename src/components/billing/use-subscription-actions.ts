'use client';

import { useCallback, useRef, useState } from 'react';
import type { SubscriptionDTO } from '@/lib/api-types';
import { toast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n/client';
import { formatDate } from '@/lib/utils';
import { cancelSubscription, resumeSubscription } from './api';
import { describeBillingError, type BillingProblem } from './checkout-errors';
import { planPhase } from './subscription-model';

export interface UseSubscriptionActionsOptions {
  /** Called with the subscription the server returned. */
  onChanged: (subscription: SubscriptionDTO) => void;
}

/**
 * Cancel and resume. Each is one request at a time (a second click while one runs is ignored);
 * the server's answer becomes the new state, so the screen never guesses what happened. Failures
 * are returned as localized text for the caller to show next to the button.
 */
export function useSubscriptionActions({ onChanged }: UseSubscriptionActionsOptions) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState<'cancel' | 'resume' | null>(null);
  const [problem, setProblem] = useState<BillingProblem | null>(null);
  const running = useRef(false);

  const run = useCallback(
    async (kind: 'cancel' | 'resume') => {
      if (running.current) return false;
      running.current = true;
      setBusy(kind);
      setProblem(null);
      try {
        const next = await (kind === 'cancel' ? cancelSubscription() : resumeSubscription());
        onChanged(next);
        if (kind === 'resume') {
          toast.success(t('billing.account.plan.toast.resumed'));
        } else if (planPhase(next) === 'canceling' && next.currentPeriodEnd !== undefined) {
          toast.success(
            t('billing.account.plan.toast.canceled', {
              date: formatDate(next.currentPeriodEnd, locale, 'long'),
            }),
          );
        } else {
          toast.success(t('billing.account.plan.toast.canceledNow'));
        }
        return true;
      } catch (error) {
        setProblem(
          describeBillingError(t, error, {
            returnTo: '/account/billing',
            locale,
            subscription: true,
          }),
        );
        return false;
      } finally {
        running.current = false;
        setBusy(null);
      }
    },
    [locale, onChanged, t],
  );

  return {
    busy,
    problem,
    clearProblem: useCallback(() => setProblem(null), []),
    cancel: useCallback(() => run('cancel'), [run]),
    resume: useCallback(() => run('resume'), [run]),
  };
}
