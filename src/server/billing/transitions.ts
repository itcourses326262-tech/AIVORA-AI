import 'server-only';
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { grantCredits } from '@/server/credits';
import type { Tx } from '@/server/db';
import { orders, subscriptions, type OrderRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { clawbackCredits } from './clawback';
import { recordReceipt, recordRefund } from './mail';

/**
 * Every state change of an order or subscription that has to be atomic with a credit movement.
 * All functions are synchronous and take the caller's transaction: nothing here awaits, so a
 * change of state and its credits can never be separated by a crash or an interleaved process.
 * Each one is a compare-and-set on the status it expects, which is what makes a replayed or
 * concurrent event harmless: the loser changes nothing.
 */

const log = () => getLogger().child({ module: 'billing' });

/** States from which a confirmed payment still has to be credited (a late payment is not lost). */
const UNPAID_STATUSES = ['pending', 'failed', 'canceled'] as const;

/**
 * An order whose credits were never granted. Besides the open and the closed ones this includes a
 * `needs_review` order that was flagged BEFORE any credit (a payment that did not match): it was
 * only parked, and when the gateway later reports a payment that matches in every respect (a
 * reference the gateway failed to echo once, say) it is credited like any other, or closed when
 * the money went back. A `needs_review` order that was credited (a refund that could not take all
 * its credits back) is never unpaid: `paidAt` says the credits were granted.
 */
export function isUnpaid(order: Pick<OrderRow, 'status' | 'paidAt'>): boolean {
  return (
    (UNPAID_STATUSES as readonly string[]).includes(order.status) ||
    (order.status === 'needs_review' && order.paidAt === null)
  );
}

function unpaidCondition(): SQL | undefined {
  return or(
    inArray(orders.status, UNPAID_STATUSES),
    and(eq(orders.status, 'needs_review'), isNull(orders.paidAt)),
  );
}

function readOrder(tx: Tx, orderId: string): OrderRow {
  const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error(`Order ${orderId} disappeared inside its own transaction`);
  return order;
}

/**
 * Ends a pending order without a payment. A first subscription month that ends this way takes
 * its still-incomplete subscription with it. Returns false when the order was not pending.
 */
export function closeOrder(
  tx: Tx,
  order: OrderRow,
  to: 'failed' | 'canceled',
  now: number,
): boolean {
  const claimed = tx
    .update(orders)
    .set({ status: to, updatedAt: now })
    .where(and(eq(orders.id, order.id), eq(orders.status, 'pending')))
    .run();
  if (claimed.changes !== 1) return false;
  endIncompleteSubscription(tx, order, to === 'canceled' ? 'canceled' : 'expired', now);
  return true;
}

function endIncompleteSubscription(
  tx: Tx,
  order: OrderRow,
  to: 'canceled' | 'expired',
  now: number,
): void {
  if (order.kind !== 'subscription_initial' || order.subscriptionId === null) return;
  tx.update(subscriptions)
    .set({
      status: to,
      nextChargeAt: null,
      updatedAt: now,
      ...(to === 'canceled' ? { canceledAt: now } : {}),
    })
    .where(and(eq(subscriptions.id, order.subscriptionId), eq(subscriptions.status, 'incomplete')))
    .run();
}

/**
 * Money arrived but does not match the order (amount, currency or reference). Nothing is
 * credited; a person has to decide, usually with a refund. Returns false when the order was
 * already past that point.
 */
export function flagForReview(tx: Tx, order: OrderRow, now: number): boolean {
  const claimed = tx
    .update(orders)
    .set({ status: 'needs_review', updatedAt: now })
    .where(and(eq(orders.id, order.id), inArray(orders.status, UNPAID_STATUSES)))
    .run();
  if (claimed.changes !== 1) return false;
  endIncompleteSubscription(tx, order, 'expired', now);
  return true;
}

/** pending|failed|canceled -> paid, the credits and the subscription period, all or nothing. */
export function markPaid(tx: Tx, order: OrderRow, paymentId: string | null, now: number): boolean {
  const claimed = tx
    .update(orders)
    .set({
      status: 'paid',
      paidAt: now,
      gatewayPaymentId: paymentId ?? order.gatewayPaymentId,
      updatedAt: now,
    })
    .where(and(eq(orders.id, order.id), unpaidCondition()))
    .run();
  if (claimed.changes !== 1) return false;

  grantCredits(tx, {
    userId: order.userId,
    amount: order.credits,
    reason: 'purchase',
    idempotencyKey: `order:${order.id}`,
    note: order.kind === 'pack' ? `Credit pack ${order.itemId}` : `Plan ${order.itemId}`,
  });
  const period = activateSubscription(tx, order, now);
  if (period) {
    tx.update(orders)
      .set({ periodStart: period.start, periodEnd: period.end })
      .where(eq(orders.id, order.id))
      .run();
  }
  recordReceipt(tx, order, now, period?.end);
  return true;
}

/**
 * First month: incomplete -> active for one month from now. Renewal: the next month, counted
 * from the end of the previous one (paying early or late within the grace period neither gains nor
 * loses time). A payment for a subscription that has already ended still credits the buyer, but
 * does not bring the subscription back: they have to subscribe again.
 */
function activateSubscription(
  tx: Tx,
  order: OrderRow,
  now: number,
): { start: number; end: number } | null {
  if (order.subscriptionId === null) return null;
  const subscription = tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, order.subscriptionId))
    .get();
  if (!subscription) return null;

  if (order.kind === 'subscription_initial') {
    if (subscription.status !== 'incomplete') {
      log().warn('A first-month payment arrived for a subscription that is no longer incomplete', {
        orderId: order.id,
        subscriptionId: subscription.id,
        status: subscription.status,
      });
      return null;
    }
    const anchorDay = new Date(now).getUTCDate();
    const end = addMonthsUtc(now, 1, anchorDay);
    tx.update(subscriptions)
      .set({
        status: 'active',
        anchorDay,
        currentPeriodStart: now,
        currentPeriodEnd: end,
        nextChargeAt: end - RENEWAL_LEAD_MS,
        updatedAt: now,
      })
      .where(and(eq(subscriptions.id, subscription.id), eq(subscriptions.status, 'incomplete')))
      .run();
    return { start: now, end };
  }

  const previousEnd = subscription.currentPeriodEnd;
  const anchorDay = subscription.anchorDay;
  if (
    order.kind !== 'subscription_renewal' ||
    (subscription.status !== 'active' && subscription.status !== 'past_due') ||
    previousEnd === null ||
    anchorDay === null
  ) {
    log().warn('A renewal payment arrived for a subscription that has already ended', {
      orderId: order.id,
      subscriptionId: subscription.id,
      status: subscription.status,
    });
    return null;
  }
  const end = addMonthsUtc(previousEnd, 1, anchorDay);
  const claimed = tx
    .update(subscriptions)
    .set({
      status: 'active',
      currentPeriodStart: previousEnd,
      currentPeriodEnd: end,
      nextChargeAt: subscription.cancelAtPeriodEnd ? end : end - RENEWAL_LEAD_MS,
      updatedAt: now,
    })
    .where(
      and(
        eq(subscriptions.id, subscription.id),
        inArray(subscriptions.status, ['active', 'past_due']),
        eq(subscriptions.currentPeriodEnd, previousEnd),
      ),
    )
    .run();
  return claimed.changes === 1 ? { start: previousEnd, end } : null;
}

