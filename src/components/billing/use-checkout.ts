'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CheckoutRequest, OrderDTO } from '@/lib/api-types';
import { newIdempotencyKey } from '@/lib/generations/request';
import { useI18n } from '@/lib/i18n/client';
import { startCheckout } from './api';
import { describeBillingError, keepsIdempotencyKey, type BillingProblem } from './checkout-errors';
import { checkoutTarget, currentOrigin, navigateTo, returnPath } from './navigation';

export type CheckoutPhase =
  | { kind: 'idle' }
  | { kind: 'starting'; item: CheckoutRequest }
  | { kind: 'redirecting'; item: CheckoutRequest }
  | { kind: 'failed'; item: CheckoutRequest; problem: BillingProblem };

export interface UseCheckoutOptions {
  /** Where the buyer is sent. Tests replace it; the default leaves the page. */
  navigate?: (url: string) => void;
  /** Source of `Idempotency-Key`s. Tests replace it. */
  newKey?: () => string;
  /** The page to come back to when the session has ended (`/login?next=`). */
  returnTo?: string;
}

/** Where to send the buyer for this order, or null when there is nowhere safe to send them. */
function destinationOf(order: OrderDTO): string | null {
  const payable = checkoutTarget(order.checkoutUrl, currentOrigin());
  if (payable) return payable;
  // A replayed request for an order that was paid in the meantime has nothing left to pay.
  return order.status === 'paid' ? returnPath(order.id) : null;
}

/**
 * Starts buying a pack or a plan: `POST /billing/checkout`, then follows the returned payment
 * page. One click is one attempt with one `Idempotency-Key`; further clicks are ignored while the
 * request runs (and for good once the browser is on its way to the payment page), so a double
 * click can never open two checkouts. An attempt whose outcome is unknown (the answer never
 * arrived) keeps its key, so clicking again returns the same order; any definite answer ends the
 * attempt and the next click is a new one.
 */
export function useCheckout({
  navigate = navigateTo,
  newKey = newIdempotencyKey,
  returnTo = '/pricing',
}: UseCheckoutOptions = {}) {
  const { t, locale } = useI18n();
  const [phase, setPhase] = useState<CheckoutPhase>({ kind: 'idle' });
  // A ref, not state: two clicks in the same tick must not both pass the guard.
  const busy = useRef(false);
  const attempt = useRef<{ item: string; key: string } | null>(null);

  useEffect(() => {
    // The Back button can restore this page from the browser's cache exactly as it was left, with
    // the button still "opening the payment page". Start over in that case.
    const onShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      busy.current = false;
      setPhase({ kind: 'idle' });
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const start = useCallback(
    async (item: CheckoutRequest) => {
      if (busy.current) return;
      busy.current = true;
      const itemKey = `${item.type}:${item.id}`;
      const key = attempt.current?.item === itemKey ? attempt.current.key : newKey();
      attempt.current = { item: itemKey, key };
      setPhase({ kind: 'starting', item });
      try {
        const order = await startCheckout(item, key);
        attempt.current = null;
        const destination = destinationOf(order);
        if (destination === null) {
          busy.current = false;
          setPhase({
            kind: 'failed',
            item,
            problem: { message: t('billing.errors.noPaymentPage') },
          });
          return;
        }
        // `busy` stays set: the page is being left, and a late second click must do nothing.
        setPhase({ kind: 'redirecting', item });
        navigate(destination);
      } catch (error) {
        if (!keepsIdempotencyKey(error)) attempt.current = null;
        busy.current = false;
        setPhase({
          kind: 'failed',
          item,
          problem: describeBillingError(t, error, { returnTo, locale }),
        });
      }
    },
    [locale, navigate, newKey, returnTo, t],
  );

  const dismiss = useCallback(() => {
    setPhase((current) => (current.kind === 'failed' ? { kind: 'idle' } : current));
  }, []);

  return { phase, start, dismiss };
}
