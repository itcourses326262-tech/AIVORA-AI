import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityPanel } from '@/components/account/security-panel';
import { AccountDataRights } from '@/components/auth/account-data-rights';
import type { CurrentUser } from '@/lib/user-context';
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

const GOOGLE_USER: CurrentUser = { ...LAYLA, hasPassword: false };
const mount = (ui: Parameters<typeof mountAccount>[0], locale: 'ar' | 'en' = 'en') =>
  mountAccount(ui, { user: GOOGLE_USER, locale });

const sendLink = () =>
  screen.getByRole('button', { name: /Email me a link to set a password|Sending/ });
const forgot = { 'POST /auth/password/forgot': () => json({ data: { accepted: true } }, 202) };

describe('security panel of an account without a password', () => {
  it('has no password form: there is no current password to type', () => {
    installFakeApi();
    mount(<SecurityPanel />);
    expect(screen.queryByLabelText(/^Current password/)).toBeNull();
    expect(screen.queryByLabelText(/^New password/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Update password/ })).toBeNull();
    expect(screen.getByText(/signs in with Google and has no password yet/)).toBeInTheDocument();
    // Signing out everywhere is still there.
    expect(screen.getByRole('button', { name: 'Sign out of all devices' })).toBeInTheDocument();
  });

  it('still shows the form for an account that has a password', () => {
    installFakeApi();
    mountAccount(<SecurityPanel />, { user: { ...LAYLA, hasPassword: true } });
    expect(screen.getByLabelText(/^Current password/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Email me a link/ })).toBeNull();
  });

  it('still shows the form for a user object that says nothing about it', () => {
    installFakeApi();
    mountAccount(<SecurityPanel />);
    expect(screen.getByLabelText(/^Current password/)).toBeInTheDocument();
  });

  it('sends the existing "forgot password" email to the address on the account', async () => {
    const api = installFakeApi(forgot);
    const user = userEvent.setup();
    mount(<SecurityPanel />);
    await user.click(sendLink());

    expect(await screen.findByText(/We sent a link to layla@example.com/)).toHaveTextContent(
      'We sent a link to layla@example.com. Open it to choose a password; it works for one hour.',
    );
    expect(api.to('POST /auth/password/forgot')).toHaveLength(1);
    expect(api.to('POST /auth/password/forgot')[0]?.body).toEqual({ email: 'layla@example.com' });
    expect(api.to('POST /account/password')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /Email me a link/ })).toBeNull();
  });

  it('ignores a second click while the request is out', async () => {
    let answer: (response: Response) => void = () => undefined;
    const api = installFakeApi({
      'POST /auth/password/forgot': () => new Promise<Response>((resolve) => (answer = resolve)),
    });
    const user = userEvent.setup();
    mount(<SecurityPanel />);
    await user.dblClick(sendLink());
    await waitFor(() => expect(sendLink()).toHaveAttribute('aria-busy', 'true'));
    expect(api.to('POST /auth/password/forgot')).toHaveLength(1);
    answer(json({ data: { accepted: true } }, 202));
    await screen.findByText(/We sent a link to/);
  });

  it('says how long to wait after a rate limit and lets the person try again', async () => {
    let first = true;
    installFakeApi({
      'POST /auth/password/forgot': () => {
        if (first) {
          first = false;
          return apiError(429, 'rate_limited', { retryAfterSec: 30 });
        }
        return json({ data: { accepted: true } }, 202);
      },
    });
    const user = userEvent.setup();
    mount(<SecurityPanel />);
    await user.click(sendLink());
    expect(await screen.findByText(/Try again in 30 seconds/)).toBeInTheDocument();
    await user.click(sendLink());
    await screen.findByText(/We sent a link to/);
    expect(screen.queryByText(/Try again in 30 seconds/)).toBeNull();
  });

  it('is in Arabic on the Arabic page, and passes axe in both languages', async () => {
    installFakeApi(forgot);
    for (const locale of ['en', 'ar'] as const) {
      const { container, unmount } = mount(<SecurityPanel />, locale);
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
    mount(<SecurityPanel />, 'ar');
    expect(
      screen.getByRole('button', { name: 'أرسل لي رابطًا لتعيين كلمة مرور' }),
    ).toBeInTheDocument();
  });
});

describe('deleting an account that has no password', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /^Delete my account/ }));

  it('asks for no password: it explains and offers the link instead', async () => {
    const api = installFakeApi(forgot);
    const user = userEvent.setup();
    mount(<AccountDataRights />);
    await open(user);

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByLabelText(/Enter your password to confirm/)).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Delete forever' })).toBeNull();
    expect(within(dialog).getByText(/there is no password to confirm with/)).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole('button', { name: 'Email me a link to set a password' }),
    );
    expect(await within(dialog).findByText(/We sent a link to/)).toHaveTextContent(
      'layla@example.com',
    );
    expect(api.to('POST /auth/password/forgot')).toHaveLength(1);
    // Nothing was deleted.
    expect(api.to('DELETE /account')).toHaveLength(0);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('closes with the "keep my account" button', async () => {
    installFakeApi();
    const user = userEvent.setup();
    mount(<AccountDataRights />);
    await open(user);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Keep my account' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('keeps the password dialog for an account that has a password', async () => {
    installFakeApi();
    const user = userEvent.setup();
    mountAccount(<AccountDataRights />, { user: { ...LAYLA, hasPassword: true } });
    await open(user);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByLabelText(/Enter your password to confirm/)).toBeInTheDocument();
  });

  it('passes axe in the dialog', async () => {
    installFakeApi();
    const user = userEvent.setup();
    mount(<AccountDataRights />);
    await open(user);
    expect(await axeViolations(await screen.findByRole('alertdialog'))).toEqual([]);
  });
});
