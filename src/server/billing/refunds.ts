import 'server-only';
import { AppError } from '@/lib/errors';
import { getDb } from '@/server/db';
import { getLogger } from '@/server/logger';
import { getGateway } from './config';
import { findOrder } from './orders';
import { settleOrder, type SettleResult } from './settle';

/**
 * Operator refund (`npm run admin -- refund-order`): returns money to the buyer through the
 * gateway, then lets `settleOrder` read the gateway's answer and take the credits back. The
 * credit side is therefore the same code whether the refund was started here, in the Moyasar
 * dashboard or by a chargeback.
 */
export async function refundOrder(
  orderId: string,
  options: { amountHalalas?: number; now?: number } = {},
): Promise<SettleResult> {
  const gateway = getGateway();
  const first = await settleOrder(orderId, { now: options.now });
  const order = first?.order ?? findOrder(getDb(), orderId);
  if (!order) throw AppError.of('not_found', 'Unknown order');
  if (order.gateway !== gateway.id) {
    throw AppError.of('conflict', 'This order was made with another payment gateway');
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
  const remaining = state.amountHalalas - state.refundedHalalas;
  const amount = options.amountHalalas ?? remaining;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > remaining) {
    throw AppError.of('bad_request', `The refund must be between 1 and ${remaining} halalas`, {
      remainingHalalas: remaining,
    });
  }

  await gateway.refund({ paymentId: state.paymentId, amountHalalas: amount });
  getLogger().info('Refund sent to the gateway', {
    module: 'billing',
    orderId: order.id,
    amountHalalas: amount,
  });
  const settled = await settleOrder(orderId, { now: options.now });
  if (!settled) throw AppError.of('not_found', 'Unknown order');
  return settled;
}
