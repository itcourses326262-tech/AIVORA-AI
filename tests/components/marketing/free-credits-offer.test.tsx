import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PricingHero } from '@/components/billing/pricing-hero';
import { CreditsExplainer } from '@/components/marketing/credits-explainer';
import { pickCreditSamples } from '@/components/marketing/credit-samples';
import { Faq, faqEntries } from '@/components/marketing/faq';
import { FinalCta } from '@/components/marketing/final-cta';
import { Hero } from '@/components/marketing/hero';
import { getModels } from '@/lib/catalog';
import { createTranslator, type Locale } from '@/lib/i18n';

/*
 * The free sign-up credits are an offer for Google sign-in. Every surface that promises them takes
 * the amount the page may promise (`signupBonusOffer`): a positive number shows the offer, 0 shows
 * none of it, and nothing of the offer (words, number, gift icon) may be left behind at 0.
 */

const LOCALES: Locale[] = ['en', 'ar'];
const AMOUNT = { en: '50 credits', ar: '٥٠ رصيدًا' } as const;
const TEXT = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const GIFT_ICON = /lucide-gift/;
const OFFER_WORDS = {
  en: /Google|free credits|credits free|on us|Free to start/,
  // (The "Start creating free" button says the account is free, which stays true.)
  ar: /Google|هدية|رصيد\S* مجان/,
};

const samples = pickCreditSamples(getModels());

interface Surface {
  name: string;
  render: (locale: Locale, bonus: number) => string;
  /** Where the surface shows a gift icon next to the promise. */
  gift: boolean;
}

const SURFACES: Surface[] = [
  {
    name: 'the hero',
    gift: true,
    render: (locale, bonus) =>
      renderToStaticMarkup(<Hero i18n={createTranslator(locale)} bonus={bonus} />),
  },
  {
    name: 'the closing call to action',
    gift: true,
    render: (locale, bonus) =>
      renderToStaticMarkup(<FinalCta i18n={createTranslator(locale)} bonus={bonus} />),
  },
  {
    name: 'the credits explainer',
    gift: true,
    render: (locale, bonus) =>
      renderToStaticMarkup(
        <CreditsExplainer i18n={createTranslator(locale)} bonus={bonus} samples={samples} />,
      ),
  },
  {
    name: 'the pricing hero',
    gift: false,
    render: (locale, bonus) =>
      renderToStaticMarkup(<PricingHero i18n={createTranslator(locale)} bonus={bonus} />),
  },
];

describe.each(LOCALES)('the free credits offer (%s)', (locale) => {
  describe.each(SURFACES)('on $name', ({ render, gift }) => {
    it('names Google sign-in and the amount when there is an offer', () => {
      const html = render(locale, 50);
      const text = TEXT(html);
      expect(text).toContain('Google');
      expect(text).toContain(AMOUNT[locale]);
      if (gift) expect(html).toMatch(GIFT_ICON);
    });

    it('shows none of it at 0: no Google, no amount, no icon, no dangling lead-in', () => {
      const html = render(locale, 0);
      const text = TEXT(html);
      expect(text).not.toContain('Google');
      expect(text).not.toContain(AMOUNT[locale]);
      expect(text).not.toMatch(OFFER_WORDS[locale]);
      expect(html).not.toMatch(GIFT_ICON);
      expect(html).not.toContain('{');
    });
  });

  it('the credits explainer still lists the prices when the offer is gone', () => {
    const t = createTranslator(locale);
    const html = renderToStaticMarkup(<CreditsExplainer i18n={t} bonus={0} samples={samples} />);
    expect(TEXT(html)).toContain(t.t('landing.pricing.imagesTitle'));
    expect(html).not.toContain(t.t('landing.pricing.freeTitle'));
    expect(html).not.toContain(t.t('landing.pricing.freeLead'));
  });

  it('the hero still reassures a visitor at 0, without any gift', () => {
    const t = createTranslator(locale);
    const html = renderToStaticMarkup(<Hero i18n={t} bonus={0} />);
    expect(TEXT(html)).toContain(t.t('landing.hero.trustNoBonus'));
  });

  describe('the FAQ answer to "do I have to pay"', () => {
    const t = createTranslator(locale);
    const answer = (bonus?: number) =>
      faqEntries(t, bonus).find((entry) => entry.key === 'free')?.answer ?? '';

    it('promises free credits, through Google, only for a positive offer', () => {
      expect(answer(50)).toContain('Google');
      expect(answer(50)).toBe(t.t('landing.faq.items.free.answer'));
    });

    it('promises none without an offer, and by default', () => {
      for (const bonus of [0, undefined]) {
        expect(answer(bonus)).toBe(t.t('landing.faq.items.free.answerNoBonus'));
        expect(answer(bonus)).not.toContain('Google');
      }
    });

    it('is the answer the page renders, and the other five are untouched', () => {
      const html = renderToStaticMarkup(<Faq i18n={t} bonus={0} />);
      expect(html).toContain(answer(0));
      expect(html).not.toContain(answer(50));
      expect(faqEntries(t, 0).map((entry) => entry.key)).toEqual(
        faqEntries(t, 50).map((entry) => entry.key),
      );
      expect(faqEntries(t, 0).slice(1)).toEqual(faqEntries(t, 50).slice(1));
    });
  });
});
