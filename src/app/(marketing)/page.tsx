import type { Metadata, ResolvingMetadata } from 'next';
import { ApiTeaser } from '@/components/marketing/api-teaser';
import { CreditsExplainer } from '@/components/marketing/credits-explainer';
import { pickCreditSamples } from '@/components/marketing/credit-samples';
import { Faq, faqEntries } from '@/components/marketing/faq';
import { Features } from '@/components/marketing/features';
import { FinalCta } from '@/components/marketing/final-cta';
import { Hero } from '@/components/marketing/hero';
import { HowItWorks } from '@/components/marketing/how-it-works';
import { JsonLd } from '@/components/marketing/json-ld';
import {
  faqJsonLd,
  landingMetadata,
  siteOrigin,
  softwareApplicationJsonLd,
} from '@/components/marketing/seo';
import { Showcase } from '@/components/marketing/showcase';
import { getModels } from '@/lib/catalog';
import { getI18n } from '@/lib/i18n/server';
import { getEnv } from '@/server/env';

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  return landingMetadata(await getI18n(), (await parent).openGraph?.images);
}

/**
 * The landing page. It is a server component: only the copy button, the header and the footer
 * switchers are client islands. It renders its own `<main id="main-content">` (the marketing
 * layout only adds the site header and footer).
 */
export default async function HomePage() {
  const i18n = await getI18n();
  const bonus = getEnv().SIGNUP_BONUS_CREDITS;
  const origin = siteOrigin();
  const samples = pickCreditSamples(getModels());
  const cheapestImage = samples.images[0];

  return (
    <main id="main-content" tabIndex={-1} className="outline-none">
      <JsonLd data={softwareApplicationJsonLd(i18n, origin)} />
      <JsonLd data={faqJsonLd(faqEntries(i18n))} />
      <Hero i18n={i18n} bonus={bonus} />
      <Showcase i18n={i18n} />
      <Features i18n={i18n} />
      <HowItWorks i18n={i18n} />
      <CreditsExplainer i18n={i18n} bonus={bonus} samples={samples} />
      <ApiTeaser
        i18n={i18n}
        snippet={{
          origin,
          modelId: cheapestImage?.id ?? 'text-to-image-model',
          cost: cheapestImage?.credits ?? 1,
        }}
      />
      <Faq i18n={i18n} />
      <FinalCta i18n={i18n} bonus={bonus} />
    </main>
  );
}
