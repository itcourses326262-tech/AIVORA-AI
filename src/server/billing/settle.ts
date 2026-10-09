import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb, withTx, type DbOrTx } from '@/server/db';
import { orders, users, type OrderRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import type { GatewayPaymentState } from './gateway';
import {
  applyRefund,
  closeOrder,
  flagForReview,
  isUnpaid,
  markPaid,
  markRefundedWithoutCredit,
  wakeSubscription,
} from './transitions';

/**
 * The one place where money state is decided. A webhook, the buyer returning from the payment
 * page, the order poll, the scheduler and the operator all end up in `settleOrder`, which asks the
 * gateway what is true NOW and applies exactly that, atomically and idempotently. None of the
 * callers' inputs (a webhook body, a query string, a status they believe in) reach the decision.
 */

const log = () => getLogger().child({ module: 'billing' });

export type SettleOutcome =
  | 'paid' // this call granted the credits
  | 'already_paid'
  | 'pending'
  | 'closed' // the checkout ended without a payment
  | 'refunded'
  | 'needs_review' // money and order disagree; nothing was credited
  | 'unchanged';

export interface SettleResult {
  order: OrderRow;
  outcome: SettleOutcome;
}

export interface ApplyOptions {
  now: number;
  /** What a checkout that ended unpaid becomes: `canceled` when we closed it ourselves. */
  closeAs?: 'failed' | 'canceled';
}

/**
 * Compares the gateway's answer with the order and moves the order to match, in ONE transaction.
 * `null` means the gateway does not know the checkout (nothing to apply).
 */
export function applyGatewayState(
  db: DbOrTx,
  orderId: string,
  state: GatewayPaymentState | null,
  options: ApplyOptions,
): SettleResult {
  const { now, closeAs = 'failed' } = options;
  const result = withTx(db, (tx): SettleResult => {
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
    if (!order) throw new Error(`Order ${orderId} does not exist`);
    tx.update(orders).set({ lastCheckedAt: now }).where(eq(orders.id, orderId)).run();

    const unchanged = (outcome: SettleOutcome): SettleResult => ({ order, outcome });
    if (!state || state.invoiceId !== order.gatewayInvoiceId) return unchanged('unchanged');

    if (state.status === 'pending') return unchanged('pending');
    if (state.status === 'closed') {
      if (order.status !== 'pending') return unchanged('unchanged');
      if (closeOrder(tx, order, closeAs, now) && closeAs === 'failed') {
        // The gateway ended a payment page we still wanted: a renewal is offered again at once.
        if (order.kind === 'subscription_renewal') wakeSubscription(tx, order.subscriptionId, now);
      }
      return { order: readBack(tx, orderId), outcome: 'closed' };
    }

    // From here the gateway says money moved. It must be exactly the money this order asked for:
    // the checkout AND the payment(s) behind it, in amount and currency, under our reference.
    const unpaid = isUnpaid(order);
    const matches =
      state.amountHalalas === order.amountHalalas &&
      state.currency === order.currency &&
      (state.paidAmountHalalas ?? state.amountHalalas) === order.amountHalalas &&
      (state.paidCurrency ?? state.currency) === order.currency &&
      state.reference === order.id;
    if (!matches) {
      if (state.status === 'refunded' && unpaid) {
        // Whatever it was, all of it went back: the books are even and nobody has to look.
        markRefundedWithoutCredit(tx, order, state.paymentId, now, state.refundedHalalas);
        return { order: readBack(tx, orderId), outcome: 'refunded' };
      }
      log().error('A payment does not match its order; nothing was credited', {
        orderId: order.id,
        expectedAmount: order.amountHalalas,
        gotAmount: state.paidAmountHalalas ?? state.amountHalalas,
        expectedCurrency: order.currency,
        gotCurrency: state.paidCurrency ?? state.currency,
        referenceMatches: state.reference === order.id,
      });
      const flagged = unpaid && flagForReview(tx, order, now);
      return { order: readBack(tx, orderId), outcome: flagged ? 'needs_review' : 'unchanged' };
    }

    if (state.status === 'refunded') {
      if (unpaid) {
        markRefundedWithoutCredit(tx, order, state.paymentId, now, state.refundedHalalas);
        return { order: readBack(tx, orderId), outcome: 'refunded' };
      }
      const refunded = applyRefund(tx, orderId, state.refundedHalalas, now);
      return {
        order: refunded,
        outcome: refunded.status === 'refunded' ? 'refunded' : 'unchanged',
      };
    }

    // state.status === 'paid'
    if (unpaid && accountIsDeleted(tx, order.userId)) {
      // Someone paid for an account that no longer exists (its checkout could not be withdrawn in
      // time). The credits would be unreachable; a person refunds the payment.
      log().error('A payment arrived for a deleted account; nothing was credited', {
        orderId: order.id,
        userId: order.userId,
      });
      const flagged = flagForReview(tx, order, now);
      return { order: readBack(tx, orderId), outcome: flagged ? 'needs_review' : 'unchanged' };
    }
    let outcome: SettleOutcome = 'already_paid';
    if (unpaid && markPaid(tx, order, state.paymentId, now)) outcome = 'paid';
    if (state.refundedHalalas > 0) applyRefund(tx, orderId, state.refundedHalalas, now);
    return { order: readBack(tx, orderId), outcome };
  });

  if (result.outcome === 'paid') {
    log().info('Order paid', {
      orderId: result.order.id,
      userId: result.order.userId,
      kind: result.order.kind,
      amountHalalas: result.order.amountHalalas,
      credits: result.order.credits,
    });
  }
  return result;
}

function accountIsDeleted(db: DbOrTx, userId: string): boolean {
  const owner = db
    .select({ deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return owner?.deletedAt !== null && owner?.deletedAt !== undefined;
}

function readBack(db: DbOrTx, orderId: string): OrderRow {
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) throw new Error(`Order ${orderId} does not exist`);
  return order;
}

/**
 * Asks the gateway about the order and applies the answer. Returns null for an unknown order.
 * Throws `provider_error` when the gateway cannot be reached; callers decide whether that matters
 * (a webhook answers 5xx so it is retried, a browser return shrugs and polls).
 */
export async function settleOrder(
  orderId: string,
  options: { now?: number; closeAs?: 'failed' | 'canceled' } = {},
): Promise<SettleResult | null> {
  const db = getDb();
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;
  const gateway = getGateway();
  if (order.gateway !== gateway.id || order.gatewayInvoiceId === null) {
    return { order, outcome: 'unchanged' };
  }
  const state = await gateway.fetchPayment({ invoiceId: order.gatewayInvoiceId });
  return applyGatewayState(db, orderId, state, {
    now: options.now ?? Date.now(),
    closeAs: options.closeAs,
  });
}

// One in-flight check per order per process, so a burst of polls costs one gateway call.
const inFlight = new Map<string, Promise<SettleResult | null>>();

/**
 * `settleOrder` for callers that can be triggered by anybody (the buyer's browser, a poll): a
 * pending order is looked at at most once per `minIntervalMs` and concurrent callers share one call.
 */
export async function refreshOrder(
  orderId: string,
  options: { minIntervalMs: number; now?: number },
): Promise<SettleResult | null> {
  const now = options.now ?? Date.now();
  const order = getDb().select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order) return null;
  if (
    order.status !== 'pending' ||
    (order.lastCheckedAt !== null && now - order.lastCheckedAt < options.minIntervalMs)
  ) {
    return { order, outcome: 'unchanged' };
  }
  const running = inFlight.get(orderId);
  if (running) return running;
  const started = settleOrder(orderId, { now }).finally(() => inFlight.delete(orderId));
  inFlight.set(orderId, started);
  return started;
}

/**
 * Closes a pending checkout for good: the buyer abandoned it, or the subscription behind it ended.
 * The gateway is told first, then asked what is true, because the buyer may have paid a moment
 * ago: in that case the order is settled as paid and nobody loses money. If the checkout is still
 * payable afterwards (the gateway refused to cancel it) the order stays pending and this throws.
 */
export async function closeCheckout(
  orderId: string,
  reason: 'failed' | 'canceled',
  now: number = Date.now(),
): Promise<OrderRow | null> {
  const db = getDb();
  const order = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!order || order.status !== 'pending') return order ?? null;

  const gateway = getGateway();
  if (order.gateway !== gateway.id) return order;
  if (order.gatewayInvoiceId === null) {
    // No checkout was ever created, so nothing can be paid.
    withTx(db, (tx) => closeOrder(tx, order, reason, now));
    return readBack(db, orderId);
  }

  let cancelError: unknown;
  try {
    await gateway.cancelCheckout(order.gatewayInvoiceId);
  } catch (error) {
    cancelError = error;
  }
  const settled = await settleOrder(orderId, { now, closeAs: reason });
  if (settled && settled.order.status !== 'pending') return settled.order;
  if (cancelError !== undefined) throw cancelError;
  return settled?.order ?? null;
}
