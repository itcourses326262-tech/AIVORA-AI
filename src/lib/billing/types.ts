/**
 * Vocabulary of the billing module, shared by the database schema, the API DTOs and the UI.
 * Everything here is isomorphic: no secrets, no node APIs.
 */

/** The only currency the shop sells in. Amounts are integers in halalas (1 SAR = 100 halalas). */
export const BILLING_CURRENCY = 'SAR';
export type BillingCurrency = typeof BILLING_CURRENCY;

export const HALALAS_PER_SAR = 100;

/** What a buyer can ask for: a one-time credit pack or a monthly subscription plan. */
export const PURCHASE_TYPES = ['pack', 'subscription'] as const;
export type PurchaseType = (typeof PURCHASE_TYPES)[number];

export const ORDER_KINDS = ['pack', 'subscription_initial', 'subscription_renewal'] as const;
export type OrderKind = (typeof ORDER_KINDS)[number];

/**
 * - `pending`      a checkout exists and may still be paid
 * - `paid`         the gateway confirmed the payment and the credits were granted
 * - `failed`       the checkout ended without a payment (expired, closed by the gateway, never created)
 * - `canceled`     we closed the checkout on purpose (the buyer or a subscription change)
 * - `refunded`     the whole payment was returned and the credits were taken back
 * - `needs_review` money and credits disagree and a human has to look (amount mismatch, or a
 *                  refund that could not take every credit back because they were already spent)
 */
export const ORDER_STATUSES = [
  'pending',
  'paid',
  'failed',
  'canceled',
  'refunded',
  'needs_review',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'active',
  'past_due',
  'canceled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A subscription that still occupies the "one subscription per account" slot. */
export const LIVE_SUBSCRIPTION_STATUSES = ['incomplete', 'active', 'past_due'] as const;

/** Which payment backend an order was created with. `off` never creates orders. */
export const BILLING_GATEWAY_IDS = ['mock', 'moyasar'] as const;
export type BillingGatewayId = (typeof BILLING_GATEWAY_IDS)[number];

/** Values of `BILLING_GATEWAY`; `auto` picks by environment, `off` disables buying. */
export const BILLING_GATEWAY_SETTINGS = ['auto', 'mock', 'moyasar', 'off'] as const;
export type BillingGatewaySetting = (typeof BILLING_GATEWAY_SETTINGS)[number];
export type BillingMode = BillingGatewayId | 'off';
