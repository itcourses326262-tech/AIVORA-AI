'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/radio-group';
import type { BillingCatalogDTO, BillingPackDTO, BillingPlanDTO } from '@/lib/api-types';
import { formatMoney } from '@/lib/billing/format';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { fetchSubscription } from './api';
import { halalasPer100Credits, netHalalas } from './money';
import { CheckoutFailure } from './checkout-failure';
import { Notice } from './notice';
import { PriceCard } from './price-card';
import { SubscribeDialog } from './subscribe-dialog';
import { useCheckout, type UseCheckoutOptions } from './use-checkout';
import { useFetched } from './use-fetched';

type Mode = 'plans' | 'packs';

const REGISTER_HREF = `/register?next=${encodeURIComponent('/pricing')}`;
const LOGIN_HREF = `/login?next=${encodeURIComponent('/pricing')}`;

export interface PricingViewProps {
  /** The price list from `GET /billing/plans` (rendered on the server, so there is no loading state). */
  catalog: BillingCatalogDTO;
  /** Tests inject the navigation and the key source; the app uses the defaults. */
  checkoutOptions?: UseCheckoutOptions;
}

/**
 * The shop: a switch between monthly plans and one-time packs, the cards, and the buy flow.
 * Visitors are sent to create an account and come back here; signed-in buyers start a checkout
 * (a plan first asks for confirmation). The server alone decides prices: a click only names an
 * item. Test payments and a paused shop are announced on top.
 */
