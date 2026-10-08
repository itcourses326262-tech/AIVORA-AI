import type { BillingCurrency, PurchaseType } from './types';

/**
 * Single source of truth for what AIVORE sells and for how much. The server reads prices ONLY
 * from here (a checkout request names an item, never an amount); the UI renders the same data.
 * Amounts are integer halalas (1 SAR = 100 halalas) and INCLUDE Saudi VAT. Credits never expire.
 *
 * Prices are configuration the owner tunes. After changing a number run
 * `npm run admin -- billing-prices`, which prints this table from the live config and flags
 * anything below the margin target. `tests/lib/billing/plans.test.ts` fails the same way.
 *
 * Margin model (the arithmetic lives in `./margin.ts`):
 *  - 1 credit is anchored at USD 0.004 of UPSTREAM cost (the fal catalog rounds every model's
 *    price UP to whole credits, so the real cost per credit is at or below this), and
 *    1 USD = 3.75 SAR, so 1 credit costs SAR 0.015.
 *  - Revenue is what is left of the price after 15% VAT and the gateway: a pessimistic
 *    3% of the price plus SAR 1 per payment (the sales team quotes the real rate, see
 *    docs/ARCHITECTURE.md "Billing (as built)").
 *  - Target: net revenue >= 2.5x the upstream cost of all the credits sold, with every credit used.
 *    Credits that are never used are extra margin; refunds and chargebacks are not modelled.
 *
 *  item          credits  price (SAR, VAT incl.)  per credit  VAT      net after fees  margin
 *  pack-500          500    29.00                 0.0580      3.78     23.35           3.11x
 *  pack-1500       1,500    79.00                 0.0527     10.30     65.33           2.90x
 *  pack-5000       5,000   229.00                 0.0458     29.87    191.26           2.55x
 *  starter         1,000    49.00 / month         0.0490      6.39     40.14           2.68x
 *  pro             3,000   139.00 / month         0.0463     18.13    115.70           2.57x
 *  studio         10,000   449.00 / month         0.0449     58.57    375.96           2.51x
 *
 * Bigger purchases are cheaper per credit, and a plan is never dearer per credit than a pack of
 * a similar size. Subscribing is a convenience (monthly credits, no repurchase), not a discount trap.
 */

export { BILLING_CURRENCY } from './types';

/** Saudi VAT. The server reads `VAT_RATE_PERCENT` (default this value) when it creates an order. */
export const DEFAULT_VAT_RATE_PERCENT = 15;

interface Localized {
  en: string;
  ar: string;
}

export interface CreditPack {
  id: string;
  credits: number;
  /** Price in halalas, VAT included. */
  priceHalalas: number;
  name: Localized;
  description: Localized;
  /** Highlighted in the shop. */
  popular?: boolean;
}

export interface SubscriptionPlan {
  id: string;
  /** Credits granted every month, when the month is paid. */
  monthlyCredits: number;
  /** Price per month in halalas, VAT included. */
  priceHalalas: number;
  name: Localized;
  description: Localized;
  popular?: boolean;
}

export const CREDIT_PACKS = [
  {
    id: 'pack-500',
    credits: 500,
    priceHalalas: 2_900,
    name: { en: 'Small pack', ar: 'حزمة صغيرة' },
    description: {
      en: 'A little room to try new ideas.',
      ar: 'مساحة صغيرة لتجربة أفكار جديدة.',
    },
  },
  {
    id: 'pack-1500',
    credits: 1_500,
    priceHalalas: 7_900,
    name: { en: 'Medium pack', ar: 'حزمة متوسطة' },
    description: {
      en: 'Steady creating for regular projects.',
      ar: 'إبداع منتظم لمشاريعك المتكررة.',
    },
    popular: true,
  },
  {
    id: 'pack-5000',
    credits: 5_000,
    priceHalalas: 22_900,
    name: { en: 'Large pack', ar: 'حزمة كبيرة' },
    description: {
      en: 'The best price per credit for heavy use.',
      ar: 'أفضل سعر للرصيد لمن يستخدم بكثافة.',
    },
  },
] as const satisfies readonly CreditPack[];

export const SUBSCRIPTION_PLANS = [
  {
    id: 'starter',
    monthlyCredits: 1_000,
    priceHalalas: 4_900,
    name: { en: 'Starter', ar: 'المبتدئ' },
    description: {
      en: 'Monthly credits for hobby and side projects.',
      ar: 'رصيد شهري لهواة الإبداع والمشاريع الجانبية.',
    },
  },
  {
    id: 'pro',
    monthlyCredits: 3_000,
    priceHalalas: 13_900,
    name: { en: 'Pro', ar: 'المحترف' },
    description: {
      en: 'For creators who generate every week.',
      ar: 'لصنّاع المحتوى الذين يولّدون كل أسبوع.',
    },
    popular: true,
  },
  {
    id: 'studio',
    monthlyCredits: 10_000,
    priceHalalas: 44_900,
    name: { en: 'Studio', ar: 'الاستوديو' },
    description: {
      en: 'For teams and daily production.',
      ar: 'للفرق والإنتاج اليومي.',
    },
  },
] as const satisfies readonly SubscriptionPlan[];

export type PackId = (typeof CREDIT_PACKS)[number]['id'];
export type PlanId = (typeof SUBSCRIPTION_PLANS)[number]['id'];

export function getPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

export function getPlan(id: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === id);
}

/** A pack or a plan, reduced to what an order needs. */
export interface Purchasable {
  type: PurchaseType;
  id: string;
  credits: number;
  priceHalalas: number;
  currency: BillingCurrency;
  name: Localized;
}

export function findPurchasable(type: PurchaseType, id: string): Purchasable | undefined {
  if (type === 'pack') {
    const pack = getPack(id);
    return (
      pack && {
        type,
        id: pack.id,
        credits: pack.credits,
        priceHalalas: pack.priceHalalas,
        currency: 'SAR',
        name: pack.name,
      }
    );
  }
  const plan = getPlan(id);
  return (
    plan && {
      type,
      id: plan.id,
      credits: plan.monthlyCredits,
      priceHalalas: plan.priceHalalas,
      currency: 'SAR',
      name: plan.name,
    }
  );
}

export interface VatBreakdown {
  /** What the buyer pays. */
  grossHalalas: number;
  /** Gross without VAT. */
  netHalalas: number;
  vatHalalas: number;
}

/** Splits a VAT-inclusive price. The VAT is the remainder, so `net + vat === gross` always. */
export function splitVat(
  grossHalalas: number,
  vatPercent: number = DEFAULT_VAT_RATE_PERCENT,
): VatBreakdown {
  if (!Number.isSafeInteger(grossHalalas) || grossHalalas < 0) {
    throw new RangeError(`grossHalalas must be a non-negative integer, got ${grossHalalas}`);
  }
  if (!Number.isFinite(vatPercent) || vatPercent < 0) {
    throw new RangeError(`vatPercent must be a non-negative number, got ${vatPercent}`);
  }
  const netHalalas = Math.round((grossHalalas * 100) / (100 + vatPercent));
  return { grossHalalas, netHalalas, vatHalalas: grossHalalas - netHalalas };
}
