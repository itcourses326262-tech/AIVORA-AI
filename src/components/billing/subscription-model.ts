import type { OrderDTO, SubscriptionDTO } from '@/lib/api-types';
import { RENEWAL_GRACE_MS } from '@/lib/billing/period';
import { getPlan, type SubscriptionPlan } from '@/lib/billing/plans';
import { checkoutTarget } from './navigation';

/**
 * Where a subscription stands, for the screen. `canceling` is an active plan that was told to
 * stop at the end of the month already paid (the server keeps `status: 'active'` until then).
 */
export type PlanPhase =
  | 'none'
  | 'incomplete'
  | 'active'
  | 'canceling'
  | 'past_due'
  | 'canceled'
  | 'expired';

export function planPhase(subscription: SubscriptionDTO | null): PlanPhase {
  if (subscription === null) return 'none';
  if (subscription.status === 'active' && subscription.cancelAtPeriodEnd) return 'canceling';
  return subscription.status;
}

/** The plan is running or can still be paid: it occupies the account's one subscription slot. */
export function isLivePhase(phase: PlanPhase): boolean {
  return (
    phase === 'incomplete' || phase === 'active' || phase === 'canceling' || phase === 'past_due'
  );
}

export interface PlanFacts {
  phase: Exclude<PlanPhase, 'none'>;
  /** The price-list entry; null if the plan has since left the list (the screen then shows its id). */
  plan: SubscriptionPlan | null;
  /** End of the paid month (renewal date, or the day the plan ends). */
  periodEnd: number | null;
  /** Last day on which an overdue renewal can still be paid. */
  graceEnd: number | null;
  /** The unpaid first-month or renewal order, when it can be paid now. */
  payable: { order: OrderDTO; href: string } | null;
}

/**
 * Everything the plan card shows, derived from the server's answer and the shared price list.
 * `origin` is the page's own origin (a payment address is only followed if it is safe).
 */
export function planFacts(
  subscription: SubscriptionDTO,
  origin: string,
): PlanFacts {
  const phase = planPhase(subscription);
  if (phase === 'none') throw new Error('planFacts needs a subscription');
  const periodEnd = subscription.currentPeriodEnd ?? null;
  const order = subscription.pendingOrder;
  const href = order ? checkoutTarget(order.checkoutUrl, origin) : null;
  return {
    phase,
    plan: getPlan(subscription.planId) ?? null,
    periodEnd,
    graceEnd: periodEnd === null ? null : periodEnd + RENEWAL_GRACE_MS,
    payable: order && href ? { order, href } : null,
  };
}
