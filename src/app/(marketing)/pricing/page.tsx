import type { Metadata } from 'next';
import Link from 'next/link';
import { calculatorPresets } from '@/components/billing/calculator';
import { CreditCalculator } from '@/components/billing/credit-calculator';
import { PricingFaq } from '@/components/billing/pricing-faq';
import { PricingHero } from '@/components/billing/pricing-hero';
import { PricingTrust } from '@/components/billing/pricing-trust';
import { PricingView } from '@/components/billing/pricing-view';
import { pickCreditSamples } from '@/components/marketing/credit-samples';
import { getModels } from '@/lib/catalog';
import { LOCALES } from '@/lib/i18n/locales';
import { getI18n } from '@/lib/i18n/server';
import { LEGAL_MESSAGE_KEY, LEGAL_PATHS } from '@/lib/legal';
import { buildCatalog } from '@/server/billing/catalog';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

const PATH = '/pricing';

/** The price list is public and the same for everybody, so search engines may index it. */
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('billing.meta.pricingTitle'),
    description: t('billing.meta.pricingDescription'),
    alternates: {
      canonical: PATH,
      languages: { ...Object.fromEntries(LOCALES.map((code) => [code, PATH])), 'x-default': PATH },
    },
  };
}

const LEGAL_LINKS = ['refunds', 'terms', 'privacy'] as const;

/**
 * `/pricing`: what credits are, the plans and packs with real prices, what the credits buy, and the
 * answers to the usual billing questions. It is a public page (logged-out visitors are sent to
 * create an account and come back); the buy buttons work for signed-in users. The price list is
 * read from the billing module on the server, so the numbers on the page are the numbers an order
 * is created with.
 */
export default async function PricingPage() {
  const i18n = await getI18n();
  const { t } = i18n;
  const catalog = buildCatalog();
  const samples = pickCreditSamples(getModels());
  const { amounts, initial } = calculatorPresets(catalog);

  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <PricingHero i18n={i18n} bonus={getEnv().SIGNUP_BONUS_CREDITS} />
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 pt-4 pb-20 sm:px-6 sm:pb-28">
        <PricingView catalog={catalog} />
        <CreditCalculator samples={samples} amounts={amounts} initial={initial} />
        <PricingTrust i18n={i18n} />
        <PricingFaq
          i18n={i18n}
          facts={{
            vatPercent: catalog.vatPercent,
            leadDays: catalog.renewal.leadDays,
            graceDays: catalog.renewal.graceDays,
          }}
        />
        <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-sm text-muted">
          <span>{t('billing.pricing.legal')}</span>
          {LEGAL_LINKS.map((slug) => (
            <Link
              key={slug}
              href={LEGAL_PATHS[slug]}
              className="font-medium text-brand underline-offset-4 hover:underline"
            >
              {t(`legal.nav.${LEGAL_MESSAGE_KEY[slug]}`)}
            </Link>
          ))}
        </p>
      </div>
    </main>
  );
}