/**
 * A payment that was returned before we ever credited it (refunded or voided while the order was
 * still unpaid on our side): the books are even, nothing is granted. `refundedHalalas` is what the
 * gateway says went back (the order's full price when it is not given), never more than the price.
 */
export function markRefundedWithoutCredit(
  tx: Tx,
  order: OrderRow,
  paymentId: string | null,
  now: number,
  refundedHalalas: number = order.amountHalalas,
): boolean {
  const claimed = tx
    .update(orders)
    .set({
      status: 'refunded',
      refundedHalalas: Math.min(Math.max(Math.trunc(refundedHalalas), 0), order.amountHalalas),
      gatewayPaymentId: paymentId ?? order.gatewayPaymentId,
      updatedAt: now,
    })
    .where(and(eq(orders.id, order.id), unpaidCondition()))
    .run();
  if (claimed.changes !== 1) return false;
  endIncompleteSubscription(tx, order, 'expired', now);
  const returned = Math.min(Math.max(Math.trunc(refundedHalalas), 0), order.amountHalalas);
  recordRefund(
    tx,
    order,
    { refundedHalalas: returned, creditsTakenBack: 0, credited: false, planEnded: false },
    now,
  );
  return true;
}

/**
 * The gateway closed a renewal link that was still wanted (the payment page was canceled in the
 * dashboard, say): the subscription is due at once, so the next scheduler pass issues a new link
 * instead of waiting for the end of the grace period. A canceled subscription stays as it is.
 */
