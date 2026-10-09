import 'server-only';
import { and, eq } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { getDb, withTx } from '@/server/db';
import { orders, type OrderRow } from '@/server/db/schema';
import { getLogger } from '@/server/logger';

/**
 * The end of the `needs_review` queue. An order lands there when money and order disagree (a
 * payment of another amount or currency, a missing reference) or when a refund could not take all
 * its credits back. Most of them resolve themselves (the gateway later shows a matching payment,
 * or the money went back: see `settle.ts`); the rest are decided by a person, who then closes the
 * order here. Closing moves no money and no credits, it only records the decision and takes the
 * order out of the queue; the note lands in the log.
 */

export type ResolvedStatus = 'refunded' | 'paid' | 'canceled';

/**
 * Where a reviewed order ends up: `refunded` when all of its money went back, `paid` when its
 * credits were granted (any credits that could not be recovered are accepted as lost), `canceled`
 * when it was never credited and the person decided that stays so.
 */
export function resolvedStatus(
  order: Pick<OrderRow, 'refundedHalalas' | 'amountHalalas' | 'paidAt'>,
): ResolvedStatus {
  if (order.refundedHalalas >= order.amountHalalas) return 'refunded';
  return order.paidAt !== null ? 'paid' : 'canceled';
}

export function resolveReviewedOrder(
  orderId: string,
  note: string,
  now: number = Date.now(),
): OrderRow {
  const trimmed = note.trim();
  if (trimmed.length < 3) {
    throw AppError.of('bad_request', 'Say what was decided (a note of a few words)');
  }
  const db = getDb();
  const result = withTx(db, (tx) => {
    const order = tx.select().from(orders).where(eq(orders.id, orderId)).get();
    if (!order) throw AppError.of('not_found', `No order ${orderId}`);
    if (order.status !== 'needs_review') {
      throw AppError.of('conflict', `Order ${orderId} is ${order.status}, not needs_review`);
    }
    const to = resolvedStatus(order);
    const claimed = tx
      .update(orders)
      .set({ status: to, updatedAt: now })
      .where(and(eq(orders.id, orderId), eq(orders.status, 'needs_review')))
      .run();
    if (claimed.changes !== 1) {
      throw AppError.of('conflict', `Order ${orderId} changed while it was being resolved`);
    }
    return { order, to };
  });
  getLogger().warn('An order that needed review was resolved by an operator', {
    module: 'billing',
    orderId,
    to: result.to,
    credits: result.order.credits,
    clawedBackCredits: result.order.clawedBackCredits,
    refundedHalalas: result.order.refundedHalalas,
    note: trimmed.slice(0, 500),
  });
  const closed = db.select().from(orders).where(eq(orders.id, orderId)).get();
  if (!closed) throw new Error(`Order ${orderId} disappeared`);
  return closed;
}
