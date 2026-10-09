import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PricingView } from '@/components/billing/pricing-view';
import { formatMoney } from '@/lib/billing/format';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { createTranslator } from '@/lib/i18n';
import { axeViolations } from '../axe';
import {
  catalog,
  installFakeApi,
  json,
  mountBilling,
  order,
  pendingOrder,
  resetBillingTest,
  plain,
  subscription,
  text,
} from './support';

afterEach(resetBillingTest);

const articles = () => screen.getAllByRole('article');
const cardNamed = (name: string) => {
  const match = articles().find((card) => within(card).queryByRole('heading', { name }));
  if (!match) throw new Error(`no card named ${name}`);
  return match;
};

describe('plans view, signed out', () => {
  it('shows the three plans with credits, price, VAT split and price per 100 credits (English)', () => {
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    expect(articles()).toHaveLength(3);
    const pro = cardNamed('Pro');
    expect(within(pro).getByText('3,000 credits')).toBeInTheDocument();
    expect(within(pro).getByText('every month')).toBeInTheDocument();
    expect(within(pro).getByText('SAR 139')).toBeInTheDocument();
    expect(within(pro).getByText('/ month')).toBeInTheDocument();
    expect(
      within(pro).getByText('VAT included: SAR 120.87 + SAR 18.13 VAT (15%)'),
    ).toBeInTheDocument();
    expect(within(pro).getByText('SAR 4.63 per 100 credits')).toBeInTheDocument();
    expect(within(cardNamed('Starter')).getByText('SAR 4.90 per 100 credits')).toBeInTheDocument();
    expect(within(cardNamed('Studio')).getByText('SAR 4.49 per 100 credits')).toBeInTheDocument();
  });

  it('highlights the recommended plan only', () => {
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    expect(within(cardNamed('Pro')).getByText('Most popular')).toBeInTheDocument();
    expect(screen.getAllByText('Most popular')).toHaveLength(1);
  });

  it('states what every plan really includes, including cancel any time and credits that never expire', () => {
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    const pro = within(cardNamed('Pro'));
    expect(pro.getByText(/Credits never expire, even after you cancel/)).toBeInTheDocument();
    expect(
      pro.getByText(/Cancel any time; the plan ends with the month you paid for/),
    ).toBeInTheDocument();
    expect(pro.getByText(/Every model in the studio and the API/)).toBeInTheDocument();
  });

  it('formats prices as Saudi riyals with Arabic-Indic digits in Arabic', () => {
    mountBilling(<PricingView catalog={catalog()} />, { user: null, locale: 'ar' });
    const pro = within(cardNamed('المحترف'));
    expect(pro.getByText(text(formatMoney(13_900, 'ar')))).toBeInTheDocument();
    expect(plain(formatMoney(13_900, 'ar'))).toMatch(/^[٠-٩]+ ر\.س\.$/);
    expect(pro.getByText(/٣[٬,]٠٠٠ رصيد/)).toBeInTheDocument();
    expect(
      pro.getByText((content) =>
        /^شامل الضريبة: ١٢٠٫٨٧ ر\.س\. \+ ١٨٫١٣ ر\.س\. ضريبة قيمة مضافة \(١٥٪\)$/.test(
          plain(content),
        ),
      ),
    ).toBeInTheDocument();
    expect(pro.getByText(text('٤٫٦٣ ر.س. لكل ١٠٠ رصيد'))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SAR/);
    expect(within(cardNamed('المحترف')).getByText('الأكثر طلبًا')).toBeInTheDocument();
  });

  it('sends visitors to create an account and come back to the pricing page', () => {
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    const buttons = screen.getAllByRole('link', { name: 'Sign up to subscribe' });
    expect(buttons).toHaveLength(3);
    for (const button of buttons)
      expect(button).toHaveAttribute('href', '/register?next=%2Fpricing');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fpricing',
    );
  });

  it('never asks a visitor about their plan or starts a checkout', () => {
    const api = installFakeApi();
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    expect(api.calls).toEqual([]);
  });

  it('has no accessibility violations in either language', async () => {
    const { container, unmount } = mountBilling(<PricingView catalog={catalog()} />, {
      user: null,
    });
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    const arabic = mountBilling(<PricingView catalog={catalog()} />, { user: null, locale: 'ar' });
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});

describe('the plans / packs toggle', () => {
  it('switches to the one-time packs and back', async () => {
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    const toggle = screen.getByRole('radiogroup', { name: 'What would you like to buy?' });
    expect(within(toggle).getByRole('radio', { name: 'Monthly plans' })).toBeChecked();

    await user.click(within(toggle).getByRole('radio', { name: 'One-time packs' }));
    expect(screen.getByRole('heading', { name: 'One-time credit packs' })).toBeInTheDocument();
    expect(articles().map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Small pack',
      'Medium pack',
      'Large pack',
    ]);
    const medium = within(cardNamed('Medium pack'));
    expect(medium.getByText('1,500 credits')).toBeInTheDocument();
    expect(medium.getByText('one time')).toBeInTheDocument();
    expect(medium.getByText('SAR 79')).toBeInTheDocument();
    expect(medium.getByText('SAR 5.27 per 100 credits')).toBeInTheDocument();
    expect(medium.getByText('Most popular')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign up to buy' })).toHaveLength(3);

    await user.click(within(toggle).getByRole('radio', { name: 'Monthly plans' }));
    expect(screen.getByRole('heading', { name: 'Monthly plans', level: 2 })).toBeInTheDocument();
    expect(articles()).toHaveLength(3);
  });

  it('prices every pack and plan exactly as the shared price list does', async () => {
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} />, { user: null });
    for (const plan of SUBSCRIPTION_PLANS) {
      expect(
        within(cardNamed(plan.name.en)).getByText(text(formatMoney(plan.priceHalalas, 'en'))),
      ).toBeInTheDocument();
    }
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    for (const pack of CREDIT_PACKS) {
      expect(
        within(cardNamed(pack.name.en)).getByText(text(formatMoney(pack.priceHalalas, 'en'))),
      ).toBeInTheDocument();
    }
  });
});

