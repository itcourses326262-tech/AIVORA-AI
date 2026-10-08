'use server';

import { notFound, redirect } from 'next/navigation';
import { POST as receiveWebhook } from '@/app/api/v1/billing/webhooks/moyasar/route';
import { requireUser } from '@/lib/auth-guard';
import { isValidId } from '@/lib/id';
import { getMockGateway } from '@/server/billing/mock';
import { findOwnedOrder } from '@/server/billing/orders';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';

/**
 * The "Pay" and "Fail" buttons of the fake payment page. They do what the real gateway does:
 * change the payment on ITS side, tell us through the webhook route (the real handler, with its
 * authentication, rate limit and idempotency), and then send the browser to the success URL
 * (`/api/v1/billing/return`). Nothing here touches an order or a balance directly.
 */
export async function completeMockCheckout(formData: FormData): Promise<void> {
  // Hard-disabled in production, whatever else is configured.
  if (process.env.NODE_ENV === 'production') notFound();

  const orderId = formData.get('orderId');
  const outcome = formData.get('outcome');
  if (!isValidId(orderId, 'ord') || (outcome !== 'pay' && outcome !== 'fail')) notFound();

  const user = await requireUser(`/billing/mock-checkout/${orderId}`);
  const order = findOwnedOrder(getDb(), user.id, orderId);
  if (!order || order.gateway !== 'mock') notFound();

  const gateway = getMockGateway();
  if (order.status === 'pending' && gateway.hasCheckout(orderId)) {
    if (outcome === 'pay') gateway.simulatePayment(orderId);
    else gateway.simulateDecline(orderId);
    const delivery = gateway.webhookFor(
      orderId,
      outcome === 'pay' ? 'payment_paid' : 'payment_failed',
    );
    const response = await receiveWebhook(
      new Request(`${getEnv().APP_URL}/api/v1/billing/webhooks/moyasar`, {
        method: 'POST',
        headers: delivery.headers,
        body: delivery.rawBody,
      }),
    );
    if (!response.ok) {
      getLogger().warn('The mock webhook was not accepted; the return step will settle the order', {
        module: 'billing',
        status: response.status,
      });
    }
  }
  redirect(`/api/v1/billing/return?order=${orderId}`);
}
