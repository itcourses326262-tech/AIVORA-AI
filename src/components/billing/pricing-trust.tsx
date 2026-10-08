import { Coins, Lock, ReceiptText, RotateCcw, type LucideIcon } from 'lucide-react';
import type { MessageKey, Translator } from '@/lib/i18n';

const ITEMS: ReadonlyArray<{
  icon: LucideIcon;
  title: MessageKey;
  body: MessageKey;
}> = [
  {
    icon: Lock,
    title: 'billing.pricing.trust.secure.title',
    body: 'billing.pricing.trust.secure.body',
  },
  {
    icon: ReceiptText,
    title: 'billing.pricing.trust.vat.title',
    body: 'billing.pricing.trust.vat.body',
  },
  {
    icon: RotateCcw,
    title: 'billing.pricing.trust.refund.title',
    body: 'billing.pricing.trust.refund.body',
  },
  {
    icon: Coins,
    title: 'billing.pricing.trust.keep.title',
    body: 'billing.pricing.trust.keep.body',
  },
];

/** Four short reassurances under the prices. Every one is a fact of the billing module. */
export function PricingTrust({ i18n }: { i18n: Translator }) {
  const { t } = i18n;
  return (
    <section aria-labelledby="pricing-trust-title" className="grid gap-5">
      <h2
        id="pricing-trust-title"
        className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold"
      >
        {t('billing.pricing.trust.title')}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map(({ icon: Icon, title, body }) => (
          <li
            key={title}
            className="grid content-start gap-2 rounded-2xl border border-border bg-surface p-5"
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand"
            >
              <Icon className="size-4.5" />
            </span>
            <h3 className="text-base font-semibold text-foreground rtl:font-bold">{t(title)}</h3>
            <p className="text-sm text-muted">{t(body)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
