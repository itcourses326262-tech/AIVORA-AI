import 'server-only';
import type { BillingCatalogDTO } from '@/lib/api-types';
import { DAY_MS, RENEWAL_GRACE_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, splitVat } from '@/lib/billing/plans';
import { getEnv } from '@/server/env';
import { getBillingMode, isBillingEnabled } from './config';

/** What the shop offers right now: the price list plus the current VAT and whether buying works. */
export function buildCatalog(): BillingCatalogDTO {
  const env = getEnv();
  const vatOf = (priceHalalas: number) => splitVat(priceHalalas, env.VAT_RATE_PERCENT).vatHalalas;
  return {
    currency: 'SAR',
    vatPercent: env.VAT_RATE_PERCENT,
    gateway: getBillingMode(env),
    canPurchase: isBillingEnabled(env),
    packs: CREDIT_PACKS.map((pack) => ({
      id: pack.id,
      credits: pack.credits,
      priceHalalas: pack.priceHalalas,
      vatHalalas: vatOf(pack.priceHalalas),
      name: pack.name,
      description: pack.description,
      popular: 'popular' in pack && pack.popular === true,
    })),
    plans: SUBSCRIPTION_PLANS.map((plan) => ({
      id: plan.id,
      monthlyCredits: plan.monthlyCredits,
      priceHalalas: plan.priceHalalas,
      vatHalalas: vatOf(plan.priceHalalas),
      name: plan.name,
      description: plan.description,
      popular: 'popular' in plan && plan.popular === true,
    })),
    renewal: {
      leadDays: Math.round(RENEWAL_LEAD_MS / DAY_MS),
      graceDays: Math.round(RENEWAL_GRACE_MS / DAY_MS),
    },
  };
}
