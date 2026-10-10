import { Infinity as InfinityIcon, ReceiptText, RotateCcw, type LucideIcon } from 'lucide-react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { MeshBackdrop } from '@/components/marketing/mesh-backdrop';
import type { MessageKey, Translator } from '@/lib/i18n';

const POINTS: ReadonlyArray<{ icon: LucideIcon; key: MessageKey }> = [
  { icon: InfinityIcon, key: 'billing.pricing.points.never' },
  { icon: RotateCcw, key: 'billing.pricing.points.refund' },
  { icon: ReceiptText, key: 'billing.pricing.points.vat' },
];

export interface PricingHeroProps {
  i18n: Translator;
  /** Free credits a visitor can earn by signing up with Google (0 leaves the sentence out). */
  bonus: number;
}

/** The top of the pricing page: what credits are, and the three promises that matter to a buyer. */
export function PricingHero({ i18n, bonus }: PricingHeroProps) {
  const { t } = i18n;
  return (
    // The backdrop runs up behind the transparent site header, like the landing page's.
    <section
      aria-labelledby="pricing-title"
      className="relative isolate -mt-(--header-height) overflow-hidden pt-(--header-height)"
    >
      <MeshBackdrop />
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 pt-14 pb-8 text-center sm:px-6 sm:pt-20 sm:pb-10">
        <p className="inline-flex items-center gap-2.5 text-sm font-semibold text-brand">
          <span aria-hidden="true" className="h-px w-6 bg-brand-gradient" />
          {t('billing.pricing.hero.eyebrow')}
          <span aria-hidden="true" className="h-px w-6 bg-brand-gradient" />
        </p>
        <h1
          id="pricing-title"
          className="mt-4 max-w-3xl text-[2rem] leading-tight font-semibold tracking-tight text-foreground sm:text-5xl rtl:leading-snug rtl:font-bold rtl:max-sm:text-[1.75rem]"
        >
          {t('billing.pricing.hero.title')}
        </h1>
        <p className="mt-5 max-w-2xl text-base text-muted sm:text-lg">
          {t('billing.pricing.hero.subtitle')}
        </p>
        {bonus > 0 ? (
          <p className="mt-3 text-sm font-medium text-accent">
            {t('billing.pricing.hero.bonus', { credits: creditsLabel(i18n, bonus) })}
          </p>
        ) : null}
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          {POINTS.map(({ icon: Icon, key }) => (
            <li
              key={key}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 text-sm text-foreground backdrop-blur"
            >
              <Icon aria-hidden="true" className="size-4 shrink-0 text-brand" />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
