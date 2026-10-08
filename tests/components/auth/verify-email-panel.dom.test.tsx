import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VerifyEmailPanel } from '@/components/auth/verify-email-panel';
import { Toaster } from '@/components/ui/toast';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, bodyOf, json, stubFetch } from './support';

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

beforeEach(() => {
  window.history.replaceState(null, '', `/verify-email?token=${TOKEN}`);
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const confirmed = (extra: Record<string, unknown> = {}) =>
  json({ data: { verified: true, alreadyVerified: false, bonusCredits: 0, ...extra } });

describe('VerifyEmailPanel', () => {
  it('confirms on arrival with a POST, and shows the result with the bonus', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />);

    // While the request is out: a status, not a verdict.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Confirming your email…' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/verify-email/confirm');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(bodyOf(fetchMock)).toEqual({ token: TOKEN });

    release(confirmed({ bonusCredits: 50 }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email confirmed' }),
    ).toBeInTheDocument();
    expect(screen.getByText('50 credits were added to your balance.')).toBeInTheDocument();
    expect(screen.getByText('Thank you. Your account is fully active.')).toBeInTheDocument();
  });

  it('leaves out the bonus line when nothing was added, and says so for an address confirmed before', async () => {
    stubFetch(() => confirmed({ alreadyVerified: true }));
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn />);
    expect(
      await screen.findByText('This address was already confirmed. You are all set.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/were added to your balance/)).not.toBeInTheDocument();
  });

  it('sends a signed-in person on to the studio, and a visitor to log in', async () => {
    stubFetch(() => confirmed());
    const { unmount } = renderUi(<VerifyEmailPanel token={TOKEN} signedIn />);
    expect(await screen.findByRole('link', { name: 'Open the studio' })).toHaveAttribute(
      'href',
      '/studio',
    );
    unmount();

    window.history.replaceState(null, '', `/verify-email?token=${TOKEN}`);
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />);
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fstudio',
    );
  });

  it('takes the token out of the address bar once the link has been dealt with', async () => {
    stubFetch(() => confirmed());
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />);
    await screen.findByText('Email confirmed');
    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
  });

  it('sends the link once even where effects run twice (React strict mode)', async () => {
    const fetchMock = stubFetch(() => confirmed());
    renderUi(
      <StrictMode>
        <VerifyEmailPanel token={TOKEN} signedIn={false} />
      </StrictMode>,
    );
    await screen.findByText('Email confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['invalid', 'This link does not work'],
    ['expired', 'This link has expired'],
    ['used', 'This link was already used'],
  ] as const)('explains a link that is %s', async (reason, title) => {
    stubFetch(() => apiError(400, 'bad_request', { reason }));
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />);
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    // A visitor is pointed at logging in, where the banner can send a new link.
    expect(screen.getByText('Log in to request a new link.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('shows the invalid state without any request when the link carried no token', () => {
    const fetchMock = stubFetch(() => confirmed());
    renderUi(<VerifyEmailPanel token={null} signedIn={false} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link does not work' }),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets a signed-in person ask for a new link right there, once, and shows when to wait', async () => {
    const answers = [
      apiError(400, 'bad_request', { reason: 'expired' }),
      json({ data: { sent: true, verified: false, resendAfterSec: 60 } }, 202),
    ];
    const fetchMock = stubFetch(() => (answers.shift() as Response).clone());
    const user = userEvent.setup();
    renderUi(
      <>
        <VerifyEmailPanel token={TOKEN} signedIn />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Send me a new link' }));
    expect(
      await screen.findByText('A new link is on its way. Check your inbox.'),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/auth/verify-email/request');
    expect(screen.queryByRole('button', { name: 'Send me a new link' })).not.toBeInTheDocument();
  });

  it('reports a refused resend (the 60 second gap) instead of failing silently', async () => {
    const answers = [
      apiError(400, 'bad_request', { reason: 'expired' }),
      apiError(429, 'rate_limited', { retryAfterSec: 45 }),
    ];
    stubFetch(() => (answers.shift() as Response).clone());
    const user = userEvent.setup();
    renderUi(
      <>
        <VerifyEmailPanel token={TOKEN} signedIn />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Send me a new link' }));
    expect(
      await screen.findByText('Too many attempts. Try again in 45 seconds.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send me a new link' })).toBeDisabled(),
    );
  });

  it('does not call a dropped connection a verdict: it offers to try again with the same link', async () => {
    const answers: Array<() => Promise<Response> | Response> = [
      () => Promise.reject(new TypeError('offline')),
      () => confirmed({ bonusCredits: 50 }),
    ];
    const fetchMock = stubFetch(() => (answers.shift() as () => Promise<Response>)());
    const user = userEvent.setup();
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Could not confirm yet' }),
    ).toBeInTheDocument();
    // The token is still in the address bar: the link has not been used up.
    expect(window.location.search).toContain(TOKEN);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Email confirmed' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('is right to left and fully in Arabic, with Arabic grammar for the credits', async () => {
    stubFetch(() => confirmed({ bonusCredits: 50 }));
    renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />, { locale: 'ar' });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'تم تأكيد البريد الإلكتروني' }),
    ).toBeInTheDocument();
    expect(screen.getByText('أُضيف ٥٠ رصيدًا إلى رصيدك.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'تسجيل الدخول' })).toBeInTheDocument();
  });

  it.each(['en', 'ar'] as const)(
    'has no accessibility violations in %s while pending, done or failed',
    async (locale) => {
      let release: (response: Response) => void = () => {};
      stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
      const { container } = renderUi(<VerifyEmailPanel token={TOKEN} signedIn={false} />, {
        locale,
      });
      expect(await axeViolations(container)).toEqual([]);
      release(confirmed({ bonusCredits: 50 }));
      await screen.findByRole('link');
      expect(await axeViolations(container)).toEqual([]);
      const failed = renderUi(<VerifyEmailPanel token={null} signedIn={false} />, { locale });
      expect(await axeViolations(failed.container)).toEqual([]);
    },
  );
});
