import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { BillingView } from '@/components/billing/billing-view';
import { creditsCell } from '@/components/billing/orders-card';
import { DAY_MS, RENEWAL_GRACE_MS } from '@/lib/billing/period';
import { createTranslator } from '@/lib/i18n';
import { formatDate } from '@/lib/utils';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  mountBilling,
  NOW,
  order,
  pageOf,
  pendingOrder,
  resetBillingTest,
  subscription,
  text,
  type FakeApi,
  type Handler,
} from './support';

afterEach(resetBillingTest);

const PERIOD_END = NOW + 20 * DAY_MS;
const longDate = (ms: number, locale: 'en' | 'ar' = 'en') => formatDate(ms, locale, 'long');

interface Setup {
  subscription?: Handler;
  orders?: Handler;
  cancel?: Handler;
  resume?: Handler;
}

function setup({ subscription: sub, orders, cancel, resume }: Setup = {}): FakeApi {
  return installFakeApi({
    'GET /billing/subscription': sub ?? (() => json({ data: null })),
    'GET /billing/orders': orders ?? (() => json(pageOf([]))),
    ...(cancel ? { 'POST /billing/subscription/cancel': cancel } : {}),
    ...(resume ? { 'POST /billing/subscription/resume': resume } : {}),
  });
}

const withPlan = (value: ReturnType<typeof subscription> | null) => () => json({ data: value });

function mountPage(locale: 'en' | 'ar' = 'en', gateway: 'moyasar' | 'mock' | 'off' = 'moyasar') {
  return mountBilling(<BillingView gateway={gateway} />, { locale });
}

async function planCard() {
  const heading = await screen.findByRole('heading', { name: 'Your plan' });
  const card = heading.closest('div.rounded-2xl') as HTMLElement | null;
  if (!card) throw new Error('plan card not found');
  return within(card);
}

