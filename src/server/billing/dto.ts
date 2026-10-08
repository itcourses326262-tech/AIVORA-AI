import 'server-only';
import type { OrderDTO, SubscriptionDTO } from '@/lib/api-types';
import type { OrderRow, SubscriptionRow } from '@/server/db/schema';

/**
 * Public shape of an order. The gateway's ids, the idempotency key and the reconciliation
 * bookkeeping stay inside; `checkoutUrl` is only offered while the order can still be paid.
 */
export function toOrderDTO(order: OrderRow, now: number = Date.now()): OrderDTO {
  const payable =
    order.status === 'pending' &&
    order.checkoutUrl !== null &&
    (order.expiresAt === null || order.expiresAt > now);
  return {
    id: order.id,
    kind: order.kind,
    itemId: order.itemId,
    amountHalalas: order.amountHalalas,
    vatHalalas: order.vatHalalas,
    currency: 'SAR',
    credits: order.credits,
    status: order.status,
    createdAt: order.createdAt,
    ...(order.paidAt === null ? {} : { paidAt: order.paidAt }),
    ...(order.expiresAt === null ? {} : { expiresAt: order.expiresAt }),
    ...(payable && order.checkoutUrl !== null ? { checkoutUrl: order.checkoutUrl } : {}),
    refundedHalalas: order.refundedHalalas,
    ...(order.subscriptionId === null ? {} : { subscriptionId: order.subscriptionId }),
    ...(order.periodStart === null ? {} : { periodStart: order.periodStart }),
    ...(order.periodEnd === null ? {} : { periodEnd: order.periodEnd }),
  };
}

export function toSubscriptionDTO(
  subscription: SubscriptionRow,
  pendingOrder: OrderRow | undefined,
  now: number = Date.now(),
): SubscriptionDTO {
  return {
    id: subscription.id,
    planId: subscription.planId,
    status: subscription.status,
    ...(subscription.currentPeriodStart === null
      ? {}
      : { currentPeriodStart: subscription.currentPeriodStart }),
    ...(subscription.currentPeriodEnd === null
      ? {}
      : { currentPeriodEnd: subscription.currentPeriodEnd }),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    ...(subscription.canceledAt === null ? {} : { canceledAt: subscription.canceledAt }),
    createdAt: subscription.createdAt,
    ...(pendingOrder ? { pendingOrder: toOrderDTO(pendingOrder, now) } : {}),
  };
}