describe('notices', () => {
  it('shows the test-payments notice only while the fake gateway is on', () => {
    const { unmount } = mountBilling(<PricingView catalog={catalog({ gateway: 'mock' })} />, {
      user: null,
    });
    const notice = screen.getByRole('note');
    expect(within(notice).getByText('Test payments')).toBeInTheDocument();
    expect(notice).toHaveTextContent('No card is charged and no real money moves.');
    unmount();

    mountBilling(<PricingView catalog={catalog({ gateway: 'moyasar' })} />, { user: null });
    expect(screen.queryByText('Test payments')).not.toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says so in Arabic too', () => {
    mountBilling(<PricingView catalog={catalog({ gateway: 'mock' })} />, {
      user: null,
      locale: 'ar',
    });
    expect(screen.getByText('مدفوعات تجريبية')).toBeInTheDocument();
  });

  it('disables buying and explains when the shop is closed', async () => {
    const api = installFakeApi({ 'GET /billing/subscription': () => json({ data: null }) });
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog({ gateway: 'off', canPurchase: false })} />);
    expect(screen.getByText('Buying is paused')).toBeInTheDocument();
    expect(screen.queryByText('Test payments')).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Not available right now' });
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    for (const button of screen.getAllByRole('button', { name: 'Not available right now' })) {
      expect(button).toBeDisabled();
    }
    expect(api.to('POST /billing/checkout')).toEqual([]);
  });
});

