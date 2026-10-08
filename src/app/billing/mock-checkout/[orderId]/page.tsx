import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buttonVariants } from '@/components/ui/button-variants';
import { requireUser } from '@/lib/auth-guard';
import { findPurchasable } from '@/lib/billing/plans';
import { formatMoney } from '@/lib/billing/format';
import { mockCheckoutMessages } from '@/lib/billing/mock-checkout-messages';
import { isValidId } from '@/lib/id';
import { getLocale } from '@/lib/i18n/server';
import { formatCredits } from '@/lib/utils';
import { getMockGateway } from '@/server/billing/mock';
import { findOwnedOrder } from '@/server/billing/orders';
import { getDb } from '@/server/db';
import { completeMockCheckout } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Development-only stand-in for the gateway's hosted payment page. It answers 404 in production
 * (checked first, before anything else is looked at), for orders of other accounts and for orders
 * that were not made with the fake gateway.
 */
export default async function MockCheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const { orderId } = await params;
  if (!isValidId(orderId, 'ord')) notFound();

  const user = await requireUser(`/billing/mock-checkout/${orderId}`);
  const order = findOwnedOrder(getDb(), user.id, orderId);
  if (!order || order.gateway !== 'mock') notFound();

  const locale = await getLocale();
  const text = mockCheckoutMessages[locale];
  const item = findPurchasable(order.kind === 'pack' ? 'pack' : 'subscription', order.itemId);
  const payable = order.status === 'pending' && getMockGateway().hasCheckout(order.id);
  // Why there is nothing to pay: it was paid, it is closed, or the fake forgot it (server restart).
  const status = payable
    ? null
    : order.status === 'paid'
      ? text.alreadyPaid
      : order.status === 'pending'
        ? text.lost
        : text.closed;

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-4 py-10 outline-none"
    >
      <p
        role="note"
        className="rounded-xl border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-foreground"
      >
        {text.banner}
      </p>

      <section
        aria-labelledby="mock-checkout-heading"
        className="grid gap-5 rounded-2xl border border-border bg-surface p-6 shadow-sm"
      >
        <h1 id="mock-checkout-heading" className="text-xl font-semibold">
          {text.heading}
        </h1>

        <dl className="grid gap-3 text-sm">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{text.item}</dt>
            <dd className="font-medium">
              {item ? item.name[locale] : order.itemId}
              {order.kind !== 'pack' ? (
                <span className="ms-2 text-xs font-normal text-muted">{text.monthly}</span>
              ) : null}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{text.credits}</dt>
            <dd className="font-medium">{formatCredits(order.credits, locale)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted">{text.vatIncluded}</dt>
            <dd>{formatMoney(order.vatHalalas, locale, { fractionDigits: 2 })}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3 text-base">
            <dt className="font-semibold">{text.total}</dt>
            <dd className="font-semibold">
              {formatMoney(order.amountHalalas, locale, { fractionDigits: 2 })}
            </dd>
          </div>
        </dl>

        {payable ? (
          <form action={completeMockCheckout} className="grid gap-3">
            <input type="hidden" name="orderId" value={order.id} />
            <button
              type="submit"
              name="outcome"
              value="pay"
              className={buttonVariants({ variant: 'primary', size: 'lg', fullWidth: true })}
            >
              {text.pay}
            </button>
            <button
              type="submit"
              name="outcome"
              value="fail"
              className={buttonVariants({ variant: 'secondary', size: 'lg', fullWidth: true })}
            >
              {text.fail}
            </button>
            <p className="text-center text-xs text-muted">{text.hint}</p>
          </form>
        ) : (
          <div className="grid gap-3">
            <p role="status" className="text-sm text-muted">
              {status}
            </p>
            <Link
              href={`/billing/return?order=${order.id}`}
              className={buttonVariants({ variant: 'secondary', size: 'md', fullWidth: true })}
            >
              {text.back}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
