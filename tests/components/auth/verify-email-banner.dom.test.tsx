import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VerifyEmailBanner,
  resetResendCooldownForTests,
} from '@/components/layout/verify-email-banner';
import { Toaster, toast } from '@/components/ui/toast';
import { UserProvider, type CurrentUser } from '@/lib/user-context';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, json, router, stubFetch } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/studio' }));

beforeEach(() => {
  router.refresh.mockReset();
});
afterEach(() => {
  resetResendCooldownForTests();
  // The toast store outlives a test: clear it, letting the exit animation finish.
  vi.useFakeTimers();
  act(() => {
    toast.dismissAll();
    vi.advanceTimersByTime(1000);
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** What a person reads: the invisible bidi isolates around the address are not text. */
const readable = (element: Element) => (element.textContent ?? '').replace(/\p{Cf}/gu, '');

const mount = (
  props: Partial<Parameters<typeof VerifyEmailBanner>[0]> = {},
  locale: 'ar' | 'en' = 'en',
) =>
  renderUi(
    <>
      <VerifyEmailBanner email="layla@example.com" {...props} />
      <Toaster />
    </>,
    { locale },
  );

const region = () =>
  screen.getByRole('region', { name: /^(Email confirmation|تأكيد البريد الإلكتروني)$/ });
const resend = () => screen.getByRole('button', { name: /^Resend/ });

describe('VerifyEmailBanner', () => {
  it('says what is missing and why, as a labelled region', () => {
    mount();
    const region = screen.getByRole('region', { name: 'Email confirmation' });
    expect(readable(region)).toContain('Confirm layla@example.com to start creating.');
    expect(region).toHaveTextContent('you cannot generate');
    expect(resend()).toBeEnabled();
    expect(resend()).toHaveTextContent('Resend link');
  });

  it('names the free credits that confirming unlocks, when there are some', () => {
    mount({ bonusCredits: 50 });
    expect(readable(region())).toContain(
      'Confirm layla@example.com to claim your sign-up bonus of 50 credits and start creating.',
    );
  });

  it("starts with the server's resend gap already running, and counts it down", async () => {
    vi.useFakeTimers();
    mount({ resendAfterSec: 3 });
    expect(resend()).toBeDisabled();
    expect(resend()).toHaveTextContent('Resend in 3 seconds');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(resend()).toHaveTextContent('Resend in 2 seconds');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(resend()).toBeEnabled();
    expect(resend()).toHaveTextContent('Resend link');
  });

  it('asks for a new link with a POST, confirms with a toast and starts a new gap', async () => {
    const fetchMock = stubFetch(() =>
      json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202),
    );
    const user = userEvent.setup();
    mount();
    await user.click(resend());
    expect(
      await screen.findByText('Confirmation email sent. Check your inbox.'),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/verify-email/request');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(resend()).toBeDisabled();
    expect(resend()).toHaveTextContent('Resend in 60 seconds');
  });

  it('cannot be double-clicked into two requests', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    mount();
    await user.click(resend());
    await user.click(resend());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resend()).toHaveAttribute('aria-busy', 'true');
    release(json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202));
    await waitFor(() => expect(resend()).toBeDisabled());
  });

  it('adopts the wait the server asks for when it says "too soon"', async () => {
    stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 30 }));
    const user = userEvent.setup();
    mount();
    await user.click(resend());
    expect(
      await screen.findByText('Too many attempts. Try again in 30 seconds.'),
    ).toBeInTheDocument();
    expect(resend()).toHaveTextContent('Resend in 30 seconds');
    expect(resend()).toBeDisabled();
  });

  it('refreshes the page when the server says the address is already confirmed', async () => {
    stubFetch(() => json({ data: { sent: false, verified: true, resendAfterSec: 0 } }));
    const user = userEvent.setup();
    mount();
    await user.click(resend());
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText('Confirmation email sent. Check your inbox.'),
    ).not.toBeInTheDocument();
  });

  it('shows other failures in words and stays usable', async () => {
    stubFetch(() => apiError(500, 'internal'));
    const user = userEvent.setup();
    mount();
    await user.click(resend());
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    await waitFor(() => expect(resend()).toBeEnabled());
  });

  describe('noticing that the link was used elsewhere', () => {
    function setVisibility(state: 'visible' | 'hidden') {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    }

    afterEach(() => {
      Reflect.deleteProperty(document, 'visibilityState');
    });

    it('re-reads the page when the tab comes back, but not more than every 15 seconds', () => {
      vi.useFakeTimers();
      mount();
      setVisibility('visible');
      expect(router.refresh).not.toHaveBeenCalled();
      vi.setSystemTime(Date.now() + 16_000);
      setVisibility('hidden');
      expect(router.refresh).not.toHaveBeenCalled();
      setVisibility('visible');
      expect(router.refresh).toHaveBeenCalledTimes(1);
      setVisibility('visible');
      expect(router.refresh).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 16_000);
      setVisibility('visible');
      expect(router.refresh).toHaveBeenCalledTimes(2);
    });

    it('stops listening when it goes away', () => {
      vi.useFakeTimers();
      const { unmount } = mount();
      unmount();
      vi.setSystemTime(Date.now() + 60_000);
      setVisibility('visible');
      expect(router.refresh).not.toHaveBeenCalled();
    });
  });

  describe('following the account the rest of the page follows', () => {
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
    const CONFIRMED_ME = {
      ...WAITING,
      creditBalance: 50,
      emailVerified: true,
      pendingBonusCredits: 0,
      createdAt: 0,
    };

    const mountInApp = (user: CurrentUser = WAITING) =>
      renderUi(
        <UserProvider initialUser={user}>
          <VerifyEmailBanner email="layla@example.com" bonusCredits={50} />
        </UserProvider>,
      );
    const banner = () => screen.queryByRole('region', { name: 'Email confirmation' });

    /** The person comes back to this window (nothing hid the tab): `Date` moves, the page's timers stay real. */
    async function focusAfter(ms: number) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + ms);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
      });
    }

    it('goes away when the window gets focus back and the address turns out confirmed, with no tab switch and no 15 second wait', async () => {
      const fetchMock = stubFetch(() => json({ data: CONFIRMED_ME }));
      mountInApp();
      expect(banner()).toBeInTheDocument();

      await focusAfter(5_000); // the page is only a few seconds old: the old 15 s throttle held it back

      await waitFor(() => expect(banner()).not.toBeInTheDocument());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/me');
      // The server-rendered layout is told too, so it stops rendering the banner at all.
      await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    });

    it('stays while the address is still unconfirmed, however often the window is focused', async () => {
      stubFetch(() => json({ data: { ...WAITING, createdAt: 0 } }));
      mountInApp();
      await focusAfter(5_000);
      await focusAfter(5_000);
      expect(banner()).toBeInTheDocument();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('renders nothing when the page already knows the account is confirmed', () => {
      mountInApp({ ...WAITING, emailVerified: true, creditBalance: 50, pendingBonusCredits: 0 });
      expect(banner()).not.toBeInTheDocument();
    });

    it('renders nothing on a server that does not ask for a confirmation', () => {
      mountInApp({ ...WAITING, emailVerificationRequired: false });
      expect(banner()).not.toBeInTheDocument();
    });

    it('is still shown without a user context around it (it needs none)', () => {
      mount();
      expect(banner()).toBeInTheDocument();
    });
  });

  it('is right to left and fully in Arabic, with the address kept readable', () => {
    mount({ bonusCredits: 50, resendAfterSec: 0 }, 'ar');
    const region = screen.getByRole('region', { name: 'تأكيد البريد الإلكتروني' });
    expect(region.textContent).toContain(
      `${String.fromCodePoint(0x2066)}layla@example.com${String.fromCodePoint(0x2069)}`,
    );
    expect(readable(region)).toContain('٥٠ رصيدًا مجانًا');
    expect(screen.getByRole('button', { name: 'إعادة إرسال الرابط' })).toBeInTheDocument();
  });

  it('wraps a very long address instead of overflowing', () => {
    mount({ email: `${'a'.repeat(60)}@${'b'.repeat(60)}.example.com` });
    expect(region().querySelector('p')).toHaveClass('break-words');
  });

  it.each(['en', 'ar'] as const)('has no accessibility violations in %s', async (locale) => {
    const { container } = mount({ bonusCredits: 50, resendAfterSec: 30 }, locale);
    expect(await axeViolations(container)).toEqual([]);
  });
});