describe('a signed-in buyer with a running plan', () => {
  it('cannot start a second plan: the current plan is marked, the others wait, packs stay open', async () => {
    installFakeApi({
      'GET /billing/subscription': () => json({ data: subscription({ planId: 'pro' }) }),
    });
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} />);
    expect(await screen.findByText('You already have a plan')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Manage plan' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
    expect(within(cardNamed('Pro')).getByText('Your plan')).toBeInTheDocument();
    expect(
      within(cardNamed('Pro')).getByRole('button', { name: 'Your current plan' }),
    ).toBeDisabled();
    expect(
      within(cardNamed('Starter')).getByRole('button', { name: 'Available after your plan ends' }),
    ).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    for (const button of screen.getAllByRole('button', { name: 'Buy now' })) {
      expect(button).toBeEnabled();
    }
  });

  it.each(['canceled', 'expired'] as const)(
    'may subscribe again once the plan is %s',
    async (status) => {
      const api = installFakeApi({
        'GET /billing/subscription': () => json({ data: subscription({ status }) }),
      });
      mountBilling(<PricingView catalog={catalog()} />);
      await vi.waitFor(() => expect(api.to('GET /billing/subscription')).toHaveLength(1));
      expect(await screen.findAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
      expect(screen.queryByText('You already have a plan')).not.toBeInTheDocument();
    },
  );

  it('treats a plan that is only waiting for its first payment as not blocking', async () => {
    const api = installFakeApi({
      'GET /billing/subscription': () => json({ data: subscription({ status: 'incomplete' }) }),
    });
    mountBilling(<PricingView catalog={catalog()} />);
    await vi.waitFor(() => expect(api.to('GET /billing/subscription')).toHaveLength(1));
    expect(await screen.findAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
  });
});

describe('the confirmation before subscribing', () => {
  async function openProDialog() {
    const api = installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': () =>
        json({ data: pendingOrder({ kind: 'subscription_initial', itemId: 'pro' }) }, 201),
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(
      <PricingView catalog={catalog()} checkoutOptions={{ navigate, newKey: () => 'key-1' }} />,
    );
    await vi.waitFor(() => expect(api.to('GET /billing/subscription')).toHaveLength(1));
    await user.click(within(cardNamed('Pro')).getByRole('button', { name: 'Subscribe' }));
    return { api, navigate, user };
  }

  it('states the price, the renewal cadence and how to cancel before anything is sent', async () => {
    const { api } = await openProDialog();
    const dialog = await screen.findByRole('dialog', { name: 'Subscribe to Pro?' });
    expect(dialog).toHaveTextContent('SAR 139 per month, VAT included');
    expect(dialog).toHaveTextContent('3,000 credits now, and again every month');
    expect(dialog).toHaveTextContent(
      'About 3 days before your month ends we email you a payment link, and it also waits in Billing. We never charge your card automatically. If the month ends unpaid we send a reminder.',
    );
    expect(dialog).toHaveTextContent('Cancel any time in Billing');
    expect(dialog).toHaveTextContent('You will pay on the payment provider’s secure page.');
    expect(api.to('POST /billing/checkout')).toEqual([]);
  });

  it('leaves without a request when the buyer says not now', async () => {
    const { api, user } = await openProDialog();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.to('POST /billing/checkout')).toEqual([]);
  });

  it('closes with Escape and still sends nothing', async () => {
    const { api, user } = await openProDialog();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.to('POST /billing/checkout')).toEqual([]);
  });

  it('starts the checkout for that plan once confirmed, and follows the payment page', async () => {
    const { api, navigate, user } = await openProDialog();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Continue to payment' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const [call] = api.to('POST /billing/checkout');
    expect(call?.body).toEqual({ type: 'subscription', id: 'pro' });
    expect(call?.headers.get('Idempotency-Key')).toBe('key-1');
    expect(navigate).toHaveBeenCalledWith('https://pay.example.com/invoices/inv_1');
  });

  it('tells a test payment apart from a real one', async () => {
    installFakeApi({ 'GET /billing/subscription': () => json({ data: null }) });
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog({ gateway: 'mock' })} />);
    await user.click(within(cardNamed('Pro')).getByRole('button', { name: 'Subscribe' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      'This is a test payment: no real money moves.',
    );
  });
});

