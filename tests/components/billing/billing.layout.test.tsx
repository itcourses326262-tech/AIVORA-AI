import type { Browser } from '@playwright/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckoutFailure } from '@/components/billing/checkout-failure';
import { CreditCalculator } from '@/components/billing/credit-calculator';
import { calculatorPresets } from '@/components/billing/calculator';
import { OrdersCard } from '@/components/billing/orders-card';
import { PriceCard } from '@/components/billing/price-card';
import { PricingFaq } from '@/components/billing/pricing-faq';
import { PricingHero } from '@/components/billing/pricing-hero';
import { PricingTrust } from '@/components/billing/pricing-trust';
import { PricingView } from '@/components/billing/pricing-view';
import { SubscriptionCard } from '@/components/billing/subscription-card';
import type { OrdersState } from '@/components/billing/use-orders';
import { pickCreditSamples } from '@/components/marketing/credit-samples';
import { Button } from '@/components/ui/button';
import type { OrderDTO, SubscriptionDTO } from '@/lib/api-types';
import { DAY_MS } from '@/lib/billing/period';
import { getModels } from '@/lib/catalog';
import { createTranslator } from '@/lib/i18n';
import { I18nProvider } from '@/lib/i18n/client';
import type { Locale } from '@/lib/i18n/locales';
import { UserProvider } from '@/lib/user-context';
import { axeViolationsInPage, chromiumPath, launchBrowser, openPage } from '../browser';
import { catalog, LAYLA, NOW, order, pendingOrder, subscription } from './support';

const noop = () => undefined;
const actions = {
  busy: null,
  problem: null,
  clearProblem: noop,
  cancel: () => Promise.resolve(false),
  resume: () => Promise.resolve(false),
};

function pricingMarkup(locale: Locale, signedIn: boolean): string {
  const i18n = createTranslator(locale);
  const { amounts, initial } = calculatorPresets(catalog());
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={signedIn ? LAYLA : null}>
        <main>
          <PricingHero i18n={i18n} bonus={50} />
          <div className="mx-auto grid w-full max-w-6xl gap-14 px-4 pt-4 pb-20 sm:px-6 sm:pb-28">
            <PricingView catalog={catalog({ gateway: 'mock' })} />
            <CreditCalculator
              samples={pickCreditSamples(getModels())}
              amounts={amounts}
              initial={initial}
            />
            <PricingTrust i18n={i18n} />
            <PricingFaq i18n={i18n} facts={{ vatPercent: 15, leadDays: 3, graceDays: 7 }} />
          </div>
        </main>
      </UserProvider>
    </I18nProvider>,
  );
}

/** Three pack cards, the pressed one explaining why the purchase did not start (with a link). */
function failureMarkup(locale: Locale): string {
  const { t } = createTranslator(locale);
  const card = (id: string, failed: boolean) => (
    <PriceCard
      key={id}
      id={id}
      name={t('billing.card.popular')}
      description={t('billing.pricing.packs.description')}
      credits="5,000"
      cadence={t('billing.card.oneTime')}
      price="229"
      vatLine={t('billing.pricing.legal')}
      per100={t('billing.card.per100', { price: '4.58' })}
      perks={[t('billing.card.perks.pack.once'), t('billing.card.perks.pack.never')]}
      notice={
        failed ? (
          <CheckoutFailure
            problem={{
              message: t('billing.errors.tooManyOpen'),
              link: { href: '/account/billing', label: t('billing.errors.openBilling') },
            }}
            onDismiss={noop}
          />
        ) : undefined
      }
      cta={<Button fullWidth>{t('billing.cta.buy')}</Button>}
    />
  );
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={LAYLA}>
        <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 lg:grid-cols-3">
          {card('a', false)}
          {card('b', false)}
          {card('c', true)}
        </main>
      </UserProvider>
    </I18nProvider>,
  );
}

type Screen = 'pricing' | 'billing' | 'failure';

function markupOf(screen: Screen, locale: Locale, signedIn: boolean): string {
  if (screen === 'pricing') return pricingMarkup(locale, signedIn);
  return screen === 'billing' ? billingMarkup(locale) : failureMarkup(locale);
}

const ORDERS: OrderDTO[] = [
  order({ id: 'ord_0123456789abcdefghjkmnpqr1' }),
  pendingOrder({ id: 'ord_0123456789abcdefghjkmnpqr2' }),
  order({
    id: 'ord_0123456789abcdefghjkmnpqr3',
    kind: 'subscription_renewal',
    itemId: 'studio',
    amountHalalas: 44_900,
    credits: 10_000,
    periodStart: NOW,
    periodEnd: NOW + 30 * DAY_MS,
  }),
  order({ id: 'ord_0123456789abcdefghjkmnpqr4', status: 'failed', paidAt: undefined }),
  order({ id: 'ord_0123456789abcdefghjkmnpqr5', status: 'refunded', refundedHalalas: 7_900 }),
  order({ id: 'ord_0123456789abcdefghjkmnpqr6', status: 'needs_review' }),
  order({ id: 'ord_0123456789abcdefghjkmnpqr7', status: 'canceled', paidAt: undefined }),
];

