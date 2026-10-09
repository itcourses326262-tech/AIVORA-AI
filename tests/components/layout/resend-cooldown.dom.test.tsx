import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmEmailNotice as PricingNotice } from '@/components/billing/confirm-email-notice';
import {
  VerifyEmailBanner,
  resetResendCooldownForTests,
} from '@/components/layout/verify-email-banner';
import { ConfirmEmailNotice as StudioNotice } from '@/components/studio/generate-bar';
import { Toaster, toast } from '@/components/ui/toast';
import { I18nProvider } from '@/lib/i18n/client';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { apiError, json, router, stubFetch } from '../auth/support';
import { renderUi } from '../render';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/studio' }));

const WAITING: CurrentUser = {
  id: 'usr_1',
  email: 'layla@example.com',
  name: 'Layla',
  role: 'user',
  locale: 'en',
  creditBalance: 0,
  emailVerified: false,
  emailVerificationRequired: true,
  pendingBonusCredits: 50,
};

beforeEach(() => {
  router.refresh.mockReset();
});
afterEach(() => {
  resetResendCooldownForTests();
  vi.useFakeTimers();
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What the app puts on one page of an unconfirmed account: the banner above, the notices below it. */
function Page({
  gap,
  studio = true,
  pricing = true,
}: {
  gap: number;
  studio?: boolean;
  pricing?: boolean;
}) {
  return (
    <UserProvider initialUser={WAITING}>
      <VerifyEmailBanner email="layla@example.com" bonusCredits={50} resendAfterSec={gap} />
      {studio ? (
        <section aria-label="studio">
          <StudioNotice />
        </section>
      ) : null}
      {pricing ? (
        <section aria-label="pricing">
          <PricingNotice />
        </section>
      ) : null}
      <Toaster />
    </UserProvider>
  );
}

const banner = () => screen.getByRole('region', { name: 'Email confirmation' });
const bannerButton = () => within(banner()).getByRole('button', { name: /^Resend/ });
const studioButton = () =>
  within(screen.getByRole('region', { name: 'studio' })).getByRole('button', { name: /^Resend/ });
const pricingButton = () =>
  within(screen.getByRole('region', { name: 'pricing' })).getByRole('button', { name: /^Resend/ });
const allButtons = () => [bannerButton(), studioButton(), pricingButton()];

describe('one gap between two confirmation links, for every button that asks for one', () => {
  it('shows the gap the server rendered into the page on the banner AND on the notices', () => {
    renderUi(<Page gap={56} />);
    for (const button of allButtons()) {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Resend in 56 seconds');
    }
  });

  it('counts down in step', async () => {
    vi.useFakeTimers();
    renderUi(<Page gap={3} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    for (const button of allButtons()) expect(button).toHaveTextContent('Resend in 2 seconds');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    for (const button of allButtons()) {
      expect(button).toBeEnabled();
      expect(button).toHaveTextContent('Resend link');
    }
  });

  it('does not let a notice send a request the server must refuse while the banner counts down', async () => {
    const fetchMock = stubFetch(() => json({ data: { sent: true, verified: false } }));
    renderUi(<Page gap={56} />);
    await userEvent.setup().click(studioButton());
    await userEvent.setup().click(pricingButton());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/Too many attempts/)).not.toBeInTheDocument();
  });

  it('starts the gap on all of them when any one asks for a link', async () => {
    const fetchMock = stubFetch(() =>
      json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202),
    );
    renderUi(<Page gap={0} />);
    for (const button of allButtons()) expect(button).toBeEnabled();

    await userEvent.setup().click(studioButton());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(studioButton()).toBeDisabled());
    for (const button of allButtons()) expect(button).toHaveTextContent('Resend in 60 seconds');
    expect(await screen.findByText('Confirmation email sent. Check your inbox.')).toBeVisible();
  });

  it('adopts the wait the server asks for on all of them when it says "too soon"', async () => {
    stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 42 }));
    renderUi(<Page gap={0} />);
    await userEvent.setup().click(bannerButton());
    await waitFor(() => expect(bannerButton()).toBeDisabled());
    for (const button of allButtons()) expect(button).toHaveTextContent('Resend in 42 seconds');
  });

  it('a notice that appears later (another page of the same visit) joins the gap that is running', () => {
    const { rerender } = renderUi(<Page gap={56} studio={false} pricing={false} />);
    rerender(<Page gap={56} pricing={false} />);
    expect(studioButton()).toBeDisabled();
    expect(studioButton()).toHaveTextContent('Resend in 56 seconds');
  });

  it('keeps the gap of a request made on one page when the next page mounts its own notice', async () => {
    stubFetch(() => json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202));
    const first = renderUi(<Page gap={0} pricing={false} />);
    await userEvent.setup().click(studioButton());
    await waitFor(() => expect(studioButton()).toBeDisabled());
    first.unmount();

    renderUi(<Page gap={0} studio={false} />);
    expect(pricingButton()).toBeDisabled();
    expect(pricingButton()).toHaveTextContent('Resend in 60 seconds');
  });

  it('does not make the gap longer when the server renders a shorter one afterwards', async () => {
    stubFetch(() => json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202));
    const { rerender } = renderUi(<Page gap={0} />);
    await userEvent.setup().click(studioButton());
    await waitFor(() => expect(studioButton()).toBeDisabled());
    rerender(<Page gap={20} />);
    expect(studioButton()).toHaveTextContent('Resend in 60 seconds');
  });

  it('is already counting in the HTML the server sends, before anything runs in the browser', () => {
    const html = renderToString(
      <I18nProvider locale="en">
        <UserProvider initialUser={WAITING}>
          <VerifyEmailBanner email="layla@example.com" resendAfterSec={56} />
          <StudioNotice />
        </UserProvider>
      </I18nProvider>,
    );
    expect(html).toContain('Resend in 56 seconds');
  });
});
