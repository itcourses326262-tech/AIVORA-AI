import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-client';
import {
  describeBillingError,
  formatLongWait,
  keepsIdempotencyKey,
  reasonOf,
} from '@/components/billing/checkout-errors';
import { itemName, orderItemName, planDisplayName } from '@/components/billing/items';
import { halalasPer100Credits, netHalalas } from '@/components/billing/money';
import { checkoutTarget, returnPath } from '@/components/billing/navigation';
import { planFacts, planPhase } from '@/components/billing/subscription-model';
import { DAY_MS, RENEWAL_GRACE_MS } from '@/lib/billing/period';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { createTranslator } from '@/lib/i18n';
import { newId } from '@/lib/id';
import { NOW, order, pendingOrder, subscription } from './support';

const ORIGIN = 'http://localhost:3000';

describe('checkoutTarget: where a buyer may be sent to pay', () => {
  it('accepts a secure address of the gateway', () => {
    expect(checkoutTarget('https://checkout.moyasar.com/invoices/abc', ORIGIN)).toBe(
      'https://checkout.moyasar.com/invoices/abc',
    );
  });

  it('accepts a page of this very site, absolute or relative (the development checkout)', () => {
    expect(checkoutTarget('/billing/mock-checkout/ord_x', ORIGIN)).toBe(
      'http://localhost:3000/billing/mock-checkout/ord_x',
    );
    expect(checkoutTarget('http://localhost:3000/billing/mock-checkout/ord_x', ORIGIN)).toBe(
      'http://localhost:3000/billing/mock-checkout/ord_x',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://evil.example/pay',
    '//evil.example/pay',
    'ftp://evil.example/pay',
    'file:///etc/passwd',
    '',
  ])('refuses %j', (raw) => {
    expect(checkoutTarget(raw, ORIGIN)).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(checkoutTarget(undefined, ORIGIN)).toBeNull();
  });

  it('refuses a relative address when there is no origin to resolve it against', () => {
    expect(checkoutTarget('/billing/mock-checkout/ord_x', '')).toBeNull();
  });
});

describe('returnPath', () => {
  it('names the order, encoded', () => {
    expect(returnPath('ord_abc')).toBe('/billing/return?order=ord_abc');
    expect(returnPath('a b&c=d')).toBe('/billing/return?order=a%20b%26c%3Dd');
  });
});

describe('prices', () => {
  it('computes the price per 100 credits from the price list', () => {
    expect(halalasPer100Credits(4_900, 1_000)).toBe(490);
    expect(halalasPer100Credits(13_900, 3_000)).toBe(463);
    expect(halalasPer100Credits(44_900, 10_000)).toBe(449);
    expect(halalasPer100Credits(100, 0)).toBe(0);
  });

  it('makes bigger purchases cheaper per credit, packs and plans alike', () => {
    for (const list of [CREDIT_PACKS, SUBSCRIPTION_PLANS]) {
      const rates = list.map((item) =>
        halalasPer100Credits(
          item.priceHalalas,
          'credits' in item ? item.credits : item.monthlyCredits,
        ),
      );
      expect(rates).toEqual([...rates].sort((a, b) => b - a));
    }
  });

  it('takes the VAT out of a price, never below zero', () => {
    expect(netHalalas(13_900, 1_813)).toBe(12_087);
    expect(netHalalas(100, 500)).toBe(0);
  });
});

describe('item names', () => {
  it('come from the shared price list, in the active language', () => {
    expect(itemName('pack', 'pack-1500', 'en')).toBe('Medium pack');
    expect(itemName('pack', 'pack-1500', 'ar')).toBe('حزمة متوسطة');
    expect(itemName('subscription_initial', 'pro', 'en')).toBe('Pro');
    expect(planDisplayName('starter', 'ar')).toBe('المبتدئ');
    expect(orderItemName(order({ kind: 'subscription_renewal', itemId: 'studio' }), 'en')).toBe(
      'Studio',
    );
  });

  it('fall back to the id when an item has left the price list', () => {
    expect(itemName('pack', 'pack-retired', 'en')).toBe('pack-retired');
    expect(planDisplayName('legacy', 'ar')).toBe('legacy');
  });

  it('do not mix packs and plans up', () => {
    expect(itemName('pack', 'pro', 'en')).toBe('pro');
    expect(itemName('subscription_initial', 'pack-500', 'en')).toBe('pack-500');
  });
});

describe('billing errors', () => {
  const conflict = (reason?: string) =>
    new ApiError('conflict', 409, 'English', reason ? { reason } : undefined);
  const t = createTranslator('en').t;

  it('reads details.reason only from an API error with an object of details', () => {
    expect(reasonOf(conflict('subscription_exists'))).toBe('subscription_exists');
    expect(reasonOf(conflict())).toBeUndefined();
    expect(reasonOf(new ApiError('conflict', 409, 'x', 'subscription_exists'))).toBeUndefined();
    expect(reasonOf(new ApiError('conflict', 409, 'x', { reason: 5 }))).toBeUndefined();
    expect(reasonOf(new Error('x'))).toBeUndefined();
    expect(reasonOf(null)).toBeUndefined();
  });

  it('ignores an unknown reason instead of printing it, and ignores inherited property names', () => {
    const unknown = describeBillingError(t, conflict('something_new'), { returnTo: '/pricing' });
    expect(unknown.message).toBe(t('errors.conflict'));
    const proto = describeBillingError(t, conflict('toString'), { returnTo: '/pricing' });
    expect(proto.message).toBe(t('errors.conflict'));
  });

  it('points a "plan exists" error to Billing and nothing else', () => {
    const problem = describeBillingError(t, conflict('subscription_exists'), {
      returnTo: '/pricing',
    });
    expect(problem.link).toEqual({ href: '/account/billing', label: 'Open Billing' });
    expect(
      describeBillingError(t, conflict('checkout_closed'), { returnTo: '/pricing' }).link,
    ).toBeUndefined();
  });

  it('sends "too many unpaid checkouts" to Billing, where they can be paid, and says so', () => {
    const problem = describeBillingError(t, new ApiError('too_many_active', 429, 'x'), {
      returnTo: '/pricing',
    });
    expect(problem.link).toEqual({ href: '/account/billing', label: 'Open Billing' });
    expect(problem.message).toMatch(/Pay for one of them in Billing/);
    expect(problem.message).toMatch(/expire \(within a day\)/);
  });

  it.each([502, 503])(
    'blames the payment service, not the generation service, for a gateway failure (%i)',
    (status) => {
      const problem = describeBillingError(t, new ApiError('provider_error', status, 'x'), {
        returnTo: '/pricing',
      });
      expect(problem.message).toBe(t('billing.errors.gatewayDown'));
      expect(problem.message).toMatch(/payment service/);
      expect(problem.message).toMatch(/Nothing was charged/);
      expect(problem.message).not.toBe(t('errors.provider_error'));
      expect(problem.link).toBeUndefined();
    },
  );

  it('still reports "billing is off" for the 503 that carries that reason', () => {
    const off = new ApiError('provider_error', 503, 'x', { reason: 'billing_disabled' });
    expect(describeBillingError(t, off, { returnTo: '/' }).message).toBe(
      t('billing.errors.billingDisabled'),
    );
  });

  describe('the limit of checkouts per 24 hours', () => {
    const limited = (details: unknown) => new ApiError('rate_limited', 429, 'x', details);

    it('says how long to wait, in the active language', () => {
      const details = { reason: 'daily_checkout_limit', limit: 20, retryAfterSec: 3 * 3600 + 5 };
      expect(
        describeBillingError(t, limited(details), { returnTo: '/', locale: 'en' }).message,
      ).toBe('You have reached the limit of checkouts per 24 hours. Please try again in 4 hours.');
      const ar = createTranslator('ar').t;
      expect(
        describeBillingError(ar, limited(details), { returnTo: '/', locale: 'ar' }).message,
      ).toMatch(/بعد ٤ ساعات\.$/);
    });

    it.each([undefined, 0, -5, Number.NaN, '3600'])(
      'says "later" when the wait is missing or unusable (%s)',
      (retryAfterSec) => {
        const details = { reason: 'daily_checkout_limit', retryAfterSec };
        expect(
          describeBillingError(t, limited(details), { returnTo: '/', locale: 'en' }).message,
        ).toBe(t('billing.errors.dailyLimitLater'));
      },
    );

    it('says "later" when the caller gave no language to format the wait in', () => {
      const details = { reason: 'daily_checkout_limit', retryAfterSec: 3600 };
      expect(describeBillingError(t, limited(details), { returnTo: '/' }).message).toBe(
        t('billing.errors.dailyLimitLater'),
      );
    });

    it('leaves the short per-minute limit to the generic text', () => {
      expect(
        describeBillingError(t, limited({ retryAfterSec: 30 }), { returnTo: '/', locale: 'en' })
          .message,
      ).toBe(t('errors.rate_limited'));
    });
  });

  it('formats a wait in the largest sensible unit', () => {
    expect(formatLongWait(1, 'en')).toBe('1 second');
    expect(formatLongWait(89, 'en')).toBe('89 seconds');
    expect(formatLongWait(90, 'en')).toBe('2 minutes');
    expect(formatLongWait(20 * 60, 'en')).toBe('20 minutes');
    expect(formatLongWait(89 * 60, 'en')).toBe('89 minutes');
    expect(formatLongWait(90 * 60, 'en')).toBe('2 hours');
    expect(formatLongWait(5 * 3600, 'en')).toBe('5 hours');
    expect(formatLongWait(24 * 3600, 'en')).toBe('24 hours');
    expect(formatLongWait(5 * 3600, 'ar')).toMatch(/^[٠-٩]+ ساعات$/);
  });

  it('builds the login link with the page to come back to', () => {
    const problem = describeBillingError(t, new ApiError('unauthorized', 401, 'x'), {
      returnTo: '/account/billing',
    });
    expect(problem.link).toEqual({
      href: '/login?next=%2Faccount%2Fbilling',
      label: 'Log in',
    });
  });

  it('turns "not found" into "no plan" only for the plan routes', () => {
    const missing = new ApiError('not_found', 404, 'x');
    expect(describeBillingError(t, missing, { returnTo: '/', subscription: true }).message).toBe(
      'There is no plan on your account.',
    );
    expect(describeBillingError(t, missing, { returnTo: '/' }).message).toBe(t('errors.not_found'));
  });

  it('keeps a key only while the outcome is unknown or the server is still preparing the checkout', () => {
    expect(keepsIdempotencyKey(new ApiError('network_error', 0, 'x'))).toBe(true);
    expect(keepsIdempotencyKey(conflict('checkout_in_progress'))).toBe(true);
    for (const reason of ['subscription_exists', 'idempotency_key_reused', 'checkout_closed']) {
      expect(keepsIdempotencyKey(conflict(reason))).toBe(false);
    }
    expect(keepsIdempotencyKey(new ApiError('internal', 500, 'x'))).toBe(false);
    expect(keepsIdempotencyKey(new ApiError('provider_error', 502, 'x'))).toBe(false);
    expect(keepsIdempotencyKey(new Error('x'))).toBe(false);
  });
});

describe('plan phases', () => {
  it('tell a plan that is set to end from a plain active one', () => {
    expect(planPhase(null)).toBe('none');
    expect(planPhase(subscription())).toBe('active');
    expect(planPhase(subscription({ cancelAtPeriodEnd: true }))).toBe('canceling');
    for (const status of ['past_due', 'canceled', 'expired', 'incomplete'] as const) {
      expect(planPhase(subscription({ status }))).toBe(status);
    }
  });

  it('only a canceled-but-running plan keeps its cancellation flag when it is no longer active', () => {
    expect(planPhase(subscription({ status: 'canceled', cancelAtPeriodEnd: true }))).toBe(
      'canceled',
    );
    expect(planPhase(subscription({ status: 'past_due', cancelAtPeriodEnd: true }))).toBe(
      'past_due',
    );
  });

  it('derive the last day an overdue renewal can be paid from the shared grace period', () => {
    const facts = planFacts(subscription({ currentPeriodEnd: NOW - DAY_MS }), ORIGIN);
    expect(facts.graceEnd).toBe(NOW - DAY_MS + RENEWAL_GRACE_MS);
    expect(facts.plan?.id).toBe('pro');
    expect(facts.payable).toBeNull();
  });

  it('offer a payment only when the pending order has a safe address', () => {
    const safe = planFacts(subscription({ pendingOrder: pendingOrder() }), ORIGIN);
    expect(safe.payable?.href).toBe('https://pay.example.com/invoices/inv_1');
    const unsafe = planFacts(
      subscription({ pendingOrder: pendingOrder({ checkoutUrl: 'javascript:alert(1)' }) }),
      ORIGIN,
    );
    expect(unsafe.payable).toBeNull();
    const none = planFacts(
      subscription({ pendingOrder: pendingOrder({ checkoutUrl: undefined }) }),
      ORIGIN,
    );
    expect(none.payable).toBeNull();
  });

  it('cope with a plan that has left the price list', () => {
    const facts = planFacts(subscription({ planId: 'legacy' }), ORIGIN);
    expect(facts.plan).toBeNull();
  });

  describe('say when an ended plan really stopped', () => {
    const paidMonthEnd = NOW + 20 * DAY_MS;

    it('is the end of the paid month for a plan that was canceled and ran to its end', () => {
      const facts = planFacts(
        subscription({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          currentPeriodEnd: paidMonthEnd,
          canceledAt: paidMonthEnd + 60_000,
        }),
        ORIGIN,
      );
      expect(facts.endedAt).toBe(paidMonthEnd);
    });

    it('is the day it was ended when that was before the month ran out (the payment was refunded)', () => {
      const facts = planFacts(
        subscription({
          status: 'canceled',
          currentPeriodEnd: paidMonthEnd,
          canceledAt: NOW,
        }),
        ORIGIN,
      );
      expect(facts.endedAt).toBe(NOW);
      expect(facts.periodEnd).toBe(paidMonthEnd);
    });

    it('is the end of the month for a plan that expired unpaid, and null while the plan runs', () => {
      const expired = planFacts(
        subscription({ status: 'expired', currentPeriodEnd: NOW - 8 * DAY_MS }),
        ORIGIN,
      );
      expect(expired.endedAt).toBe(NOW - 8 * DAY_MS);
      expect(planFacts(subscription({ status: 'active' }), ORIGIN).endedAt).toBeNull();
      const neverStarted = planFacts(
        subscription({ status: 'expired', currentPeriodEnd: undefined }),
        ORIGIN,
      );
      expect(neverStarted.endedAt).toBeNull();
    });
  });

  it('cope with a plan that has no period yet (first payment pending)', () => {
    const facts = planFacts(
      subscription({
        status: 'incomplete',
        currentPeriodStart: undefined,
        currentPeriodEnd: undefined,
      }),
      ORIGIN,
    );
    expect(facts.periodEnd).toBeNull();
    expect(facts.graceEnd).toBeNull();
  });
});

describe('fixtures', () => {
  it('use real id shapes', () => {
    expect(newId('ord')).toMatch(/^ord_/);
  });
});
