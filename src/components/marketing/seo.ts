import type { Metadata } from 'next';
import type { Translator } from '@/lib/i18n';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import { getEnv } from '@/server/env';

/** `https://host` of this deployment (no trailing slash), from `APP_URL`. */
export function siteOrigin(): string {
  return new URL(getEnv().APP_URL).origin;
}

const OG_LOCALE: Record<Locale, string> = { ar: 'ar_AR', en: 'en_US' };

/**
 * Metadata of the landing page in the active language. The language is chosen per request (cookie,
 * then Accept-Language), so both languages live at the same URL: the canonical and the language
 * alternates all point there, and Open Graph names the other language as an alternate locale.
 */
export function landingMetadata({ t, locale }: Pick<Translator, 't' | 'locale'>): Metadata {
  const title = t('landing.meta.title');
  const description = t('landing.meta.description');
  return {
    metadataBase: new URL(siteOrigin()),
    title: { absolute: title },
    description,
    applicationName: t('common.app.name'),
    alternates: {
      canonical: '/',
      languages: { ...Object.fromEntries(LOCALES.map((code) => [code, '/'])), 'x-default': '/' },
    },
    openGraph: {
      type: 'website',
      url: '/',
      siteName: t('common.app.name'),
      title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((code) => code !== locale).map((code) => OG_LOCALE[code]),
    },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export function softwareApplicationJsonLd(
  { t }: Pick<Translator, 't'>,
  origin: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: t('common.app.name'),
    url: origin,
    description: t('landing.meta.appDescription'),
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    inLanguage: [...LOCALES],
    featureList: [
      t('common.tools.textToImage.name'),
      t('common.tools.imageToImage.name'),
      t('common.tools.textToVideo.name'),
      t('common.tools.imageToVideo.name'),
      t('landing.features.enhancer.title'),
      t('landing.features.api.title'),
    ],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  };
}

export function faqJsonLd(
  items: ReadonlyArray<{ question: string; answer: string }>,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ question, answer }) => ({
      '@type': 'Question',
      name: question,
      acceptedAnswer: { '@type': 'Answer', text: answer },
    })),
  };
}

/** JSON for a `<script type="application/ld+json">`: `<` is escaped so no text can close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