describe('buying a pack', () => {
  it('sends the item and nothing else, with an Idempotency-Key, then follows the returned page', async () => {
    const api = installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': () => json({ data: pendingOrder() }, 201),
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(
      <PricingView catalog={catalog()} checkoutOptions={{ navigate, newKey: () => 'k1' }} />,
    );
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    await user.click(within(cardNamed('Medium pack')).getByRole('button', { name: 'Buy now' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const [call] = api.to('POST /billing/checkout');
    expect(call?.body).toEqual({ type: 'pack', id: 'pack-1500' });
    expect(Object.keys(call?.body as object).sort()).toEqual(['id', 'type']);
    expect(call?.headers.get('Idempotency-Key')).toBe('k1');
    expect(navigate).toHaveBeenCalledWith('https://pay.example.com/invoices/inv_1');
  });

  it('opens one checkout however fast the button is clicked, and disables the others meanwhile', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const api = installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': async () => {
        await gate;
        return json({ data: pendingOrder() }, 201);
      },
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(
      <PricingView catalog={catalog()} checkoutOptions={{ navigate, newKey: () => 'k1' }} />,
    );
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    const medium = within(cardNamed('Medium pack')).getByRole('button', { name: 'Buy now' });
    await user.dblClick(medium);
    await user.click(medium);

    expect(api.to('POST /billing/checkout')).toHaveLength(1);
    const pending = within(cardNamed('Medium pack')).getByRole('button', {
      name: 'Opening payment page…',
    });
    expect(pending).toHaveAttribute('aria-busy', 'true');
    expect(within(cardNamed('Small pack')).getByRole('button', { name: 'Buy now' })).toBeDisabled();
    expect(within(cardNamed('Large pack')).getByRole('button', { name: 'Buy now' })).toBeDisabled();

    release?.();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    // The page is being left: a late click must not start a second checkout.
    await user.click(screen.getByRole('button', { name: 'Opening payment page…' }));
    expect(api.to('POST /billing/checkout')).toHaveLength(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('refuses to follow a payment address that is not https or this site', async () => {
    installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': () =>
        json({ data: pendingOrder({ checkoutUrl: 'javascript:alert(1)' }) }, 201),
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} checkoutOptions={{ navigate }} />);
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    await user.click(within(cardNamed('Small pack')).getByRole('button', { name: 'Buy now' }));
    expect(
      await screen.findByText(
        'The payment page could not be opened. Nothing was charged, so please try again.',
      ),
    ).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    // The button is usable again.
    expect(within(cardNamed('Small pack')).getByRole('button', { name: 'Buy now' })).toBeEnabled();
  });

  it('sends a buyer whose replayed order was paid in the meantime to the result page', async () => {
    const paid = order({ id: 'ord_0123456789abcdefghjkmnpqrs' });
    installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': () => json({ data: paid }),
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} checkoutOptions={{ navigate }} />);
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    await user.click(within(cardNamed('Medium pack')).getByRole('button', { name: 'Buy now' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith(`/billing/return?order=${paid.id}`);
  });
});

describe('checkout keys and errors', () => {
  async function buyMedium(
    handler: () => Response | Promise<Response>,
    locale: 'en' | 'ar' = 'en',
  ) {
    const keys = ['k1', 'k2', 'k3'];
    const api = installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': handler,
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    mountBilling(
      <PricingView
        catalog={catalog()}
        checkoutOptions={{ navigate, newKey: () => keys.shift() ?? 'kx' }}
      />,
      { locale },
    );
    await user.click(
      screen.getByRole('radio', { name: locale === 'ar' ? 'حزم لمرة واحدة' : 'One-time packs' }),
    );
    const name = locale === 'ar' ? 'حزمة متوسطة' : 'Medium pack';
    const label = locale === 'ar' ? 'اشترِ الآن' : 'Buy now';
    const click = () => user.click(within(cardNamed(name)).getByRole('button', { name: label }));
    return { api, navigate, click };
  }

  const conflict = (reason: string) => () =>
    Promise.resolve(
      json({ error: { code: 'conflict', message: 'English message', details: { reason } } }, 409),
    );

  describe.each(['en', 'ar'] as const)('conflicts in %s', (locale) => {
    it.each([
      ['subscription_exists', 'subscriptionExists'],
      ['checkout_in_progress', 'checkoutInProgress'],
      ['idempotency_key_reused', 'keyReused'],
      ['checkout_closed', 'checkoutClosed'],
    ] as const)('maps %s to localized text, never the English message', async (reason, key) => {
      const { click } = await buyMedium(conflict(reason), locale);
      await click();
      expect(
        await screen.findByText(createTranslator(locale).t(`billing.errors.${key}`)),
      ).toBeInTheDocument();
      expect(screen.queryByText('English message')).not.toBeInTheDocument();
    });
  });

  it('links to Billing from the "you already have a plan" error', async () => {
    const { click } = await buyMedium(conflict('subscription_exists'));
    await click();
    expect(await screen.findByRole('link', { name: 'Open Billing' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
  });

  it('explains a closed shop (503 billing_disabled)', async () => {
    const { click } = await buyMedium(() =>
      json(
        {
          error: { code: 'provider_error', message: 'x', details: { reason: 'billing_disabled' } },
        },
        503,
      ),
    );
    await click();
    expect(
      await screen.findByText('Buying credits is not available right now. Please try again later.'),
    ).toBeInTheDocument();
  });

  it('explains too many unpaid checkouts (429) and sends the buyer to Billing, where they can be paid', async () => {
    const { click } = await buyMedium(() =>
      json({ error: { code: 'too_many_active', message: 'x' } }, 429),
    );
    await click();
    expect(await screen.findByText(/You have several unpaid checkouts open/)).toBeInTheDocument();
    expect(screen.getByText(/Pay for one of them in Billing/)).toBeInTheDocument();
    const alert = within(cardNamed('Medium pack')).getByRole('alert');
    expect(within(alert).getByRole('link', { name: 'Open Billing' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
  });

  it('asks an expired session to log in again and comes back to pricing', async () => {
    const { click } = await buyMedium(() =>
      json({ error: { code: 'unauthorized', message: 'x' } }, 401),
    );
    await click();
    expect(
      await screen.findByText('Your session has ended. Log in again to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fpricing',
    );
  });

  it('falls back to the generic localized message for any other failure', async () => {
    const { click } = await buyMedium(() =>
      json({ error: { code: 'internal', message: 'boom' } }, 500),
    );
    await click();
    expect(
      await screen.findByText(createTranslator('en').t('errors.internal')),
    ).toBeInTheDocument();
    expect(screen.queryByText('boom')).not.toBeInTheDocument();
  });

  it('uses a new Idempotency-Key after a definite answer, so a failed order is never replayed', async () => {
    const { api, click } = await buyMedium(conflict('subscription_exists'));
    await click();
    await screen.findByText(createTranslator('en').t('billing.errors.subscriptionExists'));
    await click();
    await vi.waitFor(() => expect(api.to('POST /billing/checkout')).toHaveLength(2));
    const keys = api
      .to('POST /billing/checkout')
      .map((call) => call.headers.get('Idempotency-Key'));
    expect(keys).toEqual(['k1', 'k2']);
  });

  it('re-sends the same key when the answer never arrived, so a lost reply cannot buy twice', async () => {
    let attempt = 0;
    const { api, navigate, click } = await buyMedium(() => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return json({ data: pendingOrder() }, 200);
    });
    await click();
    expect(
      await screen.findByText(createTranslator('en').t('errors.network_error')),
    ).toBeInTheDocument();
    await click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const keys = api
      .to('POST /billing/checkout')
      .map((call) => call.headers.get('Idempotency-Key'));
    expect(keys).toEqual(['k1', 'k1']);
  });

  it('uses the same key again while the server is still creating that checkout', async () => {
    let attempt = 0;
    const { api, navigate, click } = await buyMedium(() => {
      attempt += 1;
      return attempt === 1
        ? json(
            {
              error: {
                code: 'conflict',
                message: 'x',
                details: { reason: 'checkout_in_progress' },
              },
            },
            409,
          )
        : json({ data: pendingOrder() }, 200);
    });
    await click();
    await screen.findByText(createTranslator('en').t('billing.errors.checkoutInProgress'));
    await click();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(
      api.to('POST /billing/checkout').map((call) => call.headers.get('Idempotency-Key')),
    ).toEqual(['k1', 'k1']);
  });

  it('starts over when the browser restores the page from its back-forward cache', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, navigate, click } = await buyMedium(async () => {
      await gate;
      return json({ data: pendingOrder() }, 201);
    });
    await click();
    release?.();
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Opening payment page…' })).toBeInTheDocument();

    const event = new Event('pageshow') as PageTransitionEvent;
    Object.defineProperty(event, 'persisted', { value: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(await screen.findAllByRole('button', { name: 'Buy now' })).toHaveLength(3);
    await click();
    await vi.waitFor(() => expect(api.to('POST /billing/checkout')).toHaveLength(2));
  });
});

describe('a failed purchase is explained at the card that was pressed', () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    scrollIntoView.mockClear();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  });

  const gatewayDown = () =>
    json(
      { error: { code: 'provider_error', message: 'x', details: { reason: 'gateway_error' } } },
      502,
    );

  function mountFailing(handler: () => Response, locale: 'en' | 'ar' = 'en') {
    installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': handler,
    });
    const user = userEvent.setup();
    mountBilling(<PricingView catalog={catalog()} />, { locale });
    return user;
  }

  const packsToggle = () => screen.getByRole('radio', { name: 'One-time packs' });
  /** The alerts with something to say: the toast region is an (empty) alert too. */
  const messages = () => screen.queryAllByRole('alert').filter((node) => node.textContent !== '');

  it('shows the pack error inside the pressed pack card, above its button, and nowhere else', async () => {
    const user = mountFailing(gatewayDown);
    await user.click(packsToggle());
    const large = within(cardNamed('Large pack'));
    await user.click(large.getByRole('button', { name: 'Buy now' }));

    const alert = await large.findByRole('alert');
    expect(alert).toHaveTextContent(createTranslator('en').t('billing.errors.gatewayDown'));
    expect(messages()).toHaveLength(1);
    expect(within(cardNamed('Small pack')).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(cardNamed('Medium pack')).queryByRole('alert')).not.toBeInTheDocument();
    // Directly above the button that was pressed.
    const button = large.getByRole('button', { name: 'Buy now' });
    expect(alert.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('brings the error into view, every time it appears', async () => {
    const user = mountFailing(gatewayDown);
    await user.click(packsToggle());
    const medium = within(cardNamed('Medium pack'));
    await user.click(medium.getByRole('button', { name: 'Buy now' }));
    await medium.findByRole('alert');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(cardNamed('Medium pack').contains(scrollIntoView.mock.contexts[0] as Node)).toBe(true);

    await user.click(medium.getByRole('button', { name: 'Buy now' }));
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(2));
  });

  it('shows a plan error inside the plan card, after the confirmation closed', async () => {
    const user = mountFailing(gatewayDown);
    await user.click(within(cardNamed('Pro')).getByRole('button', { name: 'Subscribe' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Continue to payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await within(cardNamed('Pro')).findByRole('alert')).toHaveTextContent(
      createTranslator('en').t('billing.errors.gatewayDown'),
    );
    expect(within(cardNamed('Starter')).queryByRole('alert')).not.toBeInTheDocument();
    expect(messages()).toHaveLength(1);
  });

  it('can be closed, and the button works again', async () => {
    const user = mountFailing(gatewayDown);
    await user.click(packsToggle());
    const medium = within(cardNamed('Medium pack'));
    await user.click(medium.getByRole('button', { name: 'Buy now' }));
    await user.click(await medium.findByRole('button', { name: 'Dismiss notification' }));
    expect(messages()).toEqual([]);
    expect(medium.getByRole('button', { name: 'Buy now' })).toBeEnabled();
  });

  it('is gone when the buyer switches between plans and packs', async () => {
    const user = mountFailing(gatewayDown);
    await user.click(packsToggle());
    const medium = within(cardNamed('Medium pack'));
    await user.click(medium.getByRole('button', { name: 'Buy now' }));
    await medium.findByRole('alert');
    await user.click(screen.getByRole('radio', { name: 'Monthly plans' }));
    await user.click(packsToggle());
    expect(messages()).toEqual([]);
  });
});

describe('errors of a payment gateway and of the 24-hour limit', () => {
  function mountWith(response: () => Response, locale: 'en' | 'ar') {
    installFakeApi({
      'GET /billing/subscription': () => json({ data: null }),
      'POST /billing/checkout': response,
    });
    mountBilling(<PricingView catalog={catalog()} />, { locale });
  }

  async function buyLarge(locale: 'en' | 'ar') {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('radio', { name: locale === 'ar' ? 'حزم لمرة واحدة' : 'One-time packs' }),
    );
    const card = within(cardNamed(locale === 'ar' ? 'حزمة كبيرة' : 'Large pack'));
    await user.click(
      card.getByRole('button', { name: locale === 'ar' ? 'اشترِ الآن' : 'Buy now' }),
    );
    return (await card.findByRole('alert')).textContent ?? '';
  }

  const limit = (details: unknown) => () =>
    json({ error: { code: 'rate_limited', message: 'x', details } }, 429);

  it.each(['en', 'ar'] as const)(
    'says the payment service is down, and that nothing was charged (%s)',
    async (locale) => {
      mountWith(() => json({ error: { code: 'provider_error', message: 'x' } }, 502), locale);
      const message = plain(await buyLarge(locale));
      expect(message).toBe(createTranslator(locale).t('billing.errors.gatewayDown'));
      expect(message).toMatch(locale === 'en' ? /Nothing was charged/ : /ولم يُخصم أي مبلغ/);
      // Not the studio's "generation service" text.
      expect(message).not.toBe(createTranslator(locale).t('errors.provider_error'));
    },
  );

  it.each(['en', 'ar'] as const)(
    'asks an account whose email is unconfirmed to confirm it first, with a way to its account (%s)',
    async (locale) => {
      mountWith(
        () =>
          json(
            { error: { code: 'email_not_verified', message: 'Confirm your email address' } },
            403,
          ),
        locale,
      );
      const message = plain(await buyLarge(locale));
      expect(message).toContain(createTranslator(locale).t('billing.errors.emailNotVerified'));
      // Not the studio's "to create generations" text, which would be wrong on a purchase.
      expect(message).not.toContain(createTranslator(locale).t('errors.email_not_verified'));
      expect(
        screen.getByRole('link', {
          name: createTranslator(locale).t('billing.errors.openAccount'),
        }),
      ).toHaveAttribute('href', '/account');
    },
  );

  it('tells how long to wait after the 20 checkouts of 24 hours (English)', async () => {
    mountWith(limit({ reason: 'daily_checkout_limit', limit: 20, retryAfterSec: 5 * 3600 }), 'en');
    const message = plain(await buyLarge('en'));
    expect(message).toBe(
      'You have reached the limit of checkouts per 24 hours. Please try again in 5 hours.',
    );
  });

  it('tells how long to wait after the 20 checkouts of 24 hours (Arabic, Arabic-Indic digits)', async () => {
    mountWith(limit({ reason: 'daily_checkout_limit', limit: 20, retryAfterSec: 5 * 3600 }), 'ar');
    const message = plain(await buyLarge('ar'));
    expect(message).toMatch(/^بلغ حسابك الحد الأقصى لعمليات الدفع/);
    expect(message).toMatch(/بعد ٥ ساعات\.$/);
  });

  it('does not invent a wait when the server gave none, and is not the generic "too many requests"', async () => {
    mountWith(limit({ reason: 'daily_checkout_limit' }), 'en');
    const message = plain(await buyLarge('en'));
    expect(message).toBe(createTranslator('en').t('billing.errors.dailyLimitLater'));
    expect(message).not.toBe(createTranslator('en').t('errors.rate_limited'));
  });

  it('keeps the generic text for the per-minute limit, which clears in seconds', async () => {
    mountWith(limit({ retryAfterSec: 20 }), 'en');
    const message = plain(await buyLarge('en'));
    expect(message).toBe(createTranslator('en').t('errors.rate_limited'));
  });
});
