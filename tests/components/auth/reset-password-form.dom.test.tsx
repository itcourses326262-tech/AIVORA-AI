import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, bodyOf, stubDesktopPointer, stubFetch } from './support';

afterEach(() => {
  vi.unstubAllGlobals();
});

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const password = () => screen.getByLabelText(/^New password/);
const submit = () => screen.getByRole('button', { name: /^Save new password|^Saving/ });

describe('ResetPasswordForm', () => {
  it('asks for the new password with the hints password managers look for', () => {
    stubDesktopPointer();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'new-password');
    expect(password()).toHaveAttribute('dir', 'ltr');
    expect(password()).toHaveFocus();
    // The same hint and strength meter as on sign-up.
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
  });

  it('checks the length before asking the server', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    await user.click(submit());
    expect(await screen.findByText('Enter your password.')).toBeInTheDocument();
    await user.type(password(), 'short');
    await user.click(submit());
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the link token with the password and then offers to log in', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    await user.type(password(), 'a completely different passphrase 42');
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Password updated' }),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/password/reset');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(bodyOf(fetchMock)).toEqual({
      token: TOKEN,
      password: 'a completely different passphrase 42',
    });
    expect(screen.getByText(/signed out everywhere/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    // The form, and with it the password, is gone from the page.
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it('keeps the form and the link when the server refuses the password as too weak', async () => {
    stubFetch(() =>
      apiError(422, 'validation_failed', {
        issues: [{ path: 'password', message: 'Password is too common' }],
      }),
    );
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    await user.type(password(), 'password1234');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/too common or easy to guess/)).toBeInTheDocument();
    expect(password()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveFocus();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Choose a new password' }),
    ).toBeInTheDocument();
    // Typing again answers the complaint.
    await user.type(password(), 'x');
    expect(screen.queryByText(/too common or easy to guess/)).not.toBeInTheDocument();
  });

  it.each([
    ['invalid', 'This link does not work'],
    ['expired', 'This link has expired'],
    ['used', 'This link was already used'],
  ] as const)('explains a link that is %s and offers a new one', async (reason, title) => {
    stubFetch(() => apiError(400, 'bad_request', { reason }));
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    await user.type(password(), 'a completely different passphrase 42');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.queryByLabelText(/^New password/)).not.toBeInTheDocument();
  });

  it('shows the invalid-link state at once, without a request, when the link carried no token', () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    renderUi(<ResetPasswordForm token={null} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'This link does not work' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows rate limits and connection problems in words, and stays usable', async () => {
    const calls: Array<() => Promise<Response> | Response> = [
      () => apiError(429, 'rate_limited', { retryAfterSec: 120 }),
      () => Promise.reject(new TypeError('offline')),
    ];
    stubFetch(() => (calls.shift() ?? (() => new Response(null, { status: 204 })))());
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />);
    await user.type(password(), 'a completely different passphrase 42');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 2 minutes.');
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-busy', 'true'));
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/We can't reach the server/)).toBeInTheDocument();
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-busy', 'true'));
    await user.click(submit());
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Password updated' }),
    ).toBeInTheDocument();
  });

  it('is right to left and fully in Arabic', async () => {
    stubFetch(() => apiError(400, 'bad_request', { reason: 'expired' }));
    const user = userEvent.setup();
    renderUi(<ResetPasswordForm token={TOKEN} />, { locale: 'ar' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'اختر كلمة مرور جديدة' }),
    ).toBeInTheDocument();
    await user.type(
      screen.getByLabelText(/^كلمة المرور الجديدة/),
      'a completely different passphrase 42',
    );
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'انتهت صلاحية هذا الرابط' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'اطلب رابطًا جديدًا' })).toBeInTheDocument();
  });

  it.each(['en', 'ar'] as const)(
    'has no accessibility violations in %s in any of its states',
    async (locale) => {
      const { container, unmount } = renderUi(<ResetPasswordForm token={TOKEN} />, { locale });
      expect(await axeViolations(container)).toEqual([]);
      unmount();
      const none = renderUi(<ResetPasswordForm token={null} />, { locale });
      expect(await axeViolations(none.container)).toEqual([]);
    },
  );
});
