import { describe, expect, it } from 'vitest';
import {
  GATEWAY_FEE_RATE,
  GATEWAY_FIXED_FEE_HALALAS,
  SAR_PER_USD,
  TARGET_MARGIN_MULTIPLE,
  UPSTREAM_USD_PER_CREDIT,
  marginOf,
} from '@/lib/billing/margin';
import {
  CREDIT_PACKS,
  DEFAULT_VAT_RATE_PERCENT,
  SUBSCRIPTION_PLANS,
  findPurchasable,
  getPack,
  getPlan,
  splitVat,
} from '@/lib/billing/plans';
import { falModels } from '@/lib/catalog/models/fal';
import { computeCost } from '@/lib/catalog/pricing';

describe('the price list', () => {
  it('has unique ids and whole-riyal prices in halalas', () => {
    const ids = [...CREDIT_PACKS, ...SUBSCRIPTION_PLANS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of [...CREDIT_PACKS, ...SUBSCRIPTION_PLANS]) {
      expect(Number.isInteger(item.priceHalalas)).toBe(true);
      expect(item.priceHalalas % 100).toBe(0);
      expect(item.priceHalalas).toBeGreaterThan(0);
    }
    for (const pack of CREDIT_PACKS) expect(Number.isInteger(pack.credits)).toBe(true);
    for (const plan of SUBSCRIPTION_PLANS) expect(Number.isInteger(plan.monthlyCredits)).toBe(true);
  });

  it('is cheaper per credit the more you buy', () => {
    const perCredit = (price: number, credits: number) => price / credits;
    const packs = CREDIT_PACKS.map((pack) => perCredit(pack.priceHalalas, pack.credits));
    expect(packs).toEqual([...packs].sort((a, b) => b - a));
    const plans = SUBSCRIPTION_PLANS.map((plan) =>
      perCredit(plan.priceHalalas, plan.monthlyCredits),
    );
    expect(plans).toEqual([...plans].sort((a, b) => b - a));
  });

  it('describes every item in both languages', () => {
    for (const item of [...CREDIT_PACKS, ...SUBSCRIPTION_PLANS]) {
      for (const text of [item.name, item.description]) {
        expect(text.en.length).toBeGreaterThan(0);
        expect(text.ar).toMatch(/[؀-ۿ]/);
      }
    }
  });

  it('keeps every item above the gross margin target after VAT and gateway fees', () => {
    for (const pack of CREDIT_PACKS) {
      const margin = marginOf({ priceHalalas: pack.priceHalalas, credits: pack.credits });
      expect(margin.multiple, pack.id).toBeGreaterThanOrEqual(TARGET_MARGIN_MULTIPLE);
      expect(margin.meetsTarget).toBe(true);
    }
    for (const plan of SUBSCRIPTION_PLANS) {
      const margin = marginOf({ priceHalalas: plan.priceHalalas, credits: plan.monthlyCredits });
      expect(margin.multiple, plan.id).toBeGreaterThanOrEqual(TARGET_MARGIN_MULTIPLE);
    }
  });

  it('computes the margin from first principles', () => {
    // 29 SAR: VAT 3.78, gateway 3% + 1 SAR = 1.87, upstream 500 credits * USD 0.004 * 3.75 = 7.50 SAR.
    const report = marginOf({ priceHalalas: 2900, credits: 500 });
    expect(report.vatHalalas).toBe(378);
    expect(report.upstreamCostHalalas).toBeCloseTo(750, 6);
    expect(report.netHalalas).toBeCloseTo(
      2900 - 378 - 2900 * GATEWAY_FEE_RATE - GATEWAY_FIXED_FEE_HALALAS,
      6,
    );
    expect(report.multiple).toBeCloseTo(report.netHalalas / 750, 9);
    expect(UPSTREAM_USD_PER_CREDIT * SAR_PER_USD).toBeCloseTo(0.015, 9);
    expect(marginOf({ priceHalalas: 2000, credits: 500 }).meetsTarget).toBe(false);
  });

  it('anchors a credit to the cheapest fal model: nothing sells below the price floor', () => {
    // Every fal price in the catalog is rounded UP to whole credits at USD 0.004 per credit, so one
    // credit never costs us more than the anchor the margin table assumes.
    for (const model of falModels) {
      if (model.pricing.type === 'image') {
        expect(model.pricing.perImage).toBeGreaterThanOrEqual(1);
      }
      expect(
        computeCost(model, {
          aspectRatio: model.limits.defaultAspectRatio,
          count: 1,
          durationSec: model.limits.defaultDuration,
          resolution: model.limits.defaultResolution,
        }),
      ).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('lookups', () => {
  it('finds packs and plans only in their own namespace', () => {
    expect(getPack('pack-500')?.credits).toBe(500);
    expect(getPack('pro')).toBeUndefined();
    expect(getPlan('pro')?.monthlyCredits).toBe(3000);
    expect(getPlan('pack-500')).toBeUndefined();
    expect(findPurchasable('pack', 'pack-500')).toMatchObject({
      type: 'pack',
      credits: 500,
      priceHalalas: 2900,
      currency: 'SAR',
    });
    expect(findPurchasable('subscription', 'pro')).toMatchObject({
      type: 'subscription',
      credits: 3000,
      priceHalalas: 13900,
    });
    expect(findPurchasable('pack', 'pro')).toBeUndefined();
    expect(findPurchasable('subscription', 'pack-500')).toBeUndefined();
    expect(findPurchasable('pack', '__proto__')).toBeUndefined();
    expect(findPurchasable('pack', 'constructor')).toBeUndefined();
  });
});

describe('splitVat', () => {
  it('splits a VAT-inclusive price so that net + VAT is always the price', () => {
    expect(splitVat(11_500)).toEqual({
      grossHalalas: 11_500,
      netHalalas: 10_000,
      vatHalalas: 1_500,
    });
    expect(splitVat(2_900)).toEqual({ grossHalalas: 2_900, netHalalas: 2_522, vatHalalas: 378 });
    expect(splitVat(100, 0)).toEqual({ grossHalalas: 100, netHalalas: 100, vatHalalas: 0 });
    for (const gross of [1, 2, 3, 99, 1_001, 13_900, 44_900, 123_457]) {
      for (const percent of [0, 5, DEFAULT_VAT_RATE_PERCENT, 30]) {
        const split = splitVat(gross, percent);
        expect(split.netHalalas + split.vatHalalas).toBe(gross);
        expect(split.vatHalalas).toBeGreaterThanOrEqual(0);
        expect(split.vatHalalas).toBeLessThanOrEqual(gross);
      }
    }
  });

  it('rejects amounts and rates that make no sense', () => {
    for (const gross of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => splitVat(gross)).toThrow(RangeError);
    }
    expect(() => splitVat(100, -1)).toThrow(RangeError);
    expect(() => splitVat(100, Number.NaN)).toThrow(RangeError);
  });
});
