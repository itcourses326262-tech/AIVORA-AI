import type { BillingCatalogDTO } from '@/lib/api-types';
import type { CreditSample } from '@/components/marketing/credit-samples';

/** How many generations of this model `credits` pays for (whole generations only). */
export function outputsFor(credits: number, sample: Pick<CreditSample, 'credits'>): number {
  if (!Number.isFinite(credits) || credits < 0 || sample.credits <= 0) return 0;
  return Math.floor(credits / sample.credits);
}

/**
 * The amounts the calculator offers: exactly what the shop sells (every pack, and every plan's
 * monthly credits), smallest first, each once. The preselected one is the highlighted pack, so
 * the first thing a visitor sees is what the popular choice buys.
 */
export function calculatorPresets(catalog: Pick<BillingCatalogDTO, 'packs' | 'plans'>): {
  amounts: number[];
  initial: number;
} {
  const amounts = [
    ...new Set([
      ...catalog.packs.map((pack) => pack.credits),
      ...catalog.plans.map((plan) => plan.monthlyCredits),
    ]),
  ].sort((a, b) => a - b);
  const popular = catalog.packs.find((pack) => pack.popular) ?? catalog.packs[0];
  return { amounts, initial: popular?.credits ?? amounts[0] ?? 0 };
}
