import { describe, expect, it } from 'vitest';
import {
  faqJsonLd,
  landingMetadata,
  serializeJsonLd,
  siteOrigin,
  softwareApplicationJsonLd,
} from '@/components/marketing/seo';
import { createTranslator } from '@/lib/i18n';

describe('siteOrigin', () => {
  it('is the origin of APP_URL without a path or trailing slash', () => {
    expect(siteOrigin()).toBe('http://localhost:3000');
  });
});

describe('landingMetadata', () => {
  const images = [{ url: '/opengraph-image.png', width: 1200, height: 630 }];

  it.each([
    ['en', 'AIVORE: AI images and video from Arabic or English prompts', 'en_US', 'ar_AR'],
    ['ar', 'AIVORE: صور وفيديوهات بالذكاء الاصطناعي من وصف عربي أو إنجليزي', 'ar_AR', 'en_US'],
  ] as const)('describes the page in %s', (locale, title, ogLocale, alternate) => {
    const metadata = landingMetadata(createTranslator(locale), images);
    expect(metadata.title).toEqual({ absolute: title });
    expect(metadata.description).toBeTruthy();
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      title,
      locale: ogLocale,
      alternateLocale: [alternate],
      images,
    });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title });
  });

  it('uses the canonical URL and names both languages at the one URL they share', () => {
    const metadata = landingMetadata(createTranslator('en'), images);
    expect(String(metadata.metadataBase)).toBe('http://localhost:3000/');
    expect(metadata.alternates).toEqual({
      canonical: '/',
      languages: { ar: '/', en: '/', 'x-default': '/' },
    });
  });

  it('keeps the descriptions apart between languages and inside the search snippet length', () => {
    const en = landingMetadata(createTranslator('en'), images).description ?? '';
    const ar = landingMetadata(createTranslator('ar'), images).description ?? '';
    expect(en).not.toBe(ar);
    expect(en.length).toBeLessThanOrEqual(170);
    expect(ar.length).toBeLessThanOrEqual(170);
  });
});

describe('structured data', () => {
  it('describes a free web application in the active language', () => {
    const data = softwareApplicationJsonLd(createTranslator('ar'), 'https://aivore.example');
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'AIVORE',
      url: 'https://aivore.example',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Web',
      inLanguage: ['ar', 'en'],
      offers: { '@type': 'Offer', price: '0' },
    });
    expect(String(data.description)).toMatch(/[؀-ۿ]/);
  });

  it('builds a FAQ page out of the visible questions', () => {
    const data = faqJsonLd([{ question: 'Q1?', answer: 'A1.' }]) as {
      '@type': string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toEqual([
      { '@type': 'Question', name: 'Q1?', acceptedAnswer: { '@type': 'Answer', text: 'A1.' } },
    ]);
  });

  it('escapes < so no text can close the script tag', () => {
    const json = serializeJsonLd({ text: '</script><script>alert(1)</script>' });
    expect(json).not.toContain('<');
    expect(JSON.parse(json)).toEqual({ text: '</script><script>alert(1)</script>' });
  });
});
