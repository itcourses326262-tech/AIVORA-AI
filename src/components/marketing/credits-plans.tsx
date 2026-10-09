import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import { formatMoney } from '@/lib/billing/format';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import type { Translator } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { creditsLabel } from './credits-label';
import styles from './marketing.module.css';

/** The smallest purchase of the shop: what "from" means in "packs from SAR 29". */
function cheapestPack() {
  return CREDIT_PACKS.reduce((best, pack) => (pack.priceHalalas < best.priceHalalas ? pack : best));
}

/**
 * What credits cost, for the landing page: the monthly plans and the cheapest pack, straight from
 * the price list the server charges (`lib/billing/plans.ts`), and the way to `/pricing` for the
 * rest. Prices are never typed into the dictionary: they are formatted with `Intl`.
 */
export function CreditsPlans({ i18n }: { i18n: Translator }) {
  const { t, locale } = i18n;
  const pack = cheapestPack();
  return (
    <div
      className={cn(
        'mt-4 grid gap-6 rounded-2xl border border-border bg-surface p-5 shadow-xs sm:p-8 lg:mt-6',
        styles.reveal,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid max-w-xl gap-1.5">
          <h3 className="text-xl font-semibold tracking-tight text-foreground rtl:font-bold">
            {t('landing.pricing.plansTitle')}
          </h3>
          <p className="text-sm text-muted sm:text-base">{t('landing.pricing.plansBody')}</p>
        </div>
        <Button
          href="/pricing"
          endIcon={
            <Directional>
              <ArrowRight className="size-4" />
            </Directional>
          }
        >
          {t('landing.pricing.plansCta')}
        </Button>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {SUBSCRIPTION_PLANS.map((plan) => (
          <li
            key={plan.id}
            className={cn(
              'grid content-start gap-1 rounded-xl border p-4',
              'popular' in plan && plan.popular
                ? 'border-brand/40 bg-brand-soft'
                : 'border-border bg-surface-raised',
            )}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
              {plan.name[locale]}
              {'popular' in plan && plan.popular ? (
                <Badge variant="brand" size="sm">
                  {t('billing.card.popular')}
                </Badge>
              ) : null}
            </span>
            <span className="text-lg font-semibold text-foreground tabular-nums rtl:font-bold">
              {t('landing.pricing.planCredits', {
                credits: creditsLabel(i18n, plan.monthlyCredits),
              })}
            </span>
            <span className="text-sm text-muted tabular-nums">
              {t('landing.pricing.planPrice', { price: formatMoney(plan.priceHalalas, locale) })}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-subtle">
        {t('landing.pricing.packsLine', {
          price: formatMoney(pack.priceHalalas, locale),
          credits: creditsLabel(i18n, pack.credits),
        })}
      </p>
    </div>
  );
}
