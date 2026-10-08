import 'server-only';
import type { BillingCurrency, BillingGatewayId } from '@/lib/billing/types';

/**
 * What the billing services need from a payment gateway, and nothing else. The services never
 * look inside a gateway's JSON: every gateway-specific detail (URLs, field names, statuses,
 * webhook authentication) stays inside its adapter (`moyasar.ts`, `mock.ts`).
 *
 * Trust model: a gateway call that RETURNS data (`fetchPayment`) is the only source of payment
 * truth. A webhook or a browser return is merely a hint that the truth changed; the services
 * ask `fetchPayment` before they grant or take back a single credit.
 */

export interface GatewayCheckoutInput {
  /** Our order id; the gateway stores it with the checkout and `fetchPayment` echoes it back. */
  orderId: string;
  amountHalalas: number;
  currency: BillingCurrency;
  /** Shown to the buyer on the hosted payment page. */
  description: string;
  /** Where the buyer's browser is sent after paying / when they go back. Same-site, ours. */
  successUrl: string;
  backUrl: string;
  /** Epoch ms after which the hosted page refuses payments. */
  expiresAt: number;
}

export interface GatewayCheckout {
  /** The gateway's id of the hosted checkout (a Moyasar invoice). */
  invoiceId: string;
  /** Where to send the buyer. */
  checkoutUrl: string;
}

/**
 * - `pending`  not paid (yet): initiated, on hold, or a failed attempt on a checkout that can be retried
 * - `paid`     paid in full (a partial refund shows in `refundedHalalas`)
 * - `closed`   ended without a payment: canceled, expired, voided
 * - `refunded` paid and then returned in full
 */
export type GatewayPaymentStatus = 'pending' | 'paid' | 'closed' | 'refunded';

export interface GatewayPaymentState {
  status: GatewayPaymentStatus;
  invoiceId: string;
  /** The payment that settled the checkout, once there is one. Needed to refund. */
  paymentId: string | null;
  amountHalalas: number;
  currency: string;
  /** Our order id as the gateway stored it, or null when it is missing. */
  reference: string | null;
  refundedHalalas: number;
}

/** What a webhook says, reduced to hints. None of it is trusted; it only says WHERE to look. */
export interface GatewayWebhookEvent {
  /** `<gateway>:<event id>`: a redelivery of the same event has the same key. */
  eventKey: string;
  /** The gateway's event name, for the audit trail. */
  type: string;
  /** Hash of the payload without the shared secret. */
  payloadHash: string;
  invoiceId: string | null;
  paymentId: string | null;
  orderRef: string | null;
}

export interface BillingGateway {
  readonly id: BillingGatewayId;
  createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckout>;
  /** The gateway's current view of a checkout, or null when it does not know the id. */
  fetchPayment(ref: { invoiceId: string }): Promise<GatewayPaymentState | null>;
  /** Makes an unpaid checkout unpayable. Throws when it cannot (for example, it was just paid). */
  cancelCheckout(invoiceId: string): Promise<void>;
  /** Returns `amountHalalas` of a paid checkout to the buyer. The caller re-reads the state afterwards. */
  refund(input: { paymentId: string; amountHalalas: number }): Promise<void>;
  /**
   * Authenticates a webhook delivery and extracts its hints. Throws an `unauthorized` AppError for
   * a missing or wrong secret, `bad_request` for a body that is not a webhook. Constant-time.
   */
  verifyWebhook(delivery: { headers: Headers; rawBody: string }): GatewayWebhookEvent;
}
