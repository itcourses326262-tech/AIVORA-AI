import 'server-only';
import { AppError } from '@/lib/errors';
import { getDb } from '@/server/db';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import type { GatewayPaymentState } from './gateway';
import { findOrder } from './orders';
import { settleOrder, type SettleResult } from './settle';

/**
 * Operator refund (`npm run admin -- refund-order`): returns money to the buyer through the
 * gateway, then lets `settleOrder` read the gateway's answer and take the credits back. The
 * credit side is therefore the same code whether the refund was started here, in the Moyasar
 * dashboard or by a chargeback.
 *
 * The gateway has no refund idempotency key, so a refund that was sent must never be sent twice by
 * accident. The amount is read from the gateway (never from our books), a failed call is followed
 * by a look at what the gateway really did before anything is reported, and `expectTotalHalalas`
 * lets the operator say what the refunded total must be afterwards: a retry of a refund that did
 * go through then refuses instead of refunding again.
 */

export interface RefundOptions {
  /** What to refund; everything that is left when omitted. */
  amountHalalas?: number;
  /** The refunded total the gateway must show once this refund is done. Anything else is refused. */
  expectTotalHalalas?: number;
  now?: number;
}

export interface RefundResult extends SettleResult {
  /** The gateway's refunded total before this refund and the amount refunded now. */
  refundedBeforeHalalas: number;
  refundedNowHalalas: number;
}

/** What was really charged: the money of the payment, which can differ from the invoice. */
function chargedHalalas(state: GatewayPaymentState): number {
  return state.paidAmountHalalas ?? state.amountHalalas;
}

export async function refundOrder(
  orderId: string,
  options: RefundOptions = {},
): Promise<RefundResult> {
  const gateway = getGateway();
  const first = await settleOrder(orderId, { now: options.now });
  const order = first?.order ?? findOrder(getDb(), orderId);
  if (!order) throw AppError.of('not_found', 'Unknown order');
  if (order.gateway !== gateway.id) {
    throw AppError.of(
      'conflict',
      `This order was made with the ${order.gateway} payment gateway, but this process uses ${gateway.id}`,
    );
  }
  if (order.gatewayInvoiceId === null) {
    throw AppError.of('conflict', 'This order has no payment to refund');
  }

  // Ask the gateway, not our books, how much is left to refund and which payment to refund.
  const state = await gateway.fetchPayment({ invoiceId: order.gatewayInvoiceId });
  if (!state || state.status === 'pending' || state.status === 'closed') {
    throw AppError.of('conflict', 'This order has no completed payment to refund');
  }
  if (state.paymentId === null) {
    throw AppError.of('conflict', 'The gateway did not say which payment settled this order');
  }
  const remaining = chargedHalalas(state) - state.refundedHalalas;
  if (remaining < 1) {
    throw AppError.of('bad_request', 'This payment has already been refunded in full', {
      remainingHalalas: 0,
      refundedHalalas: state.refundedHalalas,
    });
  }
  const amount = options.amountHalalas ?? remaining;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) {
    throw AppError.of('bad_request', `The refund must be between 1 and ${remaining} halalas`, {
      remainingHalalas: remaining,
      refundedHalalas: state.refundedHalalas,
    });
  }
  if (
    options.expectTotalHalalas !== undefined &&
    state.refundedHalalas + amount !== options.expectTotalHalalas
  ) {
    throw AppError.of(
      'conflict',
      `The gateway already shows ${state.refundedHalalas} halalas refunded; refunding ${amount} more would make ${state.refundedHalalas + amount}, not the ${options.expectTotalHalalas} you expected. Nothing was refunded.`,
      { refundedHalalas: state.refundedHalalas, amountHalalas: amount },
    );
  }

  try {
    await gateway.refund({ paymentId: state.paymentId, amountHalalas: amount });
  } catch (error) {
    // The answer may have been lost AFTER the refund went through. Look before reporting a failure,
    // because the operator's natural reaction to a failure is to run the command again.
    const after = await gateway
      .fetchPayment({ invoiceId: order.gatewayInvoiceId })
      .catch(() => undefined);
    if (after && after.refundedHalalas >= state.refundedHalalas + amount) {
      getLogger().warn('The refund call failed, but the gateway shows the refund', {
        module: 'billing',
        orderId: order.id,
        amountHalalas: amount,
      });
    } else if (after) {
      getLogger().error('The gateway did not refund', {
        module: 'billing',
        orderId: order.id,
        err: error,
      });
      throw AppError.of(
        'provider_error',
        `The gateway did not complete the refund; it shows ${after.refundedHalalas} of ${chargedHalalas(after)} halalas refunded. Nothing was lost by trying again.`,
        { refundedHalalas: after.refundedHalalas },
      );
    } else {
      getLogger().error('The refund call failed and the gateway could not be asked', {
        module: 'billing',
        orderId: order.id,
        err: error,
      });
      throw AppError.of(
        'provider_error',
        'The refund request failed and the gateway could not be asked what happened. It may have gone through: look at the order in the Moyasar dashboard BEFORE running this command again.',
      );
    }
  }
  getLogger().info('Refund sent to the gateway', {
    module: 'billing',
    orderId: order.id,
    amountHalalas: amount,
  });
  const settled = await settleOrder(orderId, { now: options.now });
  if (!settled) throw AppError.of('not_found', 'Unknown order');
  return { ...settled, refundedBeforeHalalas: state.refundedHalalas, refundedNowHalalas: amount };
}
