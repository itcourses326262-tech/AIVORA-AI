'use client';

import { ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrderDTO } from '@/lib/api-types';
import { formatMoney } from '@/lib/billing/format';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatCredits, formatDate, formatDateTime, formatNumber } from '@/lib/utils';
import { orderItemName } from './items';
import { checkoutTarget, currentOrigin, returnPath } from './navigation';
import { OrderStatusBadge } from './status-badges';
import type { OrdersState } from './use-orders';

/**
 * What the credits column says: the credits this order still holds in the balance. A number with a
 * plus sign means they are there (`paidAt` is only set in the transaction that grants them); a
 * refund takes credits back, all of them for a full refund and the refunded share (rounded down,
 * as the server does when it takes them back) for a partial one, so the column agrees with the
 * balance. An unpaid order shows what it would bring, in muted type; an order that never
 * delivered credits, or lost them all to a refund, shows a dash.
 */
export function creditsCell(order: OrderDTO): {
  kind: 'granted' | 'pending' | 'none';
  value: number;
} {
  if (order.paidAt !== undefined) {
    if (order.status === 'refunded') return { kind: 'none', value: 0 };
    const takenBack =
      order.status === 'paid' && order.refundedHalalas > 0 && order.amountHalalas > 0
        ? Math.floor((order.credits * order.refundedHalalas) / order.amountHalalas)
        : 0;
    return { kind: 'granted', value: order.credits - takenBack };
  }
  if (order.status === 'pending') return { kind: 'pending', value: order.credits };
  return { kind: 'none', value: 0 };
}

function ItemCell({ order }: { order: OrderDTO }) {
  const { t, locale } = useI18n();
  const name = orderItemName(order, locale);
  return (
    <div className="grid gap-0.5">
      <span className="font-medium text-foreground">
        {t(`billing.account.orders.kind.${order.kind}`, { name })}
      </span>
      {order.kind !== 'pack' && order.periodStart !== undefined && order.periodEnd !== undefined ? (
        <span className="text-xs text-muted">
          {t('billing.account.orders.period', {
            from: formatDate(order.periodStart, locale),
            to: formatDate(order.periodEnd, locale),
          })}
        </span>
      ) : null}
      {order.refundedHalalas > 0 ? (
        <span className="text-xs text-warning">
          {t('billing.account.orders.refunded', {
            amount: formatMoney(order.refundedHalalas, locale, { fractionDigits: 2 }),
          })}
        </span>
      ) : null}
    </div>
  );
}

function CreditsCell({ order }: { order: OrderDTO }) {
  const { t, locale } = useI18n();
  const { kind, value } = creditsCell(order);
  if (kind === 'none') {
    return (
      <span className="text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('billing.account.orders.noCredits')}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        kind === 'granted' && order.status === 'paid' ? 'text-success' : 'text-muted',
      )}
    >
      {kind === 'granted'
        ? formatNumber(value, locale, { signDisplay: 'always', maximumFractionDigits: 0 })
        : formatCredits(value, locale)}
    </span>
  );
}

function ActionCell({ order }: { order: OrderDTO }) {
  const { t } = useI18n();
  const payPage =
    order.status === 'pending' ? checkoutTarget(order.checkoutUrl, currentOrigin()) : null;
  if (payPage) {
    return (
      <Button href={payPage} size="sm">
        {t('billing.account.orders.pay')}
      </Button>
    );
  }
  return (
    <Link
      href={returnPath(order.id)}
      className="hit-area rounded-sm text-sm font-medium text-brand underline-offset-4 hover:underline"
    >
      {t('billing.account.orders.view')}
    </Link>
  );
}

function OrdersSkeleton() {
  const { t } = useI18n();
  return (
    <div aria-busy="true" className="grid gap-3 p-5">
      <span className="sr-only">{t('common.a11y.loading')}</span>
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-12 w-full" />
      ))}
    </div>
  );
}

export interface OrdersCardProps {
  orders: OrdersState;
}

