'use client';

import { Clapperboard, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import type { CreditSample, CreditSamples } from '@/components/marketing/credit-samples';
import { SegmentedControl } from '@/components/ui/radio-group';
import { isolateLtr } from '@/lib/generations/format';
import { useI18n } from '@/lib/i18n/client';
import { formatCredits, formatSeconds } from '@/lib/utils';
import { outputsFor } from './calculator';

function ResultList({
  icon: Icon,
  title,
  samples,
  credits,
  kind,
}: {
  icon: LucideIcon;
  title: string;
  samples: readonly CreditSample[];
  credits: number;
  kind: 'images' | 'videos';
}) {
  const i18n = useI18n();
  const { t, plural, locale } = i18n;
  if (samples.length === 0) return null;
  const forms = (count: number) =>
    plural(count, {
      zero: t(`billing.pricing.calculator.${kind}.zero`),
      one: t(`billing.pricing.calculator.${kind}.one`),
      two: t(`billing.pricing.calculator.${kind}.two`),
      few: t(`billing.pricing.calculator.${kind}.few`),
      many: t(`billing.pricing.calculator.${kind}.many`),
      other: t(`billing.pricing.calculator.${kind}.other`),
    });
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon aria-hidden="true" className="size-4 text-brand" />
        {title}
      </h3>
      <ul className="mt-2 divide-y divide-border">
        {samples.map((sample) => (
          <li key={sample.id} className="flex items-center justify-between gap-4 py-3">
            <span className="grid min-w-0 gap-0.5">
              <bdi className="truncate text-sm font-medium text-foreground">{sample.label}</bdi>
              <span className="text-xs text-subtle">
                {sample.seconds !== undefined && sample.resolution !== undefined
                  ? t('billing.pricing.calculator.clip', {
                      credits: creditsLabel(i18n, sample.credits),
                      seconds: formatSeconds(sample.seconds, locale),
                      resolution: isolateLtr(sample.resolution),
                    })
                  : t('billing.pricing.calculator.each', {
                      credits: creditsLabel(i18n, sample.credits),
                    })}
              </span>
            </span>
            <span className="shrink-0 text-end text-base font-semibold text-foreground tabular-nums rtl:font-bold">
              {forms(outputsFor(credits, sample))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CreditCalculatorProps {
  /** Prices of representative models, from the real catalog (`pickCreditSamples`). */
  samples: CreditSamples;
  /** The amounts to choose from. */
  amounts: readonly number[];
  initial: number;
}

/**
 * "What can I make with N credits?": N is chosen among the amounts the shop actually sells, and
 * every line is `floor(N / cost of one generation)` with the cost taken from the catalog
 * (`computeCost`), so it can never disagree with the studio.
 */
export function CreditCalculator({ samples, amounts, initial }: CreditCalculatorProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [credits, setCredits] = useState(initial);
  const titleId = useId();
  if (samples.images.length === 0 && samples.videos.length === 0) return null;

  return (
    <section
      aria-labelledby={titleId}
      className="grid gap-6 rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-8"
    >
      <div className="grid max-w-2xl gap-2">
        <h2 id={titleId} className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold">
          {t('billing.pricing.calculator.title')}
        </h2>
        <p className="text-sm text-muted sm:text-base">
          {t('billing.pricing.calculator.description')}
        </p>
      </div>

      <div className="grid gap-3">
        <SegmentedControl
          aria-label={t('billing.pricing.calculator.amount')}
          options={amounts.map((amount) => ({
            value: String(amount),
            label: formatCredits(amount, locale),
          }))}
          value={String(credits)}
          onValueChange={(value) => setCredits(Number(value))}
          className="w-full flex-wrap sm:w-fit"
        />
        <p className="text-base font-medium text-foreground">
          {t('billing.pricing.calculator.results', { credits: creditsLabel(i18n, credits) })}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ResultList
          icon={ImageIcon}
          title={t('landing.pricing.imagesTitle')}
          samples={samples.images}
          credits={credits}
          kind="images"
        />
        <ResultList
          icon={Clapperboard}
          title={t('landing.pricing.videosTitle')}
          samples={samples.videos}
          credits={credits}
          kind="videos"
        />
      </div>

      <p className="text-xs text-subtle sm:text-sm">{t('billing.pricing.calculator.note')}</p>
    </section>
  );
}
