import { Clapperboard, Gift, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Translator } from '@/lib/i18n';
import { cn, formatSeconds } from '@/lib/utils';
import { creditsLabel } from './credits-label';
import { CreditsPlans } from './credits-plans';
import type { CreditSample, CreditSamples } from './credit-samples';
import { Section, SectionHeader } from './section';
import styles from './marketing.module.css';

function PriceList({
  i18n,
  icon: Icon,
  title,
  unit,
  samples,
}: {
  i18n: Translator;
  icon: LucideIcon;
  title: string;
  unit: string;
  samples: readonly CreditSample[];
}) {
  const { locale } = i18n;
  if (samples.length === 0) return null;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-6">
      <h3 className="flex items-center gap-2.5 text-base font-semibold text-foreground rtl:font-bold">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand"
        >
          <Icon className="size-4" />
        </span>
        {title}
        <span className="ms-auto text-sm font-normal text-subtle">{unit}</span>
      </h3>
      <ul className="mt-3 divide-y divide-border">
        {samples.map((sample) => (
          <li key={sample.id} className="flex items-center justify-between gap-4 py-3.5">
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">{sample.label}</span>
              {sample.seconds !== undefined ? (
                <span className="text-xs text-subtle">
                  {formatSeconds(sample.seconds, locale)} · {sample.resolution}
                </span>
              ) : null}
            </span>
            <Badge variant="brand" size="md" className="tabular-nums">
              {creditsLabel(i18n, sample.credits)}
            </Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface CreditsExplainerProps {
  i18n: Translator;
  /** Credits every new account receives (0 hides the free-credits card). */
  bonus: number;
  samples: CreditSamples;
}

export function CreditsExplainer({ i18n, bonus, samples }: CreditsExplainerProps) {
  const { t } = i18n;
  const cheapest = samples.images[0];
  return (
    <Section id="credits">
      <SectionHeader
        id="credits"
        eyebrow={t('landing.pricing.eyebrow')}
        title={t('landing.pricing.title')}
        description={t('landing.pricing.subtitle')}
      />
      <div className={cn('mt-12 grid gap-4 lg:grid-cols-12 lg:gap-6', styles.reveal)}>
        {bonus > 0 ? (
          <div className="relative flex flex-col justify-center gap-6 overflow-hidden rounded-2xl p-6 shadow-md border-gradient-brand sm:p-8 lg:col-span-5">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -end-16 -top-16 size-56 rounded-full bg-brand-gradient opacity-20 blur-3xl"
            />
            <div className="relative grid gap-5">
              <span
                aria-hidden="true"
                className="flex size-11 items-center justify-center rounded-xl bg-primary-gradient text-primary-foreground shadow-glow"
              >
                <Gift className="size-5" />
              </span>
              <div className="grid gap-1">
                <p className="text-sm font-semibold text-brand">{t('landing.pricing.freeTitle')}</p>
                <p className="text-sm text-muted">{t('landing.pricing.freeLead')}</p>
                <p className="text-gradient-brand pb-1 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl rtl:font-bold">
                  {creditsLabel(i18n, bonus)}
                </p>
              </div>
            </div>
            {cheapest ? (
              <p className="relative text-sm leading-relaxed text-muted">
                {t('landing.pricing.freeBody', { count: Math.floor(bonus / cheapest.credits) })}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          className={cn(
            'grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1',
            bonus > 0 ? 'lg:col-span-7' : 'lg:col-span-12 lg:grid-cols-2',
          )}
        >
          <PriceList
            i18n={i18n}
            icon={ImageIcon}
            title={t('landing.pricing.imagesTitle')}
            unit={t('landing.pricing.imagesUnit')}
            samples={samples.images}
          />
          <PriceList
            i18n={i18n}
            icon={Clapperboard}
            title={t('landing.pricing.videosTitle')}
            unit={t('landing.pricing.videosUnit')}
            samples={samples.videos}
          />
        </div>
      </div>
      <p className="mt-6 text-center text-sm text-subtle">{t('landing.pricing.note')}</p>
      <CreditsPlans i18n={i18n} />
    </Section>
  );
}
