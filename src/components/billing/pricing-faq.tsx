import { Plus } from 'lucide-react';
import Link from 'next/link';
import type { MessageKey, Translator } from '@/lib/i18n';

export const PRICING_FAQ_KEYS = [
  'credits',
  'choose',
  'vat',
  'renewal',
  'cancel',
  'failed',
  'refunds',
  'payment',
] as const;

export interface PricingFaqFacts {
  /** The VAT rate in percent (from the price list the server sends). */
  vatPercent: number;
  /** Days before a month ends when its renewal link is issued. */
  leadDays: number;
  /** Days after a month ends during which the renewal can still be paid. */
  graceDays: number;
}

/** The answers state the numbers of the billing module itself, so they cannot drift from it. */
export function pricingFaqEntries({ t }: Pick<Translator, 't'>, facts: PricingFaqFacts) {
  return PRICING_FAQ_KEYS.map((key) => ({
    key,
    question: t(`billing.pricing.faq.items.${key}.question` satisfies MessageKey),
    answer: t(`billing.pricing.faq.items.${key}.answer` satisfies MessageKey, {
      vat: facts.vatPercent,
      days: facts.leadDays,
      grace: facts.graceDays,
    }),
  }));
}

/**
 * Native disclosure widgets, like the landing page's FAQ: keyboard, expanded state and find-in-page
 * come from the browser. The refund answer links to the refund policy.
 */
export function PricingFaq({ i18n, facts }: { i18n: Translator; facts: PricingFaqFacts }) {
  const { t } = i18n;
  return (
    <section aria-labelledby="pricing-faq-title" className="grid gap-5">
      <h2
        id="pricing-faq-title"
        className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold"
      >
        {t('billing.pricing.faq.title')}
      </h2>
      <div className="divide-y divide-border rounded-2xl border border-border bg-surface shadow-xs">
        {pricingFaqEntries(i18n, facts).map((entry, index) => (
          <details
            key={entry.key}
            name="pricing-faq"
            open={index === 0}
            className="group px-5 sm:px-6"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-5 text-start marker:hidden [&::-webkit-details-marker]:hidden">
              <h3 className="text-base font-medium text-foreground rtl:font-semibold">
                {entry.question}
              </h3>
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border text-muted transition-[transform,background-color,color] duration-200 group-open:rotate-45 group-open:bg-brand-soft group-open:text-brand group-hover:text-foreground"
              >
                <Plus className="size-4" />
              </span>
            </summary>
            <div className="animate-fade-in pb-5 text-sm leading-relaxed text-muted sm:text-base">
              <p>{entry.answer}</p>
              {entry.key === 'refunds' ? (
                <p className="mt-2">
                  <Link
                    href="/refunds"
                    className="hit-area font-medium text-brand underline-offset-4 hover:underline"
                  >
                    {t('billing.pricing.faq.refundLink')}
                  </Link>
                </p>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