export function PricingView({ catalog, checkoutOptions }: PricingViewProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const { user } = useUser();
  const signedIn = user !== null;
  const [mode, setMode] = useState<Mode>('plans');
  const [confirming, setConfirming] = useState<BillingPlanDTO | null>(null);
  const checkout = useCheckout(checkoutOptions);
  const subscription = useFetched(fetchSubscription, signedIn);

  // A plan that is running (or overdue) blocks a second one; an unpaid first month does not.
  const running =
    subscription.state.status === 'ready' &&
    subscription.state.data !== null &&
    (subscription.state.data.status === 'active' || subscription.state.data.status === 'past_due')
      ? subscription.state.data
      : null;

  const phase = checkout.phase;
  const busy = phase.kind === 'starting' || phase.kind === 'redirecting';
  const inProgress = (type: 'pack' | 'subscription', id: string) =>
    busy && phase.item.type === type && phase.item.id === id;
  // A failed attempt is explained inside the card of the item that was pressed.
  const failureOf = (type: 'pack' | 'subscription', id: string): ReactNode =>
    phase.kind === 'failed' && phase.item.type === type && phase.item.id === id ? (
      <CheckoutFailure problem={phase.problem} onDismiss={checkout.dismiss} />
    ) : null;

  function cta(
    kind: 'plan' | 'pack',
    item: BillingPlanDTO | BillingPackDTO,
    highlighted: boolean,
  ): ReactNode {
    const variant = highlighted ? 'primary' : 'secondary';
    if (!catalog.canPurchase) {
      return (
        <Button variant="secondary" fullWidth disabled>
          {t('billing.cta.unavailable')}
        </Button>
      );
    }
    if (!signedIn) {
      return (
        <Button href={REGISTER_HREF} variant={variant} fullWidth>
          {kind === 'plan' ? t('billing.cta.signUpToSubscribe') : t('billing.cta.signUpToBuy')}
        </Button>
      );
    }
    if (kind === 'plan' && running) {
      // The server allows one running plan per account, so another one can only be bought once
      // this one has ended; the notice above says so and links to Billing.
      return (
        <Button variant="secondary" fullWidth disabled>
          {running.planId === item.id
            ? t('billing.cta.currentPlan')
            : t('billing.cta.afterPlanEnds')}
        </Button>
      );
    }
    const type = kind === 'plan' ? 'subscription' : 'pack';
    const here = inProgress(type, item.id);
    return (
      <Button
        variant={variant}
        fullWidth
        loading={here}
        disabled={busy && !here}
        onClick={() => {
          if (kind === 'plan') setConfirming(item as BillingPlanDTO);
          else void checkout.start({ type: 'pack', id: item.id });
        }}
      >
        {here
          ? t('billing.cta.opening')
          : kind === 'plan'
            ? t('billing.cta.subscribe')
            : t('billing.cta.buy')}
      </Button>
    );
  }

  function priceFacts(priceHalalas: number, vatHalalas: number, credits: number) {
    return {
      price: formatMoney(priceHalalas, locale),
      vatLine: t('billing.card.vatIncluded', {
        net: formatMoney(netHalalas(priceHalalas, vatHalalas), locale, { fractionDigits: 2 }),
        vat: formatMoney(vatHalalas, locale, { fractionDigits: 2 }),
        percent: catalog.vatPercent,
      }),
      per100: t('billing.card.per100', {
        price: formatMoney(halalasPer100Credits(priceHalalas, credits), locale, {
          fractionDigits: 2,
        }),
      }),
    };
  }

  const planPerks = [
    t('billing.card.perks.plan.models'),
    t('billing.card.perks.plan.never'),
    t('billing.card.perks.plan.cancel'),
  ];
  const packPerks = [
    t('billing.card.perks.pack.once'),
    t('billing.card.perks.pack.never'),
    t('billing.card.perks.pack.models'),
  ];

  return (
    <div className="grid gap-6">
      {catalog.gateway === 'mock' ? (
        <Notice tone="warning" role="note" title={t('billing.pricing.notice.mockTitle')}>
          {t('billing.pricing.notice.mockBody')}
        </Notice>
      ) : null}
      {!catalog.canPurchase ? (
        <Notice tone="info" role="note" title={t('billing.pricing.notice.offTitle')}>
          {t('billing.pricing.notice.offBody')}
        </Notice>
      ) : null}
      {running ? (
        <Notice
          tone="info"
          role="note"
          title={t('billing.pricing.hasPlan.title')}
          action={
            <Button href="/account/billing" variant="secondary" size="sm">
              {t('billing.pricing.hasPlan.action')}
            </Button>
          }
        >
          {t('billing.pricing.hasPlan.body')}
        </Notice>
      ) : null}
      {phase.kind === 'redirecting' ? (
        <p role="status" className="sr-only">
          {t('billing.cta.opening')}
        </p>
      ) : null}

      <div className="flex justify-center">
        <SegmentedControl
          aria-label={t('billing.pricing.mode.label')}
          options={[
            { value: 'plans', label: t('billing.pricing.mode.plans') },
            { value: 'packs', label: t('billing.pricing.mode.packs') },
          ]}
          value={mode}
          onValueChange={(value) => {
            checkout.dismiss();
            setMode(value === 'packs' ? 'packs' : 'plans');
          }}
        />
      </div>

      {mode === 'plans' ? (
        <section aria-labelledby="pricing-plans-title" className="grid gap-5">
          <div className="grid gap-1 text-center">
            <h2
              id="pricing-plans-title"
              className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold"
            >
              {t('billing.pricing.plans.title')}
            </h2>
            <p className="text-sm text-muted sm:text-base">
              {t('billing.pricing.plans.description')}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {catalog.plans.map((plan) => {
              const facts = priceFacts(plan.priceHalalas, plan.vatHalalas, plan.monthlyCredits);
              const current = running?.planId === plan.id;
              return (
                <PriceCard
                  key={plan.id}
                  id={`plan-${plan.id}`}
                  name={plan.name[locale]}
                  description={plan.description[locale]}
                  badge={
                    current
                      ? t('billing.card.current')
                      : plan.popular
                        ? t('billing.card.popular')
                        : undefined
                  }
                  highlighted={plan.popular}
                  credits={creditsLabel(i18n, plan.monthlyCredits)}
                  cadence={t('billing.card.everyMonth')}
                  price={facts.price}
                  priceSuffix={t('billing.card.perMonth')}
                  vatLine={facts.vatLine}
                  per100={facts.per100}
                  perks={planPerks}
                  notice={failureOf('subscription', plan.id)}
                  cta={cta('plan', plan, plan.popular)}
                />
              );
            })}
          </div>
        </section>
      ) : (
        <section aria-labelledby="pricing-packs-title" className="grid gap-5">
          <div className="grid gap-1 text-center">
            <h2
              id="pricing-packs-title"
              className="text-2xl font-semibold tracking-tight text-foreground rtl:font-bold"
            >
              {t('billing.pricing.packs.title')}
            </h2>
            <p className="text-sm text-muted sm:text-base">
              {t('billing.pricing.packs.description')}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {catalog.packs.map((pack) => {
              const facts = priceFacts(pack.priceHalalas, pack.vatHalalas, pack.credits);
              return (
                <PriceCard
                  key={pack.id}
                  id={`pack-${pack.id}`}
                  name={pack.name[locale]}
                  description={pack.description[locale]}
                  badge={pack.popular ? t('billing.card.popular') : undefined}
                  highlighted={pack.popular}
                  credits={creditsLabel(i18n, pack.credits)}
                  cadence={t('billing.card.oneTime')}
                  price={facts.price}
                  vatLine={facts.vatLine}
                  per100={facts.per100}
                  perks={packPerks}
                  notice={failureOf('pack', pack.id)}
                  cta={cta('pack', pack, pack.popular)}
                />
              );
            })}
          </div>
        </section>
      )}

      <div className="grid justify-items-center gap-1.5 text-center text-sm text-muted">
        <p>{t('billing.pricing.secure')}</p>
        {!signedIn ? (
          <p>
            {t('billing.pricing.loginHint')}{' '}
            <Link
              href={LOGIN_HREF}
              className="hit-area font-medium text-brand underline-offset-4 hover:underline"
            >
              {t('billing.pricing.loginLink')}
            </Link>
          </p>
        ) : null}
      </div>

      <SubscribeDialog
        plan={confirming}
        leadDays={catalog.renewal.leadDays}
        gateway={catalog.gateway}
        onClose={() => setConfirming(null)}
        onConfirm={(plan) => {
          setConfirming(null);
          void checkout.start({ type: 'subscription', id: plan.id });
        }}
      />
    </div>
  );
}
