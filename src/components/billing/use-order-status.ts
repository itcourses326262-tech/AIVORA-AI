'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '@/lib/api-client';
import type { OrderDTO } from '@/lib/api-types';
import { fetchOrder } from './api';

/** Waits between two checks of a pending order: quick at first, calmer as it drags on. */
export const POLL_DELAYS_MS = [2_000, 3_000, 4_500, 6_500, 10_000] as const;
/** After the checkout page expired a late payment is still possible but unlikely: look rarely. */
export const POLL_EXPIRED_MS = 30_000;
/** After this long without an answer the page says it is taking longer than usual. */
export const LONG_WAIT_MS = 90_000;
/** Failed requests in a row before a page that has nothing to show gives up and says so. */
export const FAILURES_BEFORE_ERROR = 3;

export type OrderStatusState =
  | { kind: 'loading' }
  | {
      kind: 'order';
      order: OrderDTO;
      /** When the server last answered. */
      checkedAt: number;
      /** The last request failed; the order shown is the last one we know. */
      trouble: boolean;
      /** The wait has become longer than usual. */
      long: boolean;
    }
  | { kind: 'not_found' }
  | { kind: 'session_ended' }
  | { kind: 'error'; error: unknown };

/** The delay before check number `step` (0 is the first re-check) of a pending order. */
export function pollDelay(step: number, order: Pick<OrderDTO, 'expiresAt'>, now: number): number {
  if (order.expiresAt !== undefined && order.expiresAt <= now) return POLL_EXPIRED_MS;
  return POLL_DELAYS_MS[Math.min(step, POLL_DELAYS_MS.length - 1)] ?? POLL_EXPIRED_MS;
}

/**
 * Follows one order until it is no longer pending. The status always comes from
 * `GET /billing/orders/:id` (the server asks the payment provider); nothing in the page's address
 * is believed. Checks run at once, then with growing waits; they pause while the tab is hidden and
 * run again the moment it is shown; a failed request keeps what is on screen and tries again.
 * `checkNow` skips the wait.
 */
export function useOrderStatus(orderId: string | null) {
  const [state, setState] = useState<OrderStatusState>({ kind: 'loading' });
  const checkRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (orderId === null) return;
    const controller = new AbortController();
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let step = 0;
    let failures = 0;
    let running = false;
    let paused = false;
    let finished = false;

    const schedule = (delay: number) => {
      clearTimeout(timer);
      timer = setTimeout(check, delay);
    };

    async function check(): Promise<void> {
      clearTimeout(timer);
      if (finished || controller.signal.aborted || running) return;
      if (document.visibilityState === 'hidden') {
        paused = true;
        return;
      }
      paused = false;
      running = true;
      try {
        const order = await fetchOrder(orderId as string, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        const now = Date.now();
        setState({
          kind: 'order',
          order,
          checkedAt: now,
          trouble: false,
          long: now - startedAt > LONG_WAIT_MS,
        });
        if (order.status === 'pending') {
          schedule(pollDelay(step, order, now));
          step += 1;
        } else {
          finished = true;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (isApiError(error) && error.status === 404) {
          finished = true;
          setState({ kind: 'not_found' });
          return;
        }
        if (isApiError(error) && error.status === 401) {
          finished = true;
          setState({ kind: 'session_ended' });
          return;
        }
        failures += 1;
        setState((current) => {
          if (current.kind === 'order') return { ...current, trouble: true };
          return failures >= FAILURES_BEFORE_ERROR ? { kind: 'error', error } : current;
        });
        schedule(POLL_DELAYS_MS[Math.min(failures, POLL_DELAYS_MS.length - 1)] ?? POLL_EXPIRED_MS);
      } finally {
        running = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible' && paused) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    checkRef.current = () => {
      if (finished) return;
      void check();
    };
    void check();

    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderId]);

  const checkNow = useCallback(() => checkRef.current(), []);
  return { state, checkNow };
}