export function wakeSubscription(tx: Tx, subscriptionId: string | null, now: number): void {
  if (subscriptionId === null) return;
  tx.update(subscriptions)
    .set({ nextChargeAt: now })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        inArray(subscriptions.status, ['active', 'past_due']),
        eq(subscriptions.cancelAtPeriodEnd, false),
      ),
    )
    .run();
}

/**
 * The gateway says `refundedTotal` halalas of a paid order were returned. Takes back the matching
 * share of the credits (all of them for a full refund), bounded by the balance: credits the user
 * already spent cannot be recovered, and the order is then flagged `needs_review` with the
 * shortfall visible as `credits - clawed_back_credits`. The balance never goes negative.
 * Applying the same or a smaller total again changes nothing.
 */
export function applyRefund(tx: Tx, orderId: string, refundedTotal: number, now: number): OrderRow {
  const order = readOrder(tx, orderId);
  const target = Math.min(Math.max(Math.trunc(refundedTotal), 0), order.amountHalalas);
  if (target <= order.refundedHalalas) return order;

  const full = target >= order.amountHalalas;
  const granted = order.paidAt !== null;
  const creditsToTake = !granted
    ? 0
    : full
      ? order.credits
      : Math.floor((order.credits * target) / order.amountHalalas);
  const wanted = Math.max(0, creditsToTake - order.clawedBackCredits);
  const taken =
    wanted > 0
      ? clawbackCredits(tx, {
          userId: order.userId,
          amount: wanted,
          idempotencyKey: `clawback:${order.id}:${target}`,
          note: `Refund of order ${order.id}`,
        })
      : 0;
  const shortfall = wanted - taken;
  const status = shortfall > 0 ? 'needs_review' : full ? 'refunded' : order.status;

  const claimed = tx
    .update(orders)
    .set({
      status,
      refundedHalalas: target,
      clawedBackCredits: order.clawedBackCredits + taken,
      updatedAt: now,
    })
    .where(and(eq(orders.id, order.id), eq(orders.refundedHalalas, order.refundedHalalas)))
    .run();
  if (claimed.changes !== 1) {
    // Another writer got there first inside the same lock window; nothing of ours may stay.
    throw new Error(`Order ${order.id} changed while its refund was applied`);
  }

  if (shortfall > 0) {
    log().error(
      'A refund could not take back all of its credits: the user had already spent them',
      {
        orderId: order.id,
        userId: order.userId,
        credits: order.credits,
        clawedBack: order.clawedBackCredits + taken,
        shortfall,
      },
    );
  }
  const planEnded = full && granted && endSubscriptionFundedBy(tx, order, now);
  recordRefund(
    tx,
    order,
    {
      refundedHalalas: target - order.refundedHalalas,
      creditsTakenBack: taken,
      credited: granted,
      planEnded,
    },
    now,
  );
  return readOrder(tx, orderId);
}

/**
 * Ends a subscription at once: no renewal link will be issued again. The credits it already
 * granted stay (they never expire); a pending renewal link is withdrawn by the scheduler. Works on
 * an unpaid first month too. Returns false when there was nothing left to end.
 */
export function endSubscriptionNow(tx: Tx, subscriptionId: string, now: number): boolean {
  const claimed = tx
    .update(subscriptions)
    .set({
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: now,
      nextChargeAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(subscriptions.id, subscriptionId),
        inArray(subscriptions.status, ['incomplete', 'active', 'past_due']),
      ),
    )
    .run();
  return claimed.changes === 1;
}

/** Refunding the payment that funded the CURRENT month ends the subscription now. True when it did. */
function endSubscriptionFundedBy(tx: Tx, order: OrderRow, now: number): boolean {
  if (order.subscriptionId === null || order.periodStart === null) return false;
  const ended = tx
    .update(subscriptions)
    .set({
      status: 'canceled',
      cancelAtPeriodEnd: true,
      canceledAt: now,
      nextChargeAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(subscriptions.id, order.subscriptionId),
        inArray(subscriptions.status, ['active', 'past_due']),
        eq(subscriptions.currentPeriodStart, order.periodStart),
      ),
    )
    .run();
  return ended.changes === 1;
}