describe('the page', () => {
  it('shows the balance, the plan card, the payments and the legal links', async () => {
    setup({ subscription: withPlan(subscription()), orders: () => json(pageOf([order()])) });
    mountPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Billing & plans' })).toBeInTheDocument();
    expect(screen.getByText('120 credits')).toBeInTheDocument();
    expect(screen.getByText('Credits never expire.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Buy credits' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(await screen.findByRole('heading', { name: 'Your plan' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Payments' })).toBeInTheDocument();
    const legal = screen.getByRole('navigation', { name: 'Legal' });
    expect(within(legal).getByText('Prices include VAT.')).toBeInTheDocument();
    expect(within(legal).getByRole('link', { name: 'Refund Policy' })).toHaveAttribute(
      'href',
      '/refunds',
    );
    expect(within(legal).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });

  it('reads the balance again, because the header copy may be a minute old', async () => {
    const api = setup();
    api.on('GET /auth/me', () =>
      json({
        data: {
          id: 'usr_1',
          email: 'l@example.com',
          name: 'L',
          role: 'user',
          locale: 'en',
          creditBalance: 777,
        },
      }),
    );
    mountPage();
    expect(await screen.findByText('777 credits')).toBeInTheDocument();
  });

  it('announces the test gateway only when it is the fake one', async () => {
    setup();
    const mock = mountPage('en', 'mock');
    expect(screen.getByText('Test payments')).toBeInTheDocument();
    mock.unmount();
    mountPage('en', 'moyasar');
    expect(screen.queryByText('Test payments')).not.toBeInTheDocument();
  });

  it('is accessible in both languages, with a plan and payments on screen', async () => {
    setup({
      subscription: withPlan(subscription()),
      orders: () => json(pageOf([order(), pendingOrder({ id: 'ord_0123456789abcdefghjkmnpqrs' })])),
    });
    const en = mountPage();
    await screen.findByRole('table');
    expect(await axeViolations(en.container)).toEqual([]);
    en.unmount();
    const ar = mountPage('ar');
    await screen.findByRole('table');
    expect(await axeViolations(ar.container)).toEqual([]);
  });
});

describe('the plan card', () => {
  it('invites to subscribe when there is no plan', async () => {
    setup({ subscription: withPlan(null) });
    mountPage();
    expect(await screen.findByText('No plan yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See plans and packs' })).toHaveAttribute(
      'href',
      '/pricing',
    );
    expect(screen.queryByRole('button', { name: 'Cancel plan' })).not.toBeInTheDocument();
  });

  it('shows a running plan: status, credits per cycle, price, renewal date and next payment', async () => {
    setup({ subscription: withPlan(subscription({ planId: 'pro' })) });
    mountPage();
    const card = await planCard();
    await card.findByText('Active');
    expect(card.getByText('Pro')).toBeInTheDocument();
    expect(card.getByText('3,000 credits per month')).toBeInTheDocument();
    expect(card.getByText(text('SAR 139.00 per month, VAT included'))).toBeInTheDocument();
    expect(card.getByText('Renews on')).toBeInTheDocument();
    expect(card.getByText(longDate(PERIOD_END))).toBeInTheDocument();
    expect(card.getByText(text(`SAR 139.00, due by ${longDate(PERIOD_END)}`))).toBeInTheDocument();
    expect(
      card.getByText(/Renewal is by payment link, not by charging your card/),
    ).toBeInTheDocument();
    // Nobody is emailed: the card says so, instead of letting the buyer expect a reminder.
    expect(card.getByText(/We do not send reminders, so check this page\./)).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/pricing');
    expect(card.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    expect(card.queryByRole('button', { name: 'Resume plan' })).not.toBeInTheDocument();
  });

  it('shows the renewal payment link when it has been issued', async () => {
    setup({
      subscription: withPlan(
        subscription({
          pendingOrder: pendingOrder({ kind: 'subscription_renewal', itemId: 'pro' }),
        }),
      ),
    });
    mountPage();
    const card = await planCard();
    expect(await card.findByText('Your renewal payment is ready')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Pay now' })).toHaveAttribute(
      'href',
      'https://pay.example.com/invoices/inv_1',
    );
  });

  describe('cancel and resume', () => {
    it('asks first, and "Keep plan" sends nothing', async () => {
      const api = setup({ subscription: withPlan(subscription()) });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Cancel your plan?' });
      expect(dialog).toHaveTextContent(
        `Your plan stays active until ${longDate(PERIOD_END)}, then ends. You will not be asked to pay again, and credits already in your balance never expire. You can undo this until ${longDate(PERIOD_END)}.`,
      );
      await user.click(within(dialog).getByRole('button', { name: 'Keep plan' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(api.to('POST /billing/subscription/cancel')).toEqual([]);
    });

    it("cancels at the end of the month once, however often the button is pressed, and shows the server's answer", async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const api = setup({
        subscription: withPlan(subscription()),
        cancel: async () => {
          await gate;
          return json({ data: subscription({ cancelAtPeriodEnd: true }) });
        },
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog');
      const confirm = within(dialog).getByRole('button', { name: 'Cancel plan' });
      await user.dblClick(confirm);
      await user.click(confirm);
      expect(api.to('POST /billing/subscription/cancel')).toHaveLength(1);
      expect(within(dialog).getByRole('button', { name: 'Keep plan' })).toBeDisabled();

      release?.();
      const card = await planCard();
      expect(await card.findByText('Canceling')).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(card.getByText('Ends on')).toBeInTheDocument();
      expect(card.getByRole('button', { name: 'Resume plan' })).toBeInTheDocument();
      expect(card.queryByRole('button', { name: 'Cancel plan' })).not.toBeInTheDocument();
      expect(
        card.getByText(/Your plan ends on .* You can undo the cancellation until then\./),
      ).toBeInTheDocument();
      expect(
        await screen.findByText(`Your plan will end on ${formatDate(PERIOD_END, 'en', 'long')}.`),
      ).toBeInTheDocument();
      // The payments list is read again: a renewal link may have been withdrawn.
      await waitFor(() => expect(api.to('GET /billing/orders')).toHaveLength(2));
    });

    it('resumes a plan that was set to end', async () => {
      const api = setup({
        subscription: withPlan(subscription({ cancelAtPeriodEnd: true })),
        resume: () => json({ data: subscription({ cancelAtPeriodEnd: false }) }),
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Resume plan' }));
      const card = await planCard();
      expect(await card.findByText('Active')).toBeInTheDocument();
      expect(api.to('POST /billing/subscription/resume')).toHaveLength(1);
      expect(await screen.findByText('Your plan will continue.')).toBeInTheDocument();
      expect(card.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
    });

    it('keeps the dialog open and says what went wrong when cancelling fails', async () => {
      setup({
        subscription: withPlan(subscription()),
        cancel: () => apiError(500, 'internal'),
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel plan' }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        createTranslator('en').t('errors.internal'),
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      // Still the same plan, and the button works again.
      expect(within(dialog).getByRole('button', { name: 'Cancel plan' })).toBeEnabled();
    });

    it('describes the consequence to assistive technology: the dialog is described by its text', async () => {
      setup({ subscription: withPlan(subscription()) });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Cancel your plan?' });
      const describedBy = dialog.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      expect(document.getElementById(describedBy as string)).toHaveTextContent(
        `Your plan stays active until ${longDate(PERIOD_END)}, then ends.`,
      );
      expect(dialog).toHaveAccessibleDescription(
        new RegExp(`Your plan stays active until ${longDate(PERIOD_END)}`),
      );
    });

    it.each([
      ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
      [
        'the close button',
        (user: ReturnType<typeof userEvent.setup>) =>
          user.click(screen.getByRole('button', { name: 'Close' })),
      ],
    ] as const)(
      'treats %s as "Keep plan": the dialog closes and nothing is sent',
      async (_, close) => {
        const api = setup({ subscription: withPlan(subscription()) });
        const user = userEvent.setup();
        mountPage();
        await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
        await screen.findByRole('alertdialog');
        await close(user);
        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        expect(api.to('POST /billing/subscription/cancel')).toEqual([]);
        expect(screen.getByRole('button', { name: 'Cancel plan' })).toBeInTheDocument();
      },
    );

    it('ignores Escape while the cancellation is being sent', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const api = setup({
        subscription: withPlan(subscription()),
        cancel: async () => {
          await gate;
          return json({ data: subscription({ cancelAtPeriodEnd: true }) });
        },
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel plan' }));
      await user.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      release?.();
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(api.to('POST /billing/subscription/cancel')).toHaveLength(1);
    });

    it('reports a failed cancellation once, in the dialog, and not again in the card behind it', async () => {
      setup({
        subscription: withPlan(subscription()),
        cancel: () => apiError(500, 'internal'),
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      const dialog = await screen.findByRole('alertdialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel plan' }));
      await within(dialog).findByRole('alert');
      const failure = createTranslator('en').t('errors.internal');
      expect(screen.getAllByText(failure)).toHaveLength(1);

      // Keeping the plan closes the dialog and the old failure does not linger in the card.
      await user.click(within(dialog).getByRole('button', { name: 'Keep plan' }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.queryByText(failure)).not.toBeInTheDocument();
    });

    it('says a plan that has already ended cannot be resumed', async () => {
      setup({
        subscription: withPlan(subscription({ cancelAtPeriodEnd: true })),
        resume: () =>
          json(
            {
              error: { code: 'conflict', message: 'x', details: { reason: 'subscription_ended' } },
            },
            409,
          ),
      });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Resume plan' }));
      const card = await planCard();
      expect(
        await card.findByText(
          'This plan has already ended. Subscribe again from the pricing page.',
        ),
      ).toBeInTheDocument();
      expect(card.getByText('Canceling')).toBeInTheDocument();
    });
  });

  describe('a renewal that is overdue', () => {
    const overdue = (extra: Parameters<typeof subscription>[0] = {}) =>
      subscription({
        status: 'past_due',
        currentPeriodEnd: NOW - DAY_MS,
        pendingOrder: pendingOrder({ kind: 'subscription_renewal', itemId: 'pro' }),
        ...extra,
      });

    it('shows a banner with a pay-now link and the last day it can be paid', async () => {
      setup({ subscription: withPlan(overdue()) });
      mountPage();
      const card = await planCard();
      expect(await card.findByText('Payment due')).toBeInTheDocument();
      expect(card.getByText('Your renewal payment is due')).toBeInTheDocument();
      const graceEnd = NOW - DAY_MS + RENEWAL_GRACE_MS;
      expect(card.getByText(new RegExp(`Pay before ${longDate(graceEnd)}`))).toBeInTheDocument();
      expect(card.getByRole('link', { name: 'Pay now' })).toHaveAttribute(
        'href',
        'https://pay.example.com/invoices/inv_1',
      );
      expect(card.getByText(text(`SAR 139.00, due by ${longDate(graceEnd)}`))).toBeInTheDocument();
      // The month is over: it no longer "renews on" a date in the past.
      expect(card.getByText('This month ended on')).toBeInTheDocument();
      expect(card.queryByText('Renews on')).not.toBeInTheDocument();
    });

    it('does not invent a link when the gateway has issued none', async () => {
      setup({ subscription: withPlan(overdue({ pendingOrder: undefined })) });
      mountPage();
      const card = await planCard();
      expect(await card.findByText('Your renewal payment is due')).toBeInTheDocument();
      expect(card.queryByRole('link', { name: 'Pay now' })).not.toBeInTheDocument();
      expect(card.getByText(/The payment link is not available at the moment/)).toBeInTheDocument();
    });

    it('never links to an unsafe payment address', async () => {
      setup({
        subscription: withPlan(
          overdue({
            pendingOrder: pendingOrder({ checkoutUrl: 'http://evil.example/pay' }),
          }),
        ),
      });
      mountPage();
      const card = await planCard();
      await card.findByText('Your renewal payment is due');
      expect(card.queryByRole('link', { name: 'Pay now' })).not.toBeInTheDocument();
    });

    it('warns in the cancel dialog that an overdue plan ends at once', async () => {
      setup({ subscription: withPlan(overdue()) });
      const user = userEvent.setup();
      mountPage();
      await user.click(await screen.findByRole('button', { name: 'Cancel plan' }));
      expect(await screen.findByRole('alertdialog')).toHaveTextContent(
        'Your payment is overdue, so the plan ends right away.',
      );
    });
  });

  describe('plans that are not running', () => {
    it.each([
      ['canceled', 'Canceled'],
      ['expired', 'Expired'],
    ] as const)(
      'shows a %s plan as ended, with a way to subscribe again',
      async (status, badge) => {
        setup({ subscription: withPlan(subscription({ status, cancelAtPeriodEnd: false })) });
        mountPage();
        const card = await planCard();
        expect(await card.findByText(badge)).toBeInTheDocument();
        expect(card.getByText('Ended on')).toBeInTheDocument();
        expect(
          card.getByText('This plan has ended. Credits already in your balance never expire.'),
        ).toBeInTheDocument();
        expect(card.getByRole('link', { name: 'Subscribe again' })).toHaveAttribute(
          'href',
          '/pricing',
        );
        expect(card.queryByRole('button', { name: 'Cancel plan' })).not.toBeInTheDocument();
        expect(card.queryByRole('button', { name: 'Resume plan' })).not.toBeInTheDocument();
      },
    );

    it('shows a plan that waits for its first payment, and lets it be paid or abandoned', async () => {
      setup({
        subscription: withPlan(
          subscription({
            status: 'incomplete',
            currentPeriodStart: undefined,
            currentPeriodEnd: undefined,
            pendingOrder: pendingOrder({ kind: 'subscription_initial', itemId: 'pro' }),
          }),
        ),
      });
      const user = userEvent.setup();
      mountPage();
      const card = await planCard();
      expect(await card.findByText('Awaiting payment')).toBeInTheDocument();
      expect(card.getByRole('link', { name: 'Complete payment' })).toHaveAttribute(
        'href',
        'https://pay.example.com/invoices/inv_1',
      );
      expect(card.queryByText('Renews on')).not.toBeInTheDocument();
      await user.click(card.getByRole('button', { name: 'Cancel plan' }));
      expect(await screen.findByRole('alertdialog')).toHaveTextContent(
        'The first payment has not been made. Canceling closes the payment page.',
      );
    });
  });

  it('shows an error with a retry when the plan cannot be loaded', async () => {
    let attempt = 0;
    const api = setup({
      subscription: () => {
        attempt += 1;
        return attempt === 1 ? apiError(500, 'internal') : json({ data: subscription() });
      },
    });
    const user = userEvent.setup();
    mountPage();
    expect(await screen.findByText('We could not load your billing details.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(api.to('GET /billing/subscription')).toHaveLength(2);
  });

  it('shows the plan in Arabic with Arabic-Indic digits and Arabic dates', async () => {
    setup({ subscription: withPlan(subscription({ planId: 'pro' })) });
    mountPage('ar');
    const heading = await screen.findByRole('heading', { name: 'باقتك' });
    const card = within(heading.closest('div.rounded-2xl') as HTMLElement);
    expect(await card.findByText('فعّالة')).toBeInTheDocument();
    expect(card.getByText('المحترف')).toBeInTheDocument();
    expect(card.getByText(/٣[٬,]٠٠٠ رصيد شهريًا/)).toBeInTheDocument();
    expect(card.getByText(text('١٣٩٫٠٠ ر.س. شهريًا شامل الضريبة'))).toBeInTheDocument();
    expect(card.getByText(longDate(PERIOD_END, 'ar'))).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'إلغاء الباقة' })).toBeInTheDocument();
  });
});

describe('the payments list', () => {
  const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

  it('lists date, item, amount with VAT, status and credits', async () => {
    const paidPack = order({ id: 'ord_0123456789abcdefghjkmnpqrs' });
    const renewal = order({
      id: 'ord_0123456789abcdefghjkmnpqrt',
      kind: 'subscription_renewal',
      itemId: 'pro',
      amountHalalas: 13_900,
      credits: 3_000,
      periodStart: NOW,
      periodEnd: NOW + 30 * DAY_MS,
      createdAt: NOW - 2 * DAY_MS,
    });
    setup({ orders: () => json(pageOf([renewal, paidPack])) });
    mountPage();
    await screen.findByRole('table');
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByText('Everything you bought. Amounts include VAT.')).toBeInTheDocument();
    const [first, second] = rows();
    expect(within(first as HTMLElement).getByText('Pro plan, renewal')).toBeInTheDocument();
    expect(
      within(first as HTMLElement).getByText(
        `${formatDate(NOW, 'en')} to ${formatDate(NOW + 30 * DAY_MS, 'en')}`,
      ),
    ).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText(text('SAR 139.00'))).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('+3,000')).toBeInTheDocument();
    expect(within(first as HTMLElement).getByText('Paid')).toBeInTheDocument();
    expect(within(second as HTMLElement).getByText('Medium pack')).toBeInTheDocument();
    expect(within(second as HTMLElement).getByText(text('SAR 79.00'))).toBeInTheDocument();
    expect(within(second as HTMLElement).getByText('+1,500')).toBeInTheDocument();
    expect(screen.getByText('That is everything.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows every status, and credits only where they really arrived', async () => {
    const make = (n: number, overrides: Parameters<typeof order>[0]) =>
      order({ id: `ord_0123456789abcdefghjkmnpq${n}x`.slice(0, 30), ...overrides });
    const list = [
      make(1, { status: 'paid' }),
      make(2, { status: 'pending', paidAt: undefined, checkoutUrl: undefined }),
      make(3, { status: 'failed', paidAt: undefined }),
      make(4, { status: 'canceled', paidAt: undefined }),
      make(5, { status: 'refunded', refundedHalalas: 7_900 }),
      make(6, { status: 'needs_review' }),
    ];
    setup({ orders: () => json(pageOf(list)) });
    mountPage();
    await screen.findByRole('table');
    const labels = ['Paid', 'Awaiting payment', 'Failed', 'Canceled', 'Refunded', 'Under review'];
    rows().forEach((row, index) => {
      expect(within(row).getByText(labels[index] as string)).toBeInTheDocument();
    });
    const [, pending, failed, canceled, refunded] = rows() as HTMLElement[];
    expect(within(pending as HTMLElement).getByText('1,500')).toBeInTheDocument();
    expect(within(pending as HTMLElement).queryByText('+1,500')).not.toBeInTheDocument();
    for (const row of [failed, canceled]) {
      expect(within(row as HTMLElement).getByText('No credits')).toBeInTheDocument();
      expect(within(row as HTMLElement).queryByText(/1,500/)).not.toBeInTheDocument();
    }
    expect(
      within(refunded as HTMLElement).getByText(text('Refunded SAR 79.00')),
    ).toBeInTheDocument();
  });

  it('decides what the credits column shows from what the server says was granted', () => {
    expect(creditsCell(order({ status: 'paid' }))).toEqual({ kind: 'granted', value: 1_500 });
    expect(creditsCell(order({ status: 'refunded', refundedHalalas: 7_900 }))).toEqual({
      kind: 'none',
      value: 0,
    });
    expect(creditsCell(pendingOrder())).toEqual({ kind: 'pending', value: 1_500 });
    expect(creditsCell(order({ status: 'failed', paidAt: undefined })).kind).toBe('none');
    expect(creditsCell(order({ status: 'refunded', paidAt: undefined })).kind).toBe('none');
  });

  it('takes the refunded share of the credits off a partially refunded order, rounded down as the server does', () => {
    // SAR 19.75 of 79.00 is a quarter: 375 of 1,500 credits are taken back.
    expect(creditsCell(order({ status: 'paid', refundedHalalas: 1_975 }))).toEqual({
      kind: 'granted',
      value: 1_125,
    });
    // A tiny refund takes back no whole credit.
    expect(creditsCell(order({ status: 'paid', refundedHalalas: 1 }))).toEqual({
      kind: 'granted',
      value: 1_500,
    });
    expect(creditsCell(order({ status: 'paid', refundedHalalas: 3_950 })).value).toBe(750);
  });

  it('shows a fully refunded order without credits, so the column adds up to the balance', async () => {
    const refunded = order({
      id: 'ord_0123456789abcdefghjkmnpqr9',
      status: 'refunded',
      refundedHalalas: 7_900,
    });
    const partly = order({
      id: 'ord_0123456789abcdefghjkmnpqr8',
      status: 'paid',
      refundedHalalas: 1_975,
    });
    setup({ orders: () => json(pageOf([refunded, partly])) });
    mountPage();
    await screen.findByRole('table');
    const [full, part] = rows() as HTMLElement[];
    expect(within(full as HTMLElement).getByText('Refunded')).toBeInTheDocument();
    expect(within(full as HTMLElement).getByText('No credits')).toBeInTheDocument();
    expect(within(full as HTMLElement).queryByText('+1,500')).not.toBeInTheDocument();
    expect(within(part as HTMLElement).getByText('+1,125')).toBeInTheDocument();
    expect(within(part as HTMLElement).getByText(text('Refunded SAR 19.75'))).toBeInTheDocument();
  });

  it('offers to pay an open checkout, and only through a safe address', async () => {
    const open = pendingOrder({ id: 'ord_0123456789abcdefghjkmnpqrs' });
    const unsafe = pendingOrder({
      id: 'ord_0123456789abcdefghjkmnpqrt',
      checkoutUrl: 'javascript:alert(1)',
    });
    setup({ orders: () => json(pageOf([open, unsafe])) });
    mountPage();
    await screen.findByRole('table');
    const [first, second] = rows() as HTMLElement[];
    expect(within(first as HTMLElement).getByRole('link', { name: 'Pay' })).toHaveAttribute(
      'href',
      'https://pay.example.com/invoices/inv_1',
    );
    expect(
      within(second as HTMLElement).queryByRole('link', { name: 'Pay' }),
    ).not.toBeInTheDocument();
    expect(within(second as HTMLElement).getByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      `/billing/return?order=${unsafe.id}`,
    );
  });

  it('loads older payments with the cursor and keeps what is shown', async () => {
    const first = order({ id: 'ord_0123456789abcdefghjkmnpqr1', itemId: 'pack-500', credits: 500 });
    const second = order({
      id: 'ord_0123456789abcdefghjkmnpqr2',
      itemId: 'pack-5000',
      credits: 5_000,
    });
    const api = setup({
      orders: (call) =>
        call.query.get('cursor') === 'c1'
          ? json(pageOf([second], null))
          : json(pageOf([first], 'c1')),
    });
    const user = userEvent.setup();
    mountPage();
    await screen.findByRole('table');
    expect(rows()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.to('GET /billing/orders').map((call) => call.query.get('cursor'))).toEqual([
      null,
      'c1',
    ]);
    expect(within(rows()[1] as HTMLElement).getByText('Large pack')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText('That is everything.')).toBeInTheDocument();
  });

  it('does not show an order twice when a page overlaps', async () => {
    const one = order({ id: 'ord_0123456789abcdefghjkmnpqr1' });
    setup({
      orders: (call) =>
        call.query.get('cursor') === 'c1' ? json(pageOf([one], null)) : json(pageOf([one], 'c1')),
    });
    const user = userEvent.setup();
    mountPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument(),
    );
    expect(rows()).toHaveLength(1);
  });

  it('keeps the rows and offers another try when the next page fails', async () => {
    let fail = true;
    setup({
      orders: (call) => {
        if (call.query.get('cursor') !== 'c1') return json(pageOf([order()], 'c1'));
        return fail ? apiError(500, 'internal') : json(pageOf([], null));
      },
    });
    const user = userEvent.setup();
    mountPage();
    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('We could not load your payments.')).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(screen.getByText('That is everything.')).toBeInTheDocument());
    expect(screen.queryByText('We could not load your payments.')).not.toBeInTheDocument();
  });

  it('shows an empty state with a way to the pricing page', async () => {
    setup({ orders: () => json(pageOf([])) });
    mountPage();
    expect(await screen.findByText('No payments yet')).toBeInTheDocument();
    const link = screen.getAllByRole('link', { name: 'See pricing' }).at(-1);
    expect(link).toHaveAttribute('href', '/pricing');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error with a retry when the first page fails', async () => {
    let attempt = 0;
    setup({
      orders: () => {
        attempt += 1;
        return attempt === 1 ? apiError(500, 'internal') : json(pageOf([order()]));
      },
    });
    const user = userEvent.setup();
    mountPage();
    expect(await screen.findByText('We could not load your payments.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Try again' }).at(-1) as HTMLElement);
    });
    expect(await screen.findByRole('table')).toBeInTheDocument();
    void user;
  });

  it('shows payments in Arabic with Arabic-Indic digits and riyals', async () => {
    setup({ orders: () => json(pageOf([order()])) });
    mountPage('ar');
    await screen.findByRole('table');
    const [row] = rows() as HTMLElement[];
    expect(within(row as HTMLElement).getByText('حزمة متوسطة')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(text('٧٩٫٠٠ ر.س.'))).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('مدفوع')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(/١[٬,]٥٠٠/)).toBeInTheDocument();
  });
});
