import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { calculatorPresets, outputsFor } from '@/components/billing/calculator';
import { CreditCalculator } from '@/components/billing/credit-calculator';
import { pickCreditSamples, type CreditSample } from '@/components/marketing/credit-samples';
import { computeCost, getModels } from '@/lib/catalog';
import type { ModelSpec } from '@/lib/catalog/types';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { createTranslator } from '@/lib/i18n';
import { axeViolations } from '../axe';
import { catalog, mountBilling, plain, resetBillingTest } from './support';

afterEach(resetBillingTest);

const models = getModels();
const samples = pickCreditSamples(models);
const presets = calculatorPresets(catalog());

/** What one generation of this model costs with the default settings, straight from `computeCost`. */
function costFromCatalog(sample: CreditSample): number {
  const model = models.find((candidate) => candidate.id === sample.id) as ModelSpec;
  const { limits } = model;
  return model.kind === 'image'
    ? computeCost(model, { aspectRatio: limits.defaultAspectRatio, count: 1 })
    : computeCost(model, {
        aspectRatio: limits.defaultAspectRatio,
        count: 1,
        durationSec: sample.seconds,
        resolution: sample.resolution,
      });
}

describe('the amounts on offer', () => {
  it('are exactly what the shop sells: every pack and every plan, smallest first, once each', () => {
    const sold = [
      ...new Set([
        ...CREDIT_PACKS.map((pack) => pack.credits),
        ...SUBSCRIPTION_PLANS.map((plan) => plan.monthlyCredits),
      ]),
    ].sort((a, b) => a - b);
    expect(presets.amounts).toEqual(sold);
    expect(presets.amounts).toEqual([500, 1_000, 1_500, 3_000, 5_000, 10_000]);
  });

  it('start on the highlighted pack', () => {
    expect(presets.initial).toBe(1_500);
  });

  it('start on the first amount when no pack is highlighted', () => {
    const plain = catalog();
    const none = calculatorPresets({
      ...plain,
      packs: plain.packs.map((pack) => ({ ...pack, popular: false })),
    });
    expect(none.initial).toBe(500);
  });
});

describe('outputsFor', () => {
  it('counts whole generations only', () => {
    expect(outputsFor(1_500, { credits: 8 })).toBe(187);
    expect(outputsFor(7, { credits: 8 })).toBe(0);
    expect(outputsFor(16, { credits: 8 })).toBe(2);
  });

  it('is zero for nonsense instead of NaN or Infinity', () => {
    expect(outputsFor(100, { credits: 0 })).toBe(0);
    expect(outputsFor(-5, { credits: 3 })).toBe(0);
    expect(outputsFor(Number.NaN, { credits: 3 })).toBe(0);
    expect(outputsFor(Number.POSITIVE_INFINITY, { credits: 3 })).toBe(0);
  });
});

describe('the calculator, on the real model catalog', () => {
  it('prices every sample as computeCost does for the same settings', () => {
    expect(samples.images.length).toBeGreaterThan(0);
    expect(samples.videos.length).toBeGreaterThan(0);
    for (const sample of [...samples.images, ...samples.videos]) {
      expect(sample.credits, sample.id).toBe(costFromCatalog(sample));
    }
  });

  it('quotes a 5 second clip whenever the model offers that length', () => {
    for (const sample of samples.videos) {
      const model = models.find((candidate) => candidate.id === sample.id) as ModelSpec;
      if (model.limits.durations?.includes(5)) expect(sample.seconds).toBe(5);
    }
  });

  it('shows, for every amount and model, floor(amount / cost) as the count', async () => {
    const user = userEvent.setup();
    mountBilling(
      <CreditCalculator samples={samples} amounts={presets.amounts} initial={presets.initial} />,
      { user: null },
    );
    const { t } = createTranslator('en');
    for (const amount of presets.amounts) {
      await user.click(
        screen.getByRole('radio', { name: new Intl.NumberFormat('en-US').format(amount) }),
      );
      for (const sample of [...samples.images, ...samples.videos]) {
        const row = screen.getByText(sample.label).closest('li') as HTMLElement;
        const expected = Math.floor(amount / costFromCatalog(sample));
        const isImage = samples.images.includes(sample);
        const unit = isImage ? 'images' : 'clips';
        const one = isImage ? 'image' : 'clip';
        const label =
          expected === 0
            ? t(`billing.pricing.calculator.${isImage ? 'images' : 'videos'}.zero`)
            : expected === 1
              ? `1 ${one}`
              : `${new Intl.NumberFormat('en-US').format(expected)} ${unit}`;
        expect(within(row).getByText(label), `${sample.label} at ${amount}`).toBeInTheDocument();
      }
    }
  });

  it('starts on the preselected amount and says what it is', () => {
    mountBilling(
      <CreditCalculator samples={samples} amounts={presets.amounts} initial={presets.initial} />,
      { user: null },
    );
    expect(screen.getByRole('radio', { name: '1,500' })).toBeChecked();
    expect(screen.getByText('With 1,500 credits you can make up to')).toBeInTheDocument();
  });

  it('shows what one generation costs next to each model', () => {
    mountBilling(
      <CreditCalculator samples={samples} amounts={presets.amounts} initial={presets.initial} />,
      { user: null },
    );
    const cheapest = samples.images[0] as CreditSample;
    const row = screen.getByText(cheapest.label).closest('li') as HTMLElement;
    expect(row).toHaveTextContent(
      cheapest.credits === 1
        ? '1 credit per generation'
        : `${cheapest.credits} credits per generation`,
    );
    const video = samples.videos[0] as CreditSample;
    const videoRow = screen.getByText(video.label).closest('li') as HTMLElement;
    expect(plain(videoRow.textContent ?? '')).toContain(
      `${video.credits} credits per ${video.seconds} sec clip at ${video.resolution}`,
    );
  });

  it('renders nothing when the catalog has no priced models', () => {
    const { container } = mountBilling(
      <CreditCalculator samples={{ images: [], videos: [] }} amounts={[500]} initial={500} />,
      { user: null },
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('works in Arabic with Arabic-Indic digits and Arabic plural forms', async () => {
    const user = userEvent.setup();
    mountBilling(
      <CreditCalculator samples={samples} amounts={presets.amounts} initial={presets.initial} />,
      { user: null, locale: 'ar' },
    );
    expect(screen.getByText(/بـ ١[٬,]٥٠٠ رصيد يمكنك صنع ما يصل إلى/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('radio', { name: plain(new Intl.NumberFormat('ar-EG').format(500)) }),
    );
    const cheapest = samples.images[0] as CreditSample;
    const row = screen.getByText(cheapest.label).closest('li') as HTMLElement;
    const count = Math.floor(500 / cheapest.credits);
    expect(row).toHaveTextContent(new RegExp(`[٠-٩]+ صور`));
    expect(count).toBeGreaterThan(0);
  });

  it('has no accessibility violations', async () => {
    const { container } = mountBilling(
      <CreditCalculator samples={samples} amounts={presets.amounts} initial={presets.initial} />,
      { user: null },
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
