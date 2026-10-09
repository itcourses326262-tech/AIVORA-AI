'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n/client';
import type { BillingProblem } from './checkout-errors';
import { Notice } from './notice';

export interface CheckoutFailureProps {
  problem: BillingProblem;
  onDismiss: () => void;
}

/**
 * Why a purchase did not start, shown inside the card of the item that was pressed so it sits
 * right above the button (a message at the top of a long page is out of sight on a phone). It
 * scrolls itself into view when it appears, can be closed, and offers the one next step the
 * error has, if any.
 */
export function CheckoutFailure({ problem, onDismiss }: CheckoutFailureProps) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: 'nearest' });
  }, []);
  return (
    <div ref={box}>
      <Notice
        tone="danger"
        title={problem.message}
        dismiss={{ label: t('common.a11y.dismissNotification'), onDismiss }}
        action={
          problem.link ? (
            <Button href={problem.link.href} variant="secondary" size="sm">
              {problem.link.label}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