/**
 * Everything the buyer paid for: one row per order with the date, what it was, what it cost
 * (VAT included), its state and the credits it brought. Rows become small stacked blocks on a
 * phone. Newest first; older ones come with "Load more".
 */
export function OrdersCard({ orders }: OrdersCardProps) {
  const { t, locale } = useI18n();

  let body;
  if (orders.status === 'loading') {
    body = <OrdersSkeleton />;
  } else if (orders.status === 'error') {
    body = (
      <div className="p-5">
        <ErrorState
          error={orders.error}
          title={t('billing.account.orders.loadFailed')}
          onRetry={orders.reload}
          headingLevel={3}
        />
      </div>
    );
  } else if (orders.orders.length === 0) {
    body = (
      <div className="p-5">
        <EmptyState
          icon={<ReceiptText />}
          title={t('billing.account.orders.empty.title')}
          description={t('billing.account.orders.empty.body')}
          headingLevel={3}
          action={<Button href="/pricing">{t('billing.account.orders.empty.action')}</Button>}
        />
      </div>
    );
  } else {
    body = (
      <>
        <table className="w-full text-start text-sm max-sm:block">
          <caption className="sr-only">{t('billing.account.orders.title')}</caption>
          <thead className="max-sm:hidden">
            <tr className="border-y border-border bg-surface-raised text-xs text-muted">
              <th scope="col" className="px-5 py-2 text-start font-medium">
                {t('billing.account.orders.columns.date')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('billing.account.orders.columns.item')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('billing.account.orders.columns.amount')}
              </th>
              <th scope="col" className="px-3 py-2 text-end font-medium">
                {t('billing.account.orders.columns.credits')}
              </th>
              <th scope="col" className="px-3 py-2 text-start font-medium">
                {t('billing.account.orders.columns.status')}
              </th>
              <th scope="col" className="px-5 py-2 text-end font-medium">
                <span className="sr-only">{t('billing.account.orders.columns.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {orders.orders.map((order, index) => (
              <tr
                key={order.id}
                className={cn(
                  'align-top max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-2 max-sm:px-5 max-sm:py-4',
                  index > 0 && 'border-t border-border',
                  index === 0 && 'max-sm:border-t max-sm:border-border',
                )}
              >
                <td className="px-5 py-3.5 text-xs whitespace-nowrap text-muted max-sm:order-3 max-sm:p-0">
                  {formatDateTime(order.createdAt, locale)}
                </td>
                <td className="px-3 py-3.5 max-sm:order-1 max-sm:p-0">
                  <ItemCell order={order} />
                </td>
                <td className="px-3 py-3.5 text-end font-medium whitespace-nowrap text-foreground tabular-nums max-sm:order-2 max-sm:p-0">
                  {formatMoney(order.amountHalalas, locale, { fractionDigits: 2 })}
                </td>
                <td className="px-3 py-3.5 text-end whitespace-nowrap max-sm:order-4 max-sm:p-0">
                  <CreditsCell order={order} />
                </td>
                <td className="px-3 py-3.5 max-sm:order-5 max-sm:p-0">
                  <OrderStatusBadge status={order.status} />
                </td>
                <td className="px-5 py-3.5 text-end whitespace-nowrap max-sm:order-6 max-sm:p-0">
                  <ActionCell order={order} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="grid justify-items-center gap-2 border-t border-border p-4">
          {orders.moreFailed ? (
            <p role="alert" className="text-sm text-danger">
              {t('billing.account.orders.loadFailed')}
            </p>
          ) : null}
          {orders.hasMore ? (
            <Button variant="secondary" loading={orders.busy} onClick={orders.loadMore}>
              {orders.busy
                ? t('billing.account.orders.loadingMore')
                : t('billing.account.orders.loadMore')}
            </Button>
          ) : (
            <p className="text-sm text-muted">{t('billing.account.orders.end')}</p>
          )}
        </div>
      </>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle as="h2">{t('billing.account.orders.title')}</CardTitle>
        <CardDescription>{t('billing.account.orders.description')}</CardDescription>
      </CardHeader>
      {body}
    </Card>
  );
}
