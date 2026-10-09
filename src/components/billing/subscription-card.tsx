'use client';

import { CalendarClock } from 'lucide-react';
import { useState } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import type { SubscriptionDTO } from '@/lib/api-types';
import { formatMoney } from '@/lib/billing/format';
import { DAY_MS, RENEWAL_LEAD_MS } from '@/lib/billing/period';
import { useI18n } from '@/lib/i18n/client';
import { formatDate } from '@/lib/utils';
import { currentOrigin } from './navigation';
import { Notice } from './notice';
import { PlanStatusBadge } from './status-badges';
import { planFacts } from './subscription-model';
import type { useSubscriptionActions } from './use-subscription-actions';

const LEAD_DAYS = Math.round(RENEWAL_LEAD_MS / DAY_MS);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

export interface SubscriptionCardProps {
  subscription: SubscriptionDTO | null;
  actions: ReturnType<typeof useSubscriptionActions>;
}

/**
 * The plan: its state in one badge, the dates and amounts that matter (when it renews or ends,
 * what the next payment is), a banner when a payment is due, and the few things the owner can do.
 * Cancelling asks first; it ends the plan with the month already paid and takes nothing back.
 */
export function SubscriptionCard({ subscription, actions }: SubscriptionCardProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  if (subscription === null) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle as="h2">{t('billing.account.plan.title')}</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <EmptyState
            icon={<CalendarClock />}
            title={t('billing.account.plan.none.title')}
            description={t('billing.account.plan.none.body')}
            headingLevel={3}
            action={<Button href="/pricing">{t('billing.account.plan.none.action')}</Button>}
          />
        </CardContent>
      </Card>
    );
  }

  const facts = planFacts(subscription, currentOrigin());
  const { phase, plan, periodEnd, endedAt, graceEnd, payable } = facts;
  const date = (ms: number | null) => (ms === null ? '' : formatDate(ms, locale, 'long'));
  // The server lets a plan be canceled while it is running unpaid-for, overdue or awaiting its first payment.
  const cancellable = phase === 'active' || phase === 'past_due' || phase === 'incomplete';
  const dialogOpen = confirmingCancel && cancellable;
  const ended = phase === 'canceled' || phase === 'expired';
  const price = plan ? formatMoney(plan.priceHalalas, locale, { fractionDigits: 2 }) : null;

  const cancelBody =
    phase === 'past_due'
      ? t('billing.account.plan.cancelDialog.bodyNow')
      : phase === 'incomplete'
        ? t('billing.account.plan.cancelDialog.bodyUnpaid')
        : t('billing.account.plan.cancelDialog.body', { date: date(periodEnd) });

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle as="h2">{t('billing.account.plan.title')}</CardTitle>
          <PlanStatusBadge phase={phase} />
        </div>
        <CardDescription>{plan ? plan.description[locale] : subscription.planId}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        {phase === 'past_due' ? (
          <Notice
            tone="warning"
            title={t('billing.account.plan.pastDue.title')}
            action={
              payable ? (
                <Button href={payable.href}>{t('billing.account.plan.payNow')}</Button>
              ) : undefined
            }
          >
            {t('billing.account.plan.pastDue.body', { date: date(graceEnd) })}
            {payable ? null : <> {t('billing.account.plan.pastDue.noLink')}</>}
          </Notice>
        ) : null}
        {phase === 'active' && payable ? (
          <Notice
            tone="info"
            title={t('billing.account.plan.renewalReady.title')}
            action={<Button href={payable.href}>{t('billing.account.plan.payNow')}</Button>}
          >
            {t('billing.account.plan.renewalReady.body', { date: date(periodEnd) })}
          </Notice>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2">
          <Row label={t('billing.account.plan.name')}>
            {plan ? plan.name[locale] : subscription.planId}
          </Row>
          <Row label={t('billing.account.plan.credits')}>
            {plan
              ? t('billing.account.plan.creditsValue', {
                  credits: creditsLabel(i18n, plan.monthlyCredits),
                })
              : '—'}
          </Row>
          <Row label={t('billing.account.plan.price')}>
            {price ? t('billing.account.plan.priceValue', { price }) : '—'}
          </Row>
          {periodEnd !== null ? (
            <Row
              label={
                ended
                  ? t('billing.account.plan.endedOn')
                  : phase === 'canceling'
                    ? t('billing.account.plan.ends')
                    : phase === 'past_due'
                      ? t('billing.account.plan.periodEnded')
                      : t('billing.account.plan.renews')
              }
            >
              {date(ended ? endedAt : periodEnd)}
            </Row>
          ) : null}
          {(phase === 'active' || phase === 'past_due') && price && periodEnd !== null ? (
            <Row label={t('billing.account.plan.next')}>
              {t('billing.account.plan.nextValue', {
                price,
                date: date(phase === 'past_due' ? graceEnd : periodEnd),
              })}
            </Row>
          ) : null}
        </dl>

        <p className="text-sm text-muted">
          {phase === 'active'
            ? t('billing.account.plan.notes.renewal', { days: LEAD_DAYS })
            : phase === 'canceling'
              ? t('billing.account.plan.notes.canceling', { date: date(periodEnd) })
              : phase === 'incomplete'
                ? t('billing.account.plan.notes.incomplete')
                : ended
                  ? t('billing.account.plan.notes.ended')
                  : null}
        </p>

        {/* While the cancel dialog is open it shows the failure itself; behind it the page is inert. */}
        {actions.problem && !dialogOpen ? (
          <Notice
            tone="danger"
            title={actions.problem.message}
            action={
              actions.problem.link ? (
                <Button href={actions.problem.link.href} variant="secondary" size="sm">
                  {actions.problem.link.label}
                </Button>
              ) : undefined
            }
          />
        ) : null}

        <div className="flex flex-wrap gap-2">
          {phase === 'incomplete' && payable ? (
            <Button href={payable.href}>{t('billing.account.plan.completePayment')}</Button>
          ) : null}
          {phase === 'canceling' ? (
            <Button loading={actions.busy === 'resume'} onClick={() => void actions.resume()}>
              {t('billing.account.plan.resume')}
            </Button>
          ) : null}
          {phase === 'active' ? (
            <Button href="/pricing" variant="secondary">
              {t('billing.account.plan.change')}
            </Button>
          ) : null}
          {cancellable ? (
            <Button
              variant="outline"
              onClick={() => {
                actions.clearProblem();
                setConfirmingCancel(true);
              }}
            >
              {t('billing.account.plan.cancel')}
            </Button>
          ) : null}
          {ended ? <Button href="/pricing">{t('billing.account.plan.again')}</Button> : null}
        </div>
      </CardContent>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          // Escape, the backdrop and the close button all mean "keep the plan"; not while the
          // request is running, because its answer decides what the card shows next.
          if (open || actions.busy === 'cancel') return;
          actions.clearProblem();
          setConfirmingCancel(false);
        }}
        role="alertdialog"
        title={t('billing.account.plan.cancelDialog.title')}
        description={cancelBody}
        bodyClassName={actions.problem ? undefined : 'py-0'}
        footer={
          <>
            <Button
              variant="secondary"
              data-autofocus
              disabled={actions.busy === 'cancel'}
              onClick={() => {
                actions.clearProblem();
                setConfirmingCancel(false);
              }}
            >
              {t('billing.account.plan.keep')}
            </Button>
            <Button
              variant="danger"
              loading={actions.busy === 'cancel'}
              onClick={() => {
                void actions.cancel().then((done) => {
                  if (done) setConfirmingCancel(false);
                });
              }}
            >
              {t('billing.account.plan.cancelDialog.confirm')}
            </Button>
          </>
        }
      >
        {actions.problem ? (
          <p role="alert" className="text-sm text-danger">
            {actions.problem.message}
          </p>
        ) : null}
      </Dialog>
    </Card>
  );
}
