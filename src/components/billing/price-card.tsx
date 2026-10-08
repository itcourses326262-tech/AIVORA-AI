import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export interface PriceCardProps {
  /** Unique on the page; names the card's heading. */
  id: string;
  name: string;
  description: string;
  /** "Most popular" (the highlighted card) or "Your plan". */
  badge?: string;
  highlighted?: boolean;
  /** "3,000 credits" */
  credits: string;
  /** "every month" / "one time" */
  cadence: string;
  /** "SAR 139" */
  price: string;
  /** "/ month" */
  priceSuffix?: string;
  /** "VAT included: SAR 120.87 + 15% VAT (SAR 18.13)" */
  vatLine: string;
  /** "SAR 4.63 per 100 credits" */
  per100: string;
  perks: readonly string[];
  cta: ReactNode;
}

/**
 * One purchasable item: its credits first (that is what is being bought), then the price with
 * the VAT it contains in plain text (a tooltip would be invisible on a phone), the price per 100
 * credits to compare items, what comes with it, and the button. Presentational only: every string
 * is formatted by the caller, so the same card serves plans and packs.
 */
export function PriceCard({
  id,
  name,
  description,
  badge,
  highlighted = false,
  credits,
  cadence,
  price,
  priceSuffix,
  vatLine,
  per100,
  perks,
  cta,
}: PriceCardProps) {
  const titleId = `${id}-title`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        'relative flex flex-col gap-5 rounded-2xl p-6',
        highlighted
          ? 'border-gradient-brand shadow-md [--gradient-fill:var(--surface-raised)]'
          : 'border border-border bg-surface shadow-xs',
      )}
    >
      <header className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 id={titleId} className="text-lg font-semibold text-foreground rtl:font-bold">
            {name}
          </h3>
          {badge ? (
            <Badge variant={highlighted ? 'brand' : 'success'} size="md" dot={!highlighted}>
              {badge}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted">{description}</p>
      </header>

      <div className="grid gap-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-foreground">
          <span className="text-3xl font-semibold tracking-tight tabular-nums rtl:font-bold">
            {credits}
          </span>
          <span className="text-sm text-muted">{cadence}</span>
        </p>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          <span className="text-xl font-semibold text-brand tabular-nums">{price}</span>
          {priceSuffix ? <span className="text-sm text-muted">{priceSuffix}</span> : null}
        </p>
        <p className="text-xs text-subtle">{vatLine}</p>
        <p className="text-xs font-medium text-muted tabular-nums">{per100}</p>
      </div>

      <ul className="grid gap-2.5 text-sm text-foreground">
        {perks.map((perk) => (
          <li key={perk} className="flex items-start gap-2.5">
            <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
            <span>{perk}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-1">{cta}</div>
    </article>
  );
}
