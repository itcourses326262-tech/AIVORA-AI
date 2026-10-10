import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecurityPanel } from '@/components/account/security-panel';
import { AccountDataRights } from '@/components/auth/account-data-rights';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { UserMenu } from '@/components/layout/user-menu';
import { toast } from '@/components/ui/toast';
import { UserProvider } from '@/lib/user-context';
import { installFakeApi, LAYLA, mountAccount, resetAccountTest } from '../account/support';
import { renderUi } from '../render';
import {
  FakePasswordCredential,
  installCredentials,
  removeCredentials,
  watchForLeaks,
} from './credentials-support';
import { apiError, bodyOf, json, router, stubFetch } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));

// Built at runtime and unlike anything else on the page, so a leak cannot be mistaken for a label.
const SECRET = ['zebra', 'lantern', String(91 * 7)].join('-');
const ADDRESS = 'layla@example.com';

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  removeCredentials();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const asLoginForm = () => document.querySelector('form') as HTMLFormElement;
const field = (name: string) =>
  document.querySelector<HTMLInputElement>(`input[name="${name}"]`) as HTMLInputElement;

describe('the forms are real forms a password manager knows', () => {
  it('log in: one post form with the email as the login name and the current password', () => {
    renderUi(<LoginForm next="/studio" />);
    const form = asLoginForm();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(form).toHaveAttribute('method', 'post');
    expect(form.elements.namedItem('email')).toBe(field('email'));
    expect(form.elements.namedItem('password')).toBe(field('password'));

    expect(field('email')).toMatchObject({ id: 'email', type: 'email', name: 'email' });
    expect(field('email')).toHaveAttribute('autocomplete', 'username');
    expect(field('password')).toMatchObject({ id: 'password', type: 'password', name: 'password' });
    expect(field('password')).toHaveAttribute('autocomplete', 'current-password');
    // The labels point at those ids, so the fields are also what a screen reader says they are.
    expect(screen.getByLabelText(/^Email/)).toBe(field('email'));
    expect(screen.getByLabelText(/^Password/)).toBe(field('password'));
  });

  it('log in: the button submits the form (it is a submit button inside it)', () => {
    renderUi(<LoginForm next="/studio" />);
    const button = screen.getByRole('button', { name: 'Log in' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button.closest('form')).toBe(asLoginForm());
  });

  it('sign up: name, then the email as the login name, then a new password', () => {
    renderUi(<RegisterForm next="/studio" bonus={0} signupOpen />);
    const form = asLoginForm();
    expect(document.querySelectorAll('form')).toHaveLength(1);
    expect(form).toHaveAttribute('method', 'post');
    expect([...form.elements].filter((el) => el.tagName === 'INPUT').map((el) => el.id)).toEqual([
      'name',
      'email',
      'password',
    ]);
    expect(field('name')).toHaveAttribute('autocomplete', 'name');
    expect(field('email')).toHaveAttribute('autocomplete', 'username');
    expect(field('email')).toHaveAttribute('type', 'email');
    expect(field('password')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute(
      'type',
      'submit',
    );
  });

  it('asking for a reset link: the email stays a plain email, not a login name', () => {
    renderUi(<ForgotPasswordForm />);
    expect(asLoginForm()).toHaveAttribute('method', 'post');
    expect(field('email')).toMatchObject({ id: 'email', name: 'email', type: 'email' });
    expect(field('email')).toHaveAttribute('autocomplete', 'email');
  });

  it('choosing a new password after a reset: a new-password field the manager can update', () => {
    renderUi(<ResetPasswordForm token="a-token" />);
    expect(asLoginForm()).toHaveAttribute('method', 'post');
    expect(field('password')).toMatchObject({ id: 'password', type: 'password' });
    expect(field('password')).toHaveAttribute('autocomplete', 'new-password');
  });

  it.each([
    ['log in', <LoginForm key="l" next="/studio" />],
    ['sign up', <RegisterForm key="r" next="/studio" bonus={0} signupOpen />],
  ])('%s keeps the same names, ids and tokens in Arabic', (_name, form) => {
    renderUi(form, { locale: 'ar' });
    expect(field('email')).toMatchObject({ id: 'email', name: 'email' });
    expect(field('email')).toHaveAttribute('autocomplete', 'username');
    expect(field('password')).toMatchObject({ id: 'password', name: 'password' });
  });

  it('keeps the show/hide button pointed at the password field by its fixed id', () => {
    renderUi(<LoginForm next="/studio" />);
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-controls',
      'password',
    );
  });
});

async function logIn(user: ReturnType<typeof userEvent.setup>, address = ADDRESS) {
  await user.type(field('email'), address);
  await user.type(field('password'), SECRET);
  await user.keyboard('{Enter}');
}

describe('offering the login to the browser after it worked', () => {
  it('hands over the address and password once the log in succeeded, and only then', async () => {
    const credentials = installCredentials();
    stubFetch(() => json({ data: { id: 'usr_1' } }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/gallery" />);
    await logIn(user, `  ${ADDRESS} `);

    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/gallery'));
    expect(credentials.store).toHaveBeenCalledTimes(1);
    const credential = credentials.store.mock.calls[0]?.[0] as FakePasswordCredential;
    expect(credential).toBeInstanceOf(FakePasswordCredential);
    // The address the server accepted (trimmed) and the password as typed.
    expect(credential).toMatchObject({ id: ADDRESS, password: SECRET });
    // The log in form does not know the person's name.
    expect(credential.name).toBeUndefined();
  });

  it('hands over the name too when the account was just created', async () => {
    const credentials = installCredentials();
    stubFetch(() => json({ data: { id: 'usr_1' } }, 201));
    const user = userEvent.setup();
    renderUi(<RegisterForm next="/studio" bonus={0} signupOpen />);
    await user.type(field('name'), 'Layla Hassan');
    await user.type(field('email'), ADDRESS);
    await user.type(field('password'), SECRET);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/studio'));
    expect(credentials.store).toHaveBeenCalledTimes(1);
    expect(credentials.store.mock.calls[0]?.[0]).toMatchObject({
      id: ADDRESS,
      password: SECRET,
      name: 'Layla Hassan',
    });
  });

  it.each([
    ['wrong credentials', () => apiError(401, 'unauthorized')],
    ['a throttled attempt', () => apiError(429, 'rate_limited', { retryAfterSec: 30 })],
    ['a server error', () => apiError(500, 'internal')],
  ])('does not, after %s', async (_name, answer) => {
    const credentials = installCredentials();
    stubFetch(() => answer());
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(credentials.store).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not, after a dropped connection or a taken address', async () => {
    const credentials = installCredentials();
    const fetchMock = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    renderUi(<RegisterForm next="/studio" bonus={0} signupOpen />);
    await user.type(field('name'), 'Layla');
    await user.type(field('email'), ADDRESS);
    await user.type(field('password'), SECRET);
    await user.keyboard('{Enter}');
    await screen.findByRole('alert');
    fetchMock.mockImplementation(async () => apiError(409, 'conflict'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(credentials.store).not.toHaveBeenCalled();
  });

  it('does not, when the form was refused before it was sent', async () => {
    const credentials = installCredentials();
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(credentials.store).not.toHaveBeenCalled();
  });

  it('works in a browser without PasswordCredential (Firefox, Safari): the log in still goes on', async () => {
    const credentials = installCredentials({ passwordCredential: false });
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
    expect(credentials.store).not.toHaveBeenCalled();
  });

  it('works where there is no navigator.credentials at all (an insecure page)', async () => {
    removeCredentials();
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
  });

  it.each([
    ['rejects', () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))],
    [
      'throws',
      () => {
        throw new TypeError('store is not allowed here');
      },
    ],
    ['returns nothing', () => undefined],
  ])('is not troubled when the browser %s', async (_name, behaviour) => {
    const credentials = installCredentials();
    credentials.store.mockImplementation(behaviour);
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('is not troubled when PasswordCredential itself refuses to be built', async () => {
    installCredentials();
    vi.stubGlobal(
      'PasswordCredential',
      class {
        constructor() {
          throw new TypeError('Illegal constructor');
        }
      },
    );
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
  });

  it('never signs anybody in on its own: nothing asks the browser for a saved credential', async () => {
    const credentials = installCredentials();
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    // Not on load ...
    expect(credentials.get).not.toHaveBeenCalled();
    expect(credentials.store).not.toHaveBeenCalled();
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    // ... and not after a login either.
    expect(credentials.get).not.toHaveBeenCalled();
  });

  it('keeps the password out of storage, cookies, the console and the page address', async () => {
    const credentials = installCredentials();
    const spy = watchForLeaks();
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    spy.stop();

    expect(spy.leaks(SECRET)).toEqual([]);
    expect(window.location.href).not.toContain(SECRET);
    expect(JSON.stringify(router.replace.mock.calls)).not.toContain(SECRET);
    // It went to the one place it has to go, the request, and to the browser's own manager.
    expect(bodyOf(fetchMock)).toEqual({ email: ADDRESS, password: SECRET });
    expect(credentials.store).toHaveBeenCalledTimes(1);
    for (const area of [localStorage, sessionStorage]) {
      expect(JSON.stringify({ ...area })).not.toContain(SECRET);
    }
  });

  it('keeps the password out of storage, cookies and the console when signing up, and when it fails', async () => {
    installCredentials();
    const spy = watchForLeaks();
    stubFetch(() => apiError(401, 'unauthorized'));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await logIn(user);
    await screen.findByRole('alert');
    spy.stop();
    expect(spy.leaks(SECRET)).toEqual([]);
  });
});

describe('telling the browser about a log out', () => {
  const LOGGED_IN = (
    <UserProvider initialUser={LAYLA}>
      <UserMenu />
    </UserProvider>
  );

  async function chooseLogOut(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));
  }

  it('asks it not to sign this person straight back in, after the server ended the session', async () => {
    const credentials = installCredentials();
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderUi(LOGGED_IN);
    await chooseLogOut(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentials.preventSilentAccess).toHaveBeenCalledTimes(1);
    expect(credentials.store).not.toHaveBeenCalled();
    // Not before the answer: a log out that failed has not signed anybody out.
    const asked = credentials.preventSilentAccess.mock.invocationCallOrder[0] ?? 0;
    expect(asked).toBeGreaterThan(fetchMock.mock.invocationCallOrder[0] ?? 0);
  });

  it('does not, when the log out failed and the session is still there', async () => {
    const credentials = installCredentials();
    stubFetch(() => {
      throw new TypeError('offline');
    });
    const failed = vi.spyOn(toast, 'error').mockReturnValue('t');
    const user = userEvent.setup();
    renderUi(LOGGED_IN);
    await chooseLogOut(user);
    await waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
    expect(router.replace).not.toHaveBeenCalled();
    expect(credentials.preventSilentAccess).not.toHaveBeenCalled();
  });

  it.each([
    ['without navigator.credentials', () => removeCredentials()],
    [
      'when the browser refuses',
      () => installCredentials().preventSilentAccess.mockRejectedValue(new Error('no')),
    ],
    [
      'when the browser throws',
      () =>
        installCredentials().preventSilentAccess.mockImplementation(() => {
          throw new TypeError('no');
        }),
    ],
  ])('still logs out %s', async (_name, setUp) => {
    setUp();
    stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    renderUi(LOGGED_IN);
    await chooseLogOut(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });
});

describe('the account page', () => {
  afterEach(resetAccountTest);

  it('signing out everywhere also tells the browser not to sign back in', async () => {
    const credentials = installCredentials();
    installFakeApi({ 'POST /auth/logout-all': () => json({ data: { ok: true } }) });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    await user.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(credentials.preventSilentAccess).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(credentials.preventSilentAccess).toHaveBeenCalledTimes(1);
  });

  it('deleting the account tells the browser too, once the server confirmed it', async () => {
    const credentials = installCredentials();
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    mountAccount(<AccountDataRights />);
    await user.click(screen.getByRole('button', { name: 'Delete my account…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete your account?' });
    await user.type(within(dialog).getByLabelText(/^Enter your password to confirm/), SECRET);
    expect(credentials.preventSilentAccess).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Delete forever' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(credentials.preventSilentAccess).toHaveBeenCalledTimes(1);
    expect(credentials.store).not.toHaveBeenCalled();
  });

  it('a changed password updates the one the browser has saved, and a refused change does not', async () => {
    const credentials = installCredentials();
    const api = installFakeApi({
      'POST /account/password': (call) =>
        (call.body as { currentPassword: string }).currentPassword === 'wrong password'
          ? apiError(422, 'validation_failed', {
              issues: [{ path: 'currentPassword', message: 'bad' }],
            })
          : json({ data: { ok: true } }),
    });
    const user = userEvent.setup();
    mountAccount(<SecurityPanel />);
    const current = () => screen.getByLabelText(/^Current password/);
    const next = () => screen.getByLabelText(/^New password/);
    const update = () => screen.getByRole('button', { name: /^Update password/ });

    await user.type(current(), 'wrong password');
    await user.type(next(), SECRET);
    await user.click(update());
    await waitFor(() => expect(api.to('POST /account/password')).toHaveLength(1));
    await screen.findByText('That is not your current password.');
    expect(credentials.store).not.toHaveBeenCalled();

    await user.clear(current());
    await user.type(current(), 'old password');
    await user.click(update());
    await waitFor(() => expect(credentials.store).toHaveBeenCalledTimes(1));
    expect(credentials.store.mock.calls[0]?.[0]).toMatchObject({
      id: LAYLA.email,
      password: SECRET,
      name: LAYLA.name,
    });
    // The new password was handed to the browser, then the form forgot it.
    await act(async () => undefined);
    expect(next()).toHaveValue('');
  });
});
