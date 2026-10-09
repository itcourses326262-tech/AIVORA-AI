'use client';

import {
  ArrowRight,
  Ban,
  CircleCheck,
  CircleX,
  FileSearch,
  Hourglass,
  Search,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { Directional } from '@/components/ui/icon';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/components/ui/error-message';
import type { OrderDTO } from '@/lib/api-types';
import { formatMoney } from '@/lib/billing/format';
import { isValidId } from '@/lib/id';
import { useI18n } from '@/lib/i18n/client';
import { loginUrl } from '@/lib/next-path';
import { useUser } from '@/lib/user-context';
import { cn, formatDate } from '@/lib/utils';
import { formatTimeOfDay } from './format-time';
import { orderItemName, planDisplayName } from './items';
import { checkoutTarget, currentOrigin, RETURN_PATH } from './navigation';
import { useOrderStatus } from './use-order-status';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE: Record<Tone, string> = {
  neutral: 'bg-brand-soft text-brand',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

function Outcome({
  icon: Icon,
  tone,
  title,
  children,
  after,
  actions,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  /** Announced by screen readers when it changes: the state and what it means. */
  children?: ReactNode;
  /** Shown below, but never announced (a clock that ticks on every check would be read out each time). */
  after?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-6 px-4 py-10 sm:py-16">
      <div className="grid justify-items-center gap-5 rounded-2xl border border-border bg-surface p-6 text-center shadow-sm sm:p-10">
        <span
          aria-hidden="true"
          className={cn('flex size-14 items-center justify-center rounded-2xl', TONE[tone])}
        >
          <Icon className="size-7" />
        </span>
        <div className="grid justify-items-center gap-3">
          <div aria-live="polite" className="grid justify-items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold">
              {title}
            </h1>
            {children}
          </div>
          {after}
        </div>
        {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <p className="max-w-md text-sm text-muted sm:text-base">{children}</p>;
}

/** What was bought, as a small table: the item, what it cost with VAT, and its credits. */
function Summary({ order }: { order: OrderDTO }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  return (
    <dl className="grid w-full max-w-sm gap-2 rounded-xl border border-border bg-surface-raised p-4 text-start text-sm">
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{t('billing.return.summary.item')}</dt>
        <dd className="font-medium text-foreground">{orderItemName(order, locale)}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{t('billing.return.summary.amount')}</dt>
        <dd className="font-medium text-foreground">
          {formatMoney(order.amountHalalas, locale, { fractionDigits: 2 })}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted">{t('billing.return.summary.credits')}</dt>
        <dd className="font-medium text-foreground">{creditsLabel(i18n, order.credits)}</dd>
      </div>
    </dl>
  );
}

function BillingLink({ label }: { label: string }) {
  return (
    <Button href="/account/billing" variant="secondary">
      {label}
    </Button>
  );
}

/**
 * What to offer after a checkout that did not complete. A first purchase starts over from the
 * price list; a plan's renewal is paid from Billing instead (the plan is still running or overdue,
 * so the price list cannot sell it again, and Billing shows the replacement payment link).
 */
function RetryActions({ order }: { order: OrderDTO }) {
  const { t } = useI18n();
  if (order.kind === 'subscription_renewal') {
    return <Button href="/account/billing">{t('billing.return.failed.billing')}</Button>;
  }
  return (
    <>
      <Button href="/pricing">{t('billing.return.failed.retry')}</Button>
      <BillingLink label={t('billing.return.failed.billing')} />
    </>
  );
}

function PaidBody({ order, balanceReady }: { order: OrderDTO; balanceReady: boolean }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { creditBalance } = useUser();
  const credits = creditsLabel(i18n, order.credits);
  const plan = planDisplayName(order.itemId, locale);
  const message =
    order.kind === 'pack'
      ? t('billing.return.paid.pack', { credits })
      : order.kind === 'subscription_initial'
        ? t('billing.return.paid.plan', { plan, credits })
        : t('billing.return.paid.renewal', { plan, credits });
  return (
    <>
      <Body>{message}</Body>
      {order.kind !== 'pack' && order.periodEnd !== undefined ? (
        <Body>
          {t('billing.return.paid.until', { date: formatDate(order.periodEnd, locale, 'long') })}
        </Body>
      ) : null}
      <Summary order={order} />
      <div className="grid gap-1" data-testid="new-balance">
        <p className="text-sm text-muted">{t('billing.return.paid.balance')}</p>
        {balanceReady ? (
          <p className="text-gradient-brand text-3xl font-semibold tabular-nums rtl:font-bold">
            {creditsLabel(i18n, creditBalance)}
          </p>
        ) : (
          <>
            <Skeleton className="mx-auto h-9 w-40" />
            <span className="sr-only">{t('billing.return.paid.balancePending')}</span>
          </>
        )}
      </div>
    </>
  );
}

export interface ReturnViewProps {
  /** The `?order=` value as it came in: null when absent. Anything that is not one of our ids is "not found". */
  orderId: string | null;
}

/**
 * The page the payment provider sends the buyer back to. It never trusts its address: the order id
 * is only a name, and what happened is whatever `GET /billing/orders/:id` says (the server asks the
 * provider). While the payment is unconfirmed it explains, keeps checking and says leaving is safe;
 * when the credits arrive it refreshes the balance in the header and shows the new one.
 */
export function ReturnView({ orderId }: ReturnViewProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { refresh } = useUser();
  const valid = isValidId(orderId, 'ord');
  const { state, checkNow } = useOrderStatus(valid ? orderId : null);
  const [balanceReady, setBalanceReady] = useState(false);

  const paid = state.kind === 'order' && state.order.status === 'paid';
  useEffect(() => {
    if (!paid) return;
    let active = true;
    void refresh().then(() => {
      if (active) setBalanceReady(true);
    });
    return () => {
      active = false;
    };
  }, [paid, refresh]);

  const pricing = (
    <Button href="/pricing" variant="secondary">
      {t('billing.return.seePricing')}
    </Button>
  );
  const billing = <BillingLink label={t('billing.return.openBilling')} />;

  if (orderId === null) {
    return (
      <Outcome
        icon={Search}
        tone="neutral"
        title={t('billing.return.missing.title')}
        actions={
          <>
            {billing}
            {pricing}
          </>
        }
      >
        <Body>{t('billing.return.missing.body')}</Body>
      </Outcome>
    );
  }
  if (!valid || state.kind === 'not_found') {
    return (
      <Outcome
        icon={Search}
        tone="neutral"
        title={t('billing.return.notFound.title')}
        actions={
          <>
            {billing}
            {pricing}
          </>
        }
      >
        <Body>{t('billing.return.notFound.body')}</Body>
      </Outcome>
    );
  }
  if (state.kind === 'session_ended') {
    return (
      <Outcome
        icon={TriangleAlert}
        tone="warning"
        title={t('billing.errors.unauthorized')}
        actions={
          <Button href={loginUrl(`${RETURN_PATH}?order=${orderId}`)}>
            {t('billing.errors.logIn')}
          </Button>
        }
      />
    );
  }
  if (state.kind === 'error') {
    return (
      <Outcome
        icon={TriangleAlert}
        tone="danger"
        title={t('billing.return.error.title')}
        actions={<Button onClick={checkNow}>{t('billing.return.pending.checkNow')}</Button>}
      >
        <Body>{errorMessage(t, state.error)}</Body>
      </Outcome>
    );
  }
  if (state.kind === 'loading') {
    return (
      <Outcome icon={Hourglass} tone="neutral" title={t('billing.return.checking.title')}>
        <Body>{t('billing.return.checking.body')}</Body>
        <Progress className="w-56" label={t('billing.return.checking.title')} />
      </Outcome>
    );
  }

  const { order } = state;
  switch (order.status) {
    case 'paid':
      return (
        <Outcome
          icon={CircleCheck}
          tone="success"
          title={t('billing.return.paid.title')}
          actions={
            <>
              <Button
                href="/studio"
                endIcon={
                  <Directional>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Directional>
                }
              >
                {t('billing.return.paid.start')}
              </Button>
              <BillingLink label={t('billing.return.paid.billing')} />
            </>
          }
        >
          <PaidBody order={order} balanceReady={balanceReady} />
        </Outcome>
      );
    case 'failed':
      return (
        <Outcome
          icon={CircleX}
          tone="danger"
          title={t('billing.return.failed.title')}
          actions={<RetryActions order={order} />}
        >
          <Body>{t('billing.return.failed.body')}</Body>
          <Summary order={order} />
        </Outcome>
      );
    case 'canceled':
      return (
        <Outcome
          icon={Ban}
          tone="neutral"
          title={t('billing.return.canceled.title')}
          actions={<RetryActions order={order} />}
        >
          <Body>{t('billing.return.canceled.body')}</Body>
          <Summary order={order} />
        </Outcome>
      );
    case 'refunded':
      return (
        <Outcome
          icon={Undo2}
          tone="neutral"
          title={t('billing.return.refunded.title')}
          actions={billing}
        >
          <Body>{t('billing.return.refunded.body')}</Body>
          <Summary order={order} />
        </Outcome>
      );
    case 'needs_review':
      return (
        <Outcome
          icon={FileSearch}
          tone="warning"
          title={t('billing.return.review.title')}
          actions={
            <>
              {billing}
              <Button href="/refunds" variant="ghost">
                {t('billing.return.review.contact')}
              </Button>
            </>
          }
        >
          <Body>{t('billing.return.review.body')}</Body>
          <Summary order={order} />
        </Outcome>
      );
    case 'pending': {
      const expired = order.expiresAt !== undefined && order.expiresAt <= state.checkedAt;
      if (expired) {
        return (
          <Outcome
            icon={Hourglass}
            tone="warning"
            title={t('billing.return.expired.title')}
            actions={<RetryActions order={order} />}
          >
            <Body>{t('billing.return.expired.body')}</Body>
            <Summary order={order} />
          </Outcome>
        );
      }
      const payPage = checkoutTarget(order.checkoutUrl, currentOrigin());
      return (
        <Outcome
          icon={Hourglass}
          tone="neutral"
          title={t('billing.return.pending.title')}
          after={
            <p className="text-xs text-subtle">
              {t('billing.return.pending.checkedAt', {
                time: formatTimeOfDay(state.checkedAt, locale),
              })}
            </p>
          }
          actions={
            <>
              <Button variant="secondary" onClick={checkNow}>
                {t('billing.return.pending.checkNow')}
              </Button>
              {payPage ? (
                <Button href={payPage} variant="ghost">
                  {t('billing.return.pending.payPage')}
                </Button>
              ) : null}
              {billing}
            </>
          }
        >
          <Body>{t('billing.return.pending.body')}</Body>
          <Progress className="w-56" label={t('billing.return.pending.title')} />
          {state.long ? <Body>{t('billing.return.pending.long')}</Body> : null}
          {state.trouble ? (
            <p className="text-sm text-warning">{t('billing.return.pending.retrying')}</p>
          ) : null}
          <Summary order={order} />
        </Outcome>
      );
    }
  }
}
