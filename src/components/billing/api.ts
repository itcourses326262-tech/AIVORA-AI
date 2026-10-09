import { api } from '@/lib/api-client';
import type { CheckoutRequest, OrderDTO, Page, SubscriptionDTO } from '@/lib/api-types';

/** Typed calls to `/api/v1/billing/*`. A checkout names an item and never an amount: every figure shown comes from the server. */

const ORDERS_PAGE_SIZE = 20;

/**
 * Starts a purchase. The body names an item and nothing else; `idempotencyKey` makes a double
 * click or a retry after a lost answer return the same order instead of opening a second checkout.
 */
export function startCheckout(
  request: CheckoutRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<OrderDTO> {
  return api.post<OrderDTO>('/billing/checkout', request, {
    headers: { 'Idempotency-Key': idempotencyKey },
    signal,
  });
}

export function fetchOrder(orderId: string, signal?: AbortSignal): Promise<OrderDTO> {
  return api.get<OrderDTO>(`/billing/orders/${encodeURIComponent(orderId)}`, { signal });
}

export function fetchOrders(cursor?: string, signal?: AbortSignal): Promise<Page<OrderDTO>> {
  return api.page<OrderDTO>('/billing/orders', {
    query: { limit: ORDERS_PAGE_SIZE, cursor },
    signal,
  });
}

/** The running subscription, else the last one that ended, else `null`. */
export function fetchSubscription(signal?: AbortSignal): Promise<SubscriptionDTO | null> {
  return api.get<SubscriptionDTO | null>('/billing/subscription', { signal });
}

export function cancelSubscription(): Promise<SubscriptionDTO> {
  return api.post<SubscriptionDTO>('/billing/subscription/cancel');
}

export function resumeSubscription(): Promise<SubscriptionDTO> {
  return api.post<SubscriptionDTO>('/billing/subscription/resume');
}
