import type { AddressLimits } from '@/server/auth/address-route';
import type { RateLimitOptions } from '@/server/http/route';

/** Each checkout creates a hosted payment page at the gateway, so it is the tightest limit. */
export const CHECKOUT_LIMIT: RateLimitOptions = {
  name: 'billing-checkout',
  limit: 10,
  windowSec: 60,
  by: 'user',
};

/** Order list and the return page's poll. */
export const BILLING_READ_LIMIT: RateLimitOptions = {
  name: 'billing-read',
  limit: 60,
  windowSec: 60,
  by: 'user',
};

export const SUBSCRIPTION_WRITE_LIMIT: RateLimitOptions = {
  name: 'billing-subscription',
  limit: 10,
  windowSec: 60,
  by: 'user',
};

/** The public price list: cheap, cacheable. */
export const PLANS_LIMITS: AddressLimits = {
  perAddress: { name: 'billing-plans', limit: 120, windowSec: 60, by: 'ip' },
  sharedAddress: { name: 'billing-plans-shared', limit: 1200, windowSec: 60, by: 'ip' },
};

/**
 * Generous on purpose: the sender is the gateway, whose addresses are few and shared, and a
 * rejected delivery is only retried hours later (the reconciliation loop covers the gap).
 * Authenticity is the shared secret, not the address.
 */
export const WEBHOOK_LIMITS: AddressLimits = {
  perAddress: { name: 'billing-webhook', limit: 600, windowSec: 60, by: 'ip' },
  sharedAddress: { name: 'billing-webhook-shared', limit: 1200, windowSec: 60, by: 'ip' },
};

/** The buyer's browser coming back from the payment page. */
export const RETURN_LIMITS: AddressLimits = {
  perAddress: { name: 'billing-return', limit: 60, windowSec: 60, by: 'ip' },
  sharedAddress: { name: 'billing-return-shared', limit: 600, windowSec: 60, by: 'ip' },
};
