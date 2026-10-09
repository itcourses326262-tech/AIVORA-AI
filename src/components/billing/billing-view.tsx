'use client';

import { ArrowLeft, Coins } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorState } from '@/components/ui/error-state';
import { Directional } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import type { SubscriptionDTO } from '@/lib/api-types';
import type { BillingMode } from '@/lib/billing/types';
import { useI18n } from '@/lib/i18n/client';
import { LEGAL_MESSAGE_KEY, LEGAL_PATHS } from '@/lib/legal';
import { useUser } from '@/lib/user-context';
import { fetchSubscription } from './api';
import { Notice } from './notice';
import { OrdersCard } from './orders-card';
import { SubscriptionCard } from './subscription-card';
import { useFetched } from './use-fetched';
import { useOrders } from './use-orders';
import { useSubscriptionActions } from './use-subscription-actions';

const LEGAL_LINKS = ['refunds', 'terms', 'privacy'] as const;

function BalanceCard() {
  const i18n = useI18n();
  const { t } = i18n;
  const { creditBalance, refresh } = useUser();
  // The number in the header may be a minute old; this is the page where it should be exact.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid gap-1">
          <p className="flex items-center gap-2 text-sm font-medium text-muted">
            <Coins aria-hidden="true" className="size-4 text-brand" />
            {t('billing.account.balance.title')}
          </p>
          <p className="text-4xl font-bold tracking-tight text-foreground tabular-nums">
            {creditsLabel(i18n, creditBalance)}
          </p>
          <p className="text-sm text-muted">{t('billing.account.balance.note')}</p>
        </div>
        <Button href="/pricing">{t('billing.account.balance.buy')}</Button>
      </CardContent>
    </Card>
  );
}

function PlanSkeleton() {
  const { t } = useI18n();
  return (
    <Card aria-busy="true">
      <CardContent className="grid gap-4">
        <span className="sr-only">{t('common.a11y.loading')}</span>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

export interface BillingViewProps {
  /** Which payment backend runs; the development fake is announced so nobody mistakes it for real. */
  gateway: BillingMode;
}

/**
 * `/account/billing`: the credit balance, the plan (with its dates, payment link and the cancel
 * and resume actions) and the list of payments. The plan and the orders are read from the billing
 * API; a cancel or resume replaces the plan with the server's answer and reads the orders again
 * (a withdrawn renewal link changes one of them).
 */
export function BillingView({ gateway }: BillingViewProps) {
  const { t } = useI18n();
  const subscription = useFetched(fetchSubscription);
  const orders = useOrders();
  const { replace } = subscription;
  const { reload } = orders;
  const onChanged = useCallback(
    (next: SubscriptionDTO) => {
      replace(next);
      reload();
    },
    [replace, reload],
  );
  const actions = useSubscriptionActions({ onChanged });

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="grid gap-2">
        <Link
          href="/account"
          className="hit-area inline-flex w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-muted hover:text-foreground"
        >
          <Directional>
            <ArrowLeft aria-hidden="true" className="size-4" />
          </Directional>
          {t('billing.account.back')}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('billing.account.title')}
        </h1>
        <p className="text-sm text-muted">{t('billing.account.description')}</p>
      </header>

      {gateway === 'mock' ? (
        <Notice tone="warning" role="note" title={t('billing.pricing.notice.mockTitle')}>
          {t('billing.pricing.notice.mockBody')}
        </Notice>
      ) : null}

      <BalanceCard />

      {subscription.state.status === 'ready' ? (
        <SubscriptionCard subscription={subscription.state.data} actions={actions} />
      ) : subscription.state.status === 'error' ? (
        <ErrorState
          error={subscription.state.error}
          title={t('billing.account.loadFailed')}
          onRetry={subscription.reload}
          headingLevel={2}
        />
      ) : (
        <PlanSkeleton />
      )}

      <OrdersCard orders={orders} />

      <nav
        aria-label={t('billing.account.legal.title')}
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-center text-sm text-muted"
      >
        <span>{t('billing.account.legal.prices')}</span>
        {LEGAL_LINKS.map((slug) => (
          <Link
            key={slug}
            href={LEGAL_PATHS[slug]}
            className="hit-area font-medium text-brand underline-offset-4 hover:underline"
          >
            {t(`legal.nav.${LEGAL_MESSAGE_KEY[slug]}`)}
          </Link>
        ))}
      </nav>
    </div>
  );
}
