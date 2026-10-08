import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityPanel } from '@/components/account/security-panel';
import { PASSWORD_MIN_LENGTH } from '@/components/auth/schemas';
import { axeViolations } from '../axe';
import {
  apiError,
  installFakeApi,
  json,
  LAYLA,
  mountAccount,
  resetAccountTest,
  router,
} from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/account' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});
afterEach(resetAccountTest);

const current = () => screen.getByLabelText(/^Current password/);
const next = () => screen.getByLabelText(/^New password/);
const update = () => screen.getByRole('button', { name: /^Update password|^Updating/ });

const invalid = (path: string) =>
  apiError(422, 'validation_failed', { issues: [{ path, message: 'bad' }] });

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  now = 'old password',
  after = 'a better password 42',
) {
  await user.type(current(), now);
  await user.type(next(), after);
}

describe('change password', () => {
  it('has the attributes password managers look for, and reads left to right', () => {
    installFakeApi();
    mountAccount(<SecurityPanel />);
    expect(current()).toHaveAttribute('autocomplete', 'current-password');
    expect(next()).toHaveAttribute('autocomplete', 'new-password');
    for (const field of [current(), next()]) {
      expect(field).toHaveAttribute('type', 'password');
      expect(field).toHaveAttribute('dir', 'ltr');
      expect(field).toBeRequired();
    }
    // The account name, so a manager saves the new password for the right account.
    const username = document.querySelector('input[autocomplete="username"]');
    expect(username).toHaveValue(LAYLA.email);
    expect(username).toHaveAttribute('hidden');
  });

  it('asks for both passwords before sending anything', async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await user.click(update());
    expect(await screen.findByText('Enter your current password.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(api.to('POST /account/password')).toHaveLength(0);
  });

  it('refuses a short new password without asking the server', async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user, 'old password', 'short');
    await user.click(update());
    expect(
      await screen.findByText(`Use at least ${PASSWORD_MIN_LENGTH} characters.`),
    ).toBeInTheDocument();
    expect(next()).toHaveAttribute('aria-invalid', 'true');
    expect(api.to('POST /account/password')).toHaveLength(0);
  });

  it('sends both passwords unchanged (no trimming), empties the fields and says what happened', async () => {
    const api = installFakeApi({ 'POST /account/password': () => json({ data: { ok: true } }) });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user, ' old password ', ' a better password 42 ');
    await user.click(update());
    expect(
      await screen.findByText('Password updated. Other devices were signed out.'),
    ).toBeInTheDocument();
    expect(api.to('POST /account/password')[0]?.body).toEqual({
      currentPassword: ' old password ',
      newPassword: ' a better password 42 ',
    });
    expect(current()).toHaveValue('');
    expect(next()).toHaveValue('');
  });

  it('shows how strong the new password is, as the word and not only as colour', async () => {
    installFakeApi();
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    expect(screen.queryByText(/^Password strength/)).not.toBeInTheDocument();
    await user.type(next(), 'abc');
    expect(await screen.findByText('Weak')).toBeInTheDocument();
    await user.clear(next());
    await user.type(next(), 'correct horse battery staple 99');
    expect(await screen.findByText('Strong')).toBeInTheDocument();
    expect(next()).toHaveAccessibleDescription(
      /At least 8 characters\..*Password strength:\s*Strong/,
    );
  });

  it('pins a wrong current password to its field and keeps what was typed', async () => {
    installFakeApi({ 'POST /account/password': () => invalid('currentPassword') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    expect(await screen.findByText('That is not your current password.')).toBeInTheDocument();
    expect(current()).toHaveAttribute('aria-invalid', 'true');
    expect(next()).toHaveValue('a better password 42');
  });

  it('pins a new password that equals the old one to the new field', async () => {
    installFakeApi({ 'POST /account/password': () => invalid('newPassword') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    expect(
      await screen.findByText('Choose a password different from your current one.'),
    ).toBeInTheDocument();
    expect(next()).toHaveAttribute('aria-invalid', 'true');
  });

  it('pins a password that is too common to the new field', async () => {
    installFakeApi({ 'POST /account/password': () => invalid('password') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    expect(await screen.findByText(/too common or easy to guess/)).toBeInTheDocument();
  });

  it("puts a failure that is nobody's field in the banner, with the wait when it is known", async () => {
    installFakeApi({
      'POST /account/password': () => apiError(429, 'rate_limited', { retryAfterSec: 120 }),
    });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    expect(
      await screen.findByText('Too many attempts. Try again in 2 minutes.'),
    ).toBeInTheDocument();
    expect(current()).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('clears a field error as soon as the field is edited', async () => {
    installFakeApi({ 'POST /account/password': () => invalid('currentPassword') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    await screen.findByText('That is not your current password.');
    await user.type(current(), '1');
    expect(screen.queryByText('That is not your current password.')).not.toBeInTheDocument();
  });

  it('asks the server again when the session is gone', async () => {
    installFakeApi({ 'POST /account/password': () => apiError(401, 'unauthorized') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await fill(user);
    await user.click(update());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });
});

describe('sign out everywhere', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    return screen.findByRole('alertdialog', { name: 'Sign out of all devices?' });
  };

  it('asks before it does anything', async () => {
    const api = installFakeApi();
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    const dialog = await open(user);
    expect(within(dialog).getByText(/You will be signed out here too/)).toBeInTheDocument();
    expect(api.to('POST /auth/logout-all')).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(api.to('POST /auth/logout-all')).toHaveLength(0);
  });

  it('ends every session and sends this browser to the login page', async () => {
    const api = installFakeApi({ 'POST /auth/logout-all': () => json({ data: { ok: true } }) });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(api.to('POST /auth/logout-all')).toHaveLength(1);
    expect(router.refresh).toHaveBeenCalled();
  });

  it('stays open and says so when it fails', async () => {
    installFakeApi({ 'POST /auth/logout-all': () => apiError(500, 'internal') });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/went wrong/i);
    expect(router.replace).not.toHaveBeenCalled();
    // The button is usable again.
    expect(within(dialog).getByRole('button', { name: 'Sign out everywhere' })).toBeEnabled();
  });

  it('cannot be dismissed with Escape while the request is on its way', async () => {
    let finish: (response: Response) => void = () => undefined;
    installFakeApi({
      'POST /auth/logout-all': () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    const dialog = await open(user);
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await within(dialog).findByRole('button', { name: /Signing out/ });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    finish(json({ data: { ok: true } }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
  });
});

describe('security panel, as a whole', () => {
  it('has no accessibility violations, in English and in Arabic', async () => {
    installFakeApi();
    const english = mountAccount(<SecurityPanel />);
    expect(await axeViolations(english.container)).toEqual([]);
    english.unmount();
    const arabic = mountAccount(<SecurityPanel />, {
      locale: 'ar',
      user: { ...LAYLA, locale: 'ar' },
    });
    expect(
      screen.getByRole('heading', { level: 2, name: 'تغيير كلمة المرور' }),
    ).toBeInTheDocument();
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});
