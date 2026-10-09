import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CreditsPlans } from '@/components/marketing/credits-plans';
import { formatMoney } from '@/lib/billing/format';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { createTranslator } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';

const plain = (html: string) => html.replace(/ /g, ' ').replace(/[‎‏]/g, '');
const render = (locale: 'en' | 'ar') =>
  plain(renderToStaticMarkup(<CreditsPlans i18n={createTranslator(locale)} />));

describe('the landing page plans strip', () => {
  it('lists every plan of the price list with its monthly credits and price', () => {
    for (const locale of ['en', 'ar'] as const) {
      const html = render(locale);
      for (const plan of SUBSCRIPTION_PLANS) {
        expect(html, `${locale} ${plan.id} name`).toContain(plan.name[locale]);
        expect(html, `${locale} ${plan.id} credits`).toContain(
          formatCredits(plan.monthlyCredits, locale),
        );
        expect(html, `${locale} ${plan.id} price`).toContain(
          plain(formatMoney(plan.priceHalalas, locale)),
        );
      }
    }
  });

  it('says what a month costs in plain English', () => {
    const html = render('en');
    expect(html).toContain('1,000 credits a month');
    expect(html).toContain('SAR 49 per month');
    expect(html).toContain('10,000 credits a month');
    expect(html).toContain('SAR 449 per month');
  });

  it('marks the recommended plan, and only that one', () => {
    const html = render('en');
    expect(html.match(/Most popular/g)).toHaveLength(1);
    const popular = SUBSCRIPTION_PLANS.filter((plan) => 'popular' in plan && plan.popular);
    expect(popular.map((plan) => plan.id)).toEqual(['pro']);
  });

  it('quotes the cheapest pack as the entry price', () => {
    const cheapest = CREDIT_PACKS.reduce((a, b) => (b.priceHalalas < a.priceHalalas ? b : a));
    expect(render('en')).toContain(
      `Credit packs start at ${plain(formatMoney(cheapest.priceHalalas, 'en'))} for ${cheapest.credits} credits.`,
    );
    expect(render('ar')).toContain(plain(formatMoney(cheapest.priceHalalas, 'ar')));
  });

  it('links to the pricing page, and says prices include VAT and credits never expire', () => {
    const html = render('en');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('See all prices');
    expect(html).toContain('VAT included');
    expect(html).toContain('credits never expire');
  });

  it('writes Arabic with Arabic-Indic digits and riyals, with no stray Latin currency', () => {
    const html = render('ar');
    expect(html).toContain('تحتاج المزيد؟ باقات وحزم');
    expect(html).toContain('٤٩ ر.س.');
    expect(html).not.toContain('SAR');
  });

  it('contains no invented figures: every digit comes from the price list', () => {
    const html = render('en').replace(/<[^>]+>/g, ' ');
    const figures = new Set(html.match(/\d[\d,]*/g));
    const allowed = new Set<string>();
    for (const plan of SUBSCRIPTION_PLANS) {
      allowed.add(formatCredits(plan.monthlyCredits, 'en'));
      allowed.add(String(plan.priceHalalas / 100));
    }
    for (const pack of CREDIT_PACKS) {
      allowed.add(formatCredits(pack.credits, 'en'));
      allowed.add(String(pack.priceHalalas / 100));
    }
    expect([...figures].filter((figure) => !allowed.has(figure))).toEqual([]);
  });
});
