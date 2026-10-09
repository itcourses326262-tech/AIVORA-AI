import type { Locale } from '@/lib/i18n/locales';
import type { BillingEmailKind } from '@/server/email/types';
import type { BillingEmailSpec } from '@/server/email/templates/billing';

export const BILLING_LINK = 'https://aivore.example/account/billing';
export const PAY_LINK = 'https://checkout.example.com/invoices/inv_123?lang=en';
export const PRICING_LINK = 'https://aivore.example/pricing';
export const SUPPORT = 'support@aivore.example';

const DUE = Date.UTC(2026, 10, 8, 10, 30);
const DAY = 24 * 60 * 60 * 1000;

/** One complete spec per billing mail kind, in the given language; `overrides` change single fields. */
export function billingSpec(
  kind: BillingEmailKind,
  locale: Locale,
  overrides: Record<string, unknown> = {},
): BillingEmailSpec {
  const common = {
    locale,
    to: 'layla@example.com',
    name: 'Layla <b>"Q"</b> & Co',
    billingLink: BILLING_LINK,
    supportEmail: SUPPORT,
  };
  const item = locale === 'ar' ? 'باقة المحترف' : 'Pro plan';
  switch (kind) {
    case 'payment_receipt':
      return {
        ...common,
        kind,
        item,
        reference: 'ord_01k8m3v2h5j8k1m4n7p0q3r6st',
        amountHalalas: 13_900,
        vatHalalas: 1_813,
        credits: 3_000,
        paidAt: Date.UTC(2026, 9, 8, 10, 30),
        paidUntil: DUE,
        plan: true,
        renewal: false,
        leadDays: 3,
        ...overrides,
      } as BillingEmailSpec;
    case 'renewal_link':
      return {
        ...common,
        kind,
        item,
        amountHalalas: 13_900,
        credits: 3_000,
        dueAt: DUE,
        graceEndsAt: DUE + 7 * DAY,
        link: PAY_LINK,
        ...overrides,
      } as BillingEmailSpec;
    case 'payment_overdue':
      return {
        ...common,
        kind,
        item,
        amountHalalas: 13_900,
        dueAt: DUE,
        graceEndsAt: DUE + 7 * DAY,
        link: PAY_LINK,
        ...overrides,
      } as BillingEmailSpec;
    case 'subscription_expired':
      return { ...common, kind, item, pricingLink: PRICING_LINK, ...overrides } as BillingEmailSpec;
    case 'refund_notice':
      return {
        ...common,
        kind,
        item,
        reference: 'ord_01k8m3v2h5j8k1m4n7p0q3r6st',
        refundedHalalas: 13_900,
        refundedTotalHalalas: 13_900,
        orderAmountHalalas: 13_900,
        creditsTakenBack: 3_000,
        credited: true,
        planEnded: true,
        ...overrides,
      } as BillingEmailSpec;
    case 'subscription_canceled':
      return { ...common, kind, item, endsAt: DUE, ...overrides } as BillingEmailSpec;
    case 'subscription_resumed':
      return {
        ...common,
        kind,
        item,
        renewsAt: DUE,
        leadDays: 3,
        ...overrides,
      } as BillingEmailSpec;
  }
}
