import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingView } from '@/components/billing/pricing-view';
import type { CurrentUser } from '@/lib/user-context';
import { axeViolations } from '../axe';
import {
  LAYLA,
  apiError,
  catalog,
  installFakeApi,
  json,
  mountBilling,
  resetBillingTest,
} from './support';

afterEach(resetBillingTest);

/**
 * An account on a server that wants its address confirmed. The server reports a pending bonus (as
 * a development setup that pays password accounts would), and the page still promises none.
 */
const UNCONFIRMED: CurrentUser = {
  ...LAYLA,
  creditBalance: 0,
  emailVerified: false,
  emailVerificationRequired: true,
  pendingBonusCredits: 50,
};
const CONFIRMED: CurrentUser = {
  ...LAYLA,
  creditBalance: 50,
  emailVerified: true,
  emailVerificationRequired: true,
  pendingBonusCredits: 0,
};

const TITLE = 'Confirm your email to buy credits';

function mount(
  options: {
    user?: CurrentUser | null;
    locale?: 'en' | 'ar';
    gateway?: Parameters<typeof catalog>[0];
    resend?: () => Response;
  } = {},
) {
  const state = { me: UNCONFIRMED as CurrentUser };
  const api = installFakeApi({
    'GET /billing/subscription': () => json({ data: null }),
    'GET /auth/me': () => json({ data: state.me }),
    'POST /auth/verify-email/request': () =>
      options.resend?.() ?? json({ data: { sent: true, verified: false, resendAfterSec: 60 } }),
  });
  const view = mountBilling(<PricingView catalog={catalog(options.gateway)} />, {
    user: options.user === undefined ? UNCONFIRMED : options.user,
    locale: options.locale,
  });
  return { api, view, state };
}

const buyButtons = () => screen.getAllByRole('button', { name: 'Confirm your email first' });

describe('/pricing for an account that has not confirmed its email address', () => {
  it('says politely that buying needs a confirmed address, with the way to a new link and no promise of credits', () => {
    mount();
    const notice = screen.getByText(TITLE).closest('[role="status"]') as HTMLElement;
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent('Purchases need a confirmed email address');
    expect(notice).toHaveTextContent('layla@example.com');
    expect(notice).not.toHaveTextContent(/sign-up bonus|Confirming also adds/);
    expect(within(notice).getByRole('button', { name: 'Resend link' })).toBeEnabled();
  });

  it('turns every checkout button into an explanation instead of an error, plans and packs, and never calls the API', async () => {
    const { api } = mount();
    const user = userEvent.setup();
    const notice = screen.getByText(TITLE).closest('[id]') as HTMLElement;

    for (const button of buyButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby', notice.id);
    }
    expect(buyButtons()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'One-time packs' }));
    expect(buyButtons()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Buy now' })).not.toBeInTheDocument();
    for (const button of buyButtons()) await user.click(button);
    expect(api.to('POST /billing/checkout')).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('requests a new link: one request, the countdown, a toast', async () => {
    const { api } = mount();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resend link' }));
    expect(api.to('POST /auth/verify-email/request')).toHaveLength(1);
    expect(await screen.findByRole('button', { name: /^Resend in 60 seconds/ })).toBeDisabled();
    expect(screen.getByText('Confirmation email sent. Check your inbox.')).toBeInTheDocument();
  });

  it('counts down the wait the server asks for when a link was sent a moment ago', async () => {
    mount({ resend: () => apiError(429, 'rate_limited', { retryAfterSec: 25 }) });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Resend link' }));
    expect(await screen.findByRole('button', { name: /^Resend in 25 seconds/ })).toBeDisabled();
  });

  it('opens up by itself once the address was confirmed in another tab, without a reload', async () => {
    const { state } = mount();
    expect(buyButtons()).toHaveLength(3);

    state.me = CONFIRMED;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.queryByText(TITLE)).not.toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: 'Confirm your email first' }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
    for (const button of screen.getAllByRole('button', { name: 'Subscribe' })) {
      expect(button).toBeEnabled();
    }
  });

  it('says the same in Arabic', () => {
    mount({ locale: 'ar' });
    expect(screen.getByText('أكّد بريدك الإلكتروني لتشتري رصيدًا')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'أكّد بريدك أولًا' })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'إعادة إرسال الرابط' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/مكافأة|هدية|مجانًا/);
    expect(document.body.textContent).toContain(
      `${String.fromCodePoint(0x2066)}layla@example.com${String.fromCodePoint(0x2069)}`,
    );
  });

  it('reads the same whether or not the server reports a pending bonus', () => {
    mount({ user: { ...UNCONFIRMED, pendingBonusCredits: 0 } });
    expect(screen.getByText(TITLE)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('sign-up bonus');
  });

  it('has no accessibility violations in either language', async () => {
    const english = mount();
    expect(await axeViolations(english.view.container)).toEqual([]);
    english.view.unmount();
    const arabic = mount({ locale: 'ar' });
    expect(await axeViolations(arabic.view.container)).toEqual([]);
  });
});

describe('/pricing for everybody else', () => {
  it('a confirmed account buys as before', () => {
    mount({ user: CONFIRMED });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
  });

  it('an account on a server that does not ask for confirmation buys as before', () => {
    mount({ user: { ...UNCONFIRMED, emailVerificationRequired: false } });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
  });

  it('a user object without the new fields (nothing to confirm) buys as before', () => {
    mount({ user: LAYLA });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Subscribe' })).toHaveLength(3);
  });

  it('a visitor is sent to sign up and sees no notice about an address', () => {
    mount({ user: null });
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign up to subscribe' })).toHaveLength(3);
  });

  it('a paused shop says that and nothing about the address', () => {
    mount({ gateway: { gateway: 'off', canPurchase: false } });
    expect(screen.getByText('Buying is paused')).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Not available right now' })).toHaveLength(3);
  });
});
