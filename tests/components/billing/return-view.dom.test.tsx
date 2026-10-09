import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReturnView } from '@/components/billing/return-view';
import {
  FAILURES_BEFORE_ERROR,
  LONG_WAIT_MS,
  POLL_DELAYS_MS,
  POLL_EXPIRED_MS,
  pollDelay,
} from '@/components/billing/use-order-status';
import { newId } from '@/lib/id';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  LAYLA,
  mountBilling,
  NOW,
  order,
  pendingOrder,
  resetBillingTest,
  text,
} from './support';

const ID = newId('ord');
const ROUTE = 'GET /billing/orders/' + ID;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(resetBillingTest);

/** Lets timers and the promises they start run, inside `act`. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** An order route that answers with the given orders in turn and then repeats the last one. */
function answers(...replies: Array<() => Response>) {
  let index = 0;
  return () => {
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    return reply?.() ?? json({}, 500);
  };
}

const pending = () => json({ data: pendingOrder({ id: ID }) });
const paid = (overrides = {}) => json({ data: order({ id: ID, ...overrides }) });

function mountReturn(orderId: string | null = ID, locale: 'en' | 'ar' = 'en') {
  return mountBilling(<ReturnView orderId={orderId} />, { locale });
}

describe('the result of a payment', () => {
  it('asks the server about the order straight away and shows a spinner meanwhile', async () => {
    const api = installFakeApi({ [ROUTE]: () => new Promise<Response>(() => undefined) });
    mountReturn();
    expect(screen.getByRole('heading', { name: 'Checking your payment…' })).toBeInTheDocument();
    await tick();
    expect(api.to(ROUTE)).toHaveLength(1);
  });

  it('shows the credits, the item, the VAT-inclusive amount and the new balance once paid', async () => {
    const api = installFakeApi({
      [ROUTE]: () => paid({ itemId: 'pack-1500', amountHalalas: 7_900, credits: 1_500 }),
      'GET /auth/me': () => json({ data: { ...LAYLA, creditBalance: 1_620 } }),
    });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    expect(
      screen.getByText('Thank you! 1,500 credits were added to your balance.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Medium pack')).toBeInTheDocument();
    expect(screen.getByText(text('SAR 79.00'))).toBeInTheDocument();
    // The balance in the user context was re-read, and the new number is shown.
    expect(api.to('GET /auth/me')).toHaveLength(1);
    expect(screen.getByText('1,620 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Start creating/ })).toHaveAttribute('href', '/studio');
    expect(screen.getByRole('link', { name: 'View billing' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
  });

  it('says which plan is active and until when', async () => {
    installFakeApi({
      [ROUTE]: () =>
        paid({
          kind: 'subscription_initial',
          itemId: 'pro',
          credits: 3_000,
          amountHalalas: 13_900,
          periodStart: NOW,
          periodEnd: Date.UTC(2026, 10, 8, 12, 0),
        }),
    });
    mountReturn();
    await tick();
    expect(
      screen.getByText(
        'Thank you! Your Pro plan is active and 3,000 credits were added to your balance.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Your current month runs until November 8, 2026.')).toBeInTheDocument();
  });

  it('says a renewal continues the plan', async () => {
    installFakeApi({
      [ROUTE]: () => paid({ kind: 'subscription_renewal', itemId: 'starter', credits: 1_000 }),
    });
    mountReturn();
    await tick();
    expect(
      screen.getByText(
        'Thank you! Your Starter plan continues and 1,000 credits were added to your balance.',
      ),
    ).toBeInTheDocument();
  });

  it('goes from waiting to paid on its own', async () => {
    const api = installFakeApi({ [ROUTE]: answers(pending, pending, () => paid()) });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'Waiting for your payment' })).toBeInTheDocument();
    expect(screen.getByText(/can take a minute to confirm/)).toBeInTheDocument();
    expect(screen.getByText(/You can safely leave this page/)).toBeInTheDocument();
    expect(api.to('GET /auth/me')).toHaveLength(0);

    await tick(POLL_DELAYS_MS[0]);
    expect(screen.getByRole('heading', { name: 'Waiting for your payment' })).toBeInTheDocument();
    await tick(POLL_DELAYS_MS[1]);
    expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
    expect(api.to(ROUTE)).toHaveLength(3);
    expect(api.to('GET /auth/me')).toHaveLength(1);

    // Final: no more requests.
    await tick(120_000);
    expect(api.to(ROUTE)).toHaveLength(3);
  });

  it('keeps the clock of the last check out of the live region, so a screen reader is not interrupted on every check', async () => {
    installFakeApi({ [ROUTE]: pending });
    mountReturn();
    await tick();
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live).toContainElement(
      screen.getByRole('heading', { name: 'Waiting for your payment' }),
    );
    expect(live).toHaveTextContent(/can take a minute to confirm/);
    const clock = screen.getByText(/^Last checked at /);
    expect(live).not.toContainElement(clock);
    expect(live.closest('[aria-live]')).toBe(live);
    expect(clock.closest('[aria-live]')).toBeNull();

    const before = clock.textContent;
    const changes = new MutationObserver(() => undefined);
    changes.observe(live, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    await tick(POLL_DELAYS_MS[0]);
    await tick(POLL_DELAYS_MS[1]);
    // The clock moved on with every check; the live region stayed untouched.
    expect(screen.getByText(/^Last checked at /).textContent).not.toBe(before);
    expect(changes.takeRecords()).toEqual([]);
    changes.disconnect();
  });

  it('checks again on request without waiting for the timer', async () => {
    const api = installFakeApi({ [ROUTE]: answers(pending, () => paid()) });
    mountReturn();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await tick();
    expect(api.to(ROUTE)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
  });

  it('offers the payment page again while the order can still be paid', async () => {
    installFakeApi({ [ROUTE]: pending });
    mountReturn();
    await tick();
    expect(screen.getByRole('link', { name: 'Go to the payment page' })).toHaveAttribute(
      'href',
      'https://pay.example.com/invoices/inv_1',
    );
  });

  it('never offers an unsafe payment address', async () => {
    installFakeApi({
      [ROUTE]: () => json({ data: pendingOrder({ id: ID, checkoutUrl: 'javascript:alert(1)' }) }),
    });
    mountReturn();
    await tick();
    expect(screen.queryByRole('link', { name: 'Go to the payment page' })).not.toBeInTheDocument();
  });

  it('shows a failed payment with a way to try again, and stops asking', async () => {
    const api = installFakeApi({ [ROUTE]: () => paid({ status: 'failed', paidAt: undefined }) });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/pricing');
    expect(screen.queryByText(/Thank you/)).not.toBeInTheDocument();
    await tick(120_000);
    expect(api.to(ROUTE)).toHaveLength(1);
    expect(api.to('GET /auth/me')).toHaveLength(0);
  });

  it('shows a closed checkout, a refund and a payment under review', async () => {
    for (const [status, heading] of [
      ['canceled', 'Checkout closed'],
      ['refunded', 'Payment refunded'],
      ['needs_review', 'We are reviewing this payment'],
    ] as const) {
      installFakeApi({ [ROUTE]: () => paid({ status }) });
      const view = mountReturn();
      await tick();
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
      expect(screen.queryByText('Payment received')).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('explains an expired checkout instead of waiting for ever', async () => {
    installFakeApi({
      [ROUTE]: () => json({ data: pendingOrder({ id: ID, expiresAt: NOW - 1_000 }) }),
    });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'This checkout expired' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/pricing');
  });

  it('sends the payer of a failed, closed or expired RENEWAL to Billing, not to the price list', async () => {
    // The plan is still running (or overdue), so the price list cannot sell it again; the
    // replacement payment link is in Billing.
    const renewal = { kind: 'subscription_renewal', itemId: 'pro', credits: 3_000 } as const;
    const replies = [
      paid({ ...renewal, status: 'failed', paidAt: undefined }),
      paid({ ...renewal, status: 'canceled', paidAt: undefined }),
      json({ data: pendingOrder({ id: ID, ...renewal, expiresAt: NOW - 1_000 }) }),
    ];
    for (const reply of replies) {
      installFakeApi({ [ROUTE]: () => reply.clone() });
      const view = mountReturn();
      await tick();
      expect(screen.queryByRole('link', { name: 'Try again' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'View billing' })).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'View billing' })).toHaveAttribute(
        'href',
        '/account/billing',
      );
      view.unmount();
    }
  });

  it('shows an unknown or foreign order (404) as not found, without polling', async () => {
    const api = installFakeApi({ [ROUTE]: () => apiError(404, 'not_found') });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Billing' })).toHaveAttribute(
      'href',
      '/account/billing',
    );
    await tick(120_000);
    expect(api.to(ROUTE)).toHaveLength(1);
  });

  it('does not even ask for something that is not an order id', async () => {
    const api = installFakeApi();
    mountReturn('ord_nope');
    expect(screen.getByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
    mountReturn('../../account');
    await tick(10_000);
    expect(api.calls.filter((call) => call.path.startsWith('/billing'))).toEqual([]);
  });

  it('says there is nothing to show when the address names no order', async () => {
    const api = installFakeApi();
    mountReturn(null);
    expect(screen.getByRole('heading', { name: 'No order to show' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '/pricing');
    await tick(10_000);
    expect(api.calls).toEqual([]);
  });

  it('asks an expired session to log in again and return to this very order', async () => {
    const api = installFakeApi({ [ROUTE]: () => apiError(401, 'unauthorized') });
    mountReturn();
    await tick();
    expect(
      screen.getByText('Your session has ended. Log in again to continue.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      `/login?next=${encodeURIComponent('/billing/return?order=' + ID)}`,
    );
    await tick(60_000);
    expect(api.to(ROUTE)).toHaveLength(1);
  });

  it("trusts only the server: the credits shown are the order's, whatever else the address says", async () => {
    window.history.replaceState(null, '', `/billing/return?order=${ID}&status=paid&credits=999999`);
    installFakeApi({ [ROUTE]: pending });
    mountReturn();
    await tick();
    expect(screen.getByRole('heading', { name: 'Waiting for your payment' })).toBeInTheDocument();
    expect(screen.queryByText(/999/)).not.toBeInTheDocument();
  });
});

describe('polling', () => {
  it('slows down: 2 s, 3 s, 4.5 s, 6.5 s, then every 10 s', async () => {
    const api = installFakeApi({ [ROUTE]: pending });
    mountReturn();
    await tick();
    const times: number[] = [];
    const seen = () => api.to(ROUTE).length;
    let elapsed = 0;
    let last = seen();
    for (let step = 0; step < 6 * 1000 * 10; step += 100) {
      await tick(100);
      elapsed += 100;
      if (seen() !== last) {
        times.push(elapsed);
        last = seen();
      }
      if (times.length === 6) break;
    }
    expect(times).toEqual([2_000, 5_000, 9_500, 16_000, 26_000, 36_000]);
  });

  it('waits long between checks once the checkout page has expired', () => {
    expect(pollDelay(0, { expiresAt: NOW - 1 }, NOW)).toBe(POLL_EXPIRED_MS);
    expect(pollDelay(0, { expiresAt: NOW + 1_000 }, NOW)).toBe(POLL_DELAYS_MS[0]);
    expect(pollDelay(99, {}, NOW)).toBe(POLL_DELAYS_MS[POLL_DELAYS_MS.length - 1]);
  });

  it('keeps showing the last known order, and says it is retrying, when a check fails', async () => {
    installFakeApi({
      [ROUTE]: answers(
        pending,
        () => apiError(500, 'internal'),
        () => paid(),
      ),
    });
    mountReturn();
    await tick();
    await tick(POLL_DELAYS_MS[0]);
    expect(screen.getByRole('heading', { name: 'Waiting for your payment' })).toBeInTheDocument();
    expect(
      screen.getByText('We could not reach the server just now and will keep trying.'),
    ).toBeInTheDocument();
    await tick(POLL_DELAYS_MS[1]);
    expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
  });

  it('gives up with an error, and a way to retry, after repeated failures with nothing to show', async () => {
    installFakeApi({
      [ROUTE]: answers(...Array(FAILURES_BEFORE_ERROR).fill(() => apiError(500, 'internal')), () =>
        paid(),
      ),
    });
    mountReturn();
    // Failures at 0 s, 3 s and 7.5 s: the third one is the last straw.
    await tick(7_500);
    expect(
      screen.getByRole('heading', { name: 'We could not check your payment' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await tick();
    expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
  });

  it('says it is taking longer than usual after a minute and a half, once', async () => {
    installFakeApi({ [ROUTE]: pending });
    mountReturn();
    await tick();
    expect(screen.queryByText(/taking longer than usual/)).not.toBeInTheDocument();
    await tick(LONG_WAIT_MS + 30_000);
    expect(screen.getAllByText(/taking longer than usual/)).toHaveLength(1);
  });

  it('pauses while the tab is hidden and checks the moment it is shown again', async () => {
    const api = installFakeApi({ [ROUTE]: pending });
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    mountReturn();
    await tick();
    expect(api.to(ROUTE)).toHaveLength(1);

    visibility = 'hidden';
    await tick(60_000);
    expect(api.to(ROUTE)).toHaveLength(1);

    visibility = 'visible';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await tick();
    expect(api.to(ROUTE)).toHaveLength(2);
  });

  it('stops asking when the page is left', async () => {
    const api = installFakeApi({ [ROUTE]: pending });
    const view = mountReturn();
    await tick();
    view.unmount();
    await tick(120_000);
    expect(api.to(ROUTE)).toHaveLength(1);
    expect(api.to(ROUTE)[0]?.signal?.aborted).toBe(true);
  });
});

describe('Arabic', () => {
  it('shows the success state in Arabic with Arabic-Indic digits and a mirrored arrow', async () => {
    installFakeApi({ [ROUTE]: () => paid({ itemId: 'pack-1500' }) });
    mountReturn(ID, 'ar');
    await tick();
    expect(screen.getByRole('heading', { name: 'تم استلام دفعتك' })).toBeInTheDocument();
    expect(screen.getByText(/أُضيف ١[٬,]٥٠٠ رصيد إلى رصيدك/)).toBeInTheDocument();
    expect(screen.getByText('حزمة متوسطة')).toBeInTheDocument();
    expect(screen.getByText(text('٧٩٫٠٠ ر.س.'))).toBeInTheDocument();
  });

  it('has no accessibility violations while waiting and once paid', async () => {
    // axe needs real timers; the first answer arrives without any timer. With real timers the page
    // reads the real clock, so the pending checkout must expire in the future of THAT clock: the
    // shared fixture is dated by the fixed NOW and would read as expired once that day has passed.
    vi.useRealTimers();
    const pendingNow = () =>
      json({ data: pendingOrder({ id: ID, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }) });
    installFakeApi({ [ROUTE]: answers(pendingNow, () => paid()) });
    const view = mountReturn();
    await screen.findByRole('heading', { name: 'Waiting for your payment' });
    expect(await axeViolations(view.container)).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await screen.findByRole('heading', { name: 'Payment received' });
    expect(await axeViolations(view.container)).toEqual([]);
  });
});