const ordersState: OrdersState = {
  orders: ORDERS,
  status: 'ready',
  error: null,
  hasMore: true,
  busy: false,
  moreFailed: false,
  loadMore: noop,
  reload: noop,
};

const PLANS: SubscriptionDTO[] = [
  subscription(),
  subscription({
    status: 'past_due',
    currentPeriodEnd: NOW - DAY_MS,
    pendingOrder: pendingOrder({ kind: 'subscription_renewal', itemId: 'pro' }),
  }),
  subscription({ cancelAtPeriodEnd: true }),
  subscription({ status: 'expired' }),
];

function billingMarkup(locale: Locale): string {
  return renderToStaticMarkup(
    <I18nProvider locale={locale}>
      <UserProvider initialUser={LAYLA}>
        <main className="mx-auto grid w-full max-w-4xl gap-6 px-4 py-6 sm:px-6 sm:py-8">
          {PLANS.map((plan) => (
            <SubscriptionCard
              key={plan.status + String(plan.cancelAtPeriodEnd)}
              subscription={plan}
              actions={actions}
            />
          ))}
          <SubscriptionCard subscription={null} actions={actions} />
          <OrdersCard orders={ordersState} />
        </main>
      </UserProvider>
    </I18nProvider>,
  );
}

describe.skipIf(chromiumPath() === undefined)('billing screens in a real browser', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await launchBrowser();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const WIDTHS = [320, 390, 768, 1024, 1440] as const;

  it.each(
    (['ar', 'en'] as const).flatMap((locale) =>
      WIDTHS.flatMap((width) =>
        (['pricing', 'billing', 'failure'] as const).map(
          (screen) => [locale, width, screen] as const,
        ),
      ),
    ),
  )(
    'never scrolls sideways: %s at %ipx, %s',
    async (locale, width, screen) => {
      const markup = markupOf(screen, locale, true);
      const page = await openPage(browser, markup, { locale, width, touch: width < 800 });
      const overflow = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        wide: [...document.querySelectorAll('main *')]
          .filter((node) => {
            const box = node.getBoundingClientRect();
            return box.width > 0 && (box.right > window.innerWidth + 1 || box.left < -1);
          })
          .map((node) => `${node.tagName.toLowerCase()}.${String(node.className).slice(0, 40)}`),
      }));
      await page.context().close();
      expect(overflow.page).toBeLessThanOrEqual(0);
      expect(overflow.wide).toEqual([]);
    },
    60_000,
  );

  it.each(
    (['ar', 'en'] as const).flatMap((locale) =>
      (['dark', 'light'] as const).flatMap((theme) =>
        (['pricing', 'billing', 'failure'] as const).map(
          (screen) => [locale, theme, screen] as const,
        ),
      ),
    ),
  )(
    'has no accessibility or contrast violations: %s, %s, %s',
    async (locale, theme, screen) => {
      const markup = markupOf(screen, locale, false);
      const page = await openPage(browser, markup, { locale, theme, width: 1280 });
      const violations = await axeViolationsInPage(page);
      await page.context().close();
      expect(violations).toEqual([]);
    },
    60_000,
  );

  it('stacks each payment into a small block on a phone and a table row from 640px', async () => {
    const small = await openPage(browser, billingMarkup('en'), {
      locale: 'en',
      width: 390,
      touch: true,
    });
    const phone = await small.evaluate(() => ({
      head: getComputedStyle(document.querySelector('thead') as Element).display,
      row: getComputedStyle(document.querySelector('tbody tr') as Element).display,
    }));
    await small.context().close();
    expect(phone).toEqual({ head: 'none', row: 'grid' });

    const wide = await openPage(browser, billingMarkup('en'), { locale: 'en', width: 1024 });
    const desktop = await wide.evaluate(() => ({
      head: getComputedStyle(document.querySelector('thead') as Element).display,
      row: getComputedStyle(document.querySelector('tbody tr') as Element).display,
    }));
    await wide.context().close();
    expect(desktop).toEqual({ head: 'table-header-group', row: 'table-row' });
  }, 60_000);

  it.each(['pricing', 'failure'] as const)(
    'gives every control on a touch screen a 44px target: %s',
    async (screen) => {
      const page = await openPage(browser, markupOf(screen, 'en', true), {
        locale: 'en',
        width: 390,
        touch: true,
      });
      // A control is pressable 44px tall when it is that tall, or when points 22px above and below
      // its centre still reach it (the invisible layer of the `hit-area` utility).
      const small = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('main button, main a[href], main summary')]
          // Content of a closed <details> is not rendered and cannot be pressed.
          .filter((node) => node.checkVisibility())
          .filter((node) => {
            const box = node.getBoundingClientRect();
            if (box.width === 0 || box.height === 0 || box.height >= 43) return false;
            const x = box.left + box.width / 2;
            const reaches = (y: number) => node.contains(document.elementFromPoint(x, y));
            const centre = box.top + box.height / 2;
            return !(reaches(centre - 21) && reaches(centre + 21));
          })
          .map((node) => `${node.tagName.toLowerCase()} ${node.textContent?.trim().slice(0, 30)}`),
      );
      await page.context().close();
      expect(small).toEqual([]);
    },
    60_000,
  );
});
