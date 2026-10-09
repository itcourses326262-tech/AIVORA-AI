import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegisterForm } from '@/components/auth/register-form';
import { renderUi } from '../render';
import {
  apiError,
  bodyOf,
  focusLink,
  json,
  router,
  stubDesktopPointer,
  stubFetch,
} from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/register' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const name = () => screen.getByRole('textbox', { name: 'Name' });
const email = () => screen.getByRole('textbox', { name: 'Email' });
const password = () => screen.getByLabelText(/^Password/);
const submit = () => screen.getByRole('button', { name: /^Create account|^Creating/ });
const mount = (
  props: Partial<Parameters<typeof RegisterForm>[0]> = {},
  locale: 'ar' | 'en' = 'en',
) => renderUi(<RegisterForm next="/studio" bonus={50} signupOpen {...props} />, { locale });

async function fill(user: ReturnType<typeof userEvent.setup>, pw = 'correct horse') {
  await user.type(name(), 'Layla Hassan');
  await user.type(email(), 'layla@example.com');
  await user.type(password(), pw);
}

describe('RegisterForm', () => {
  it('has the autofill hints for a new account and focuses the name on a desktop', () => {
    stubDesktopPointer();
    mount();
    expect(name()).toHaveAttribute('autocomplete', 'name');
    expect(email()).toHaveAttribute('autocomplete', 'email');
    expect(password()).toHaveAttribute('autocomplete', 'new-password');
    expect(name()).toHaveFocus();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
  });

  it('does not flag the empty name when focus leaves it for the log in link', async () => {
    stubDesktopPointer();
    mount();
    expect(name()).toHaveFocus();
    await focusLink('Log in');
    expect(screen.queryByText(/Enter your name/)).not.toBeInTheDocument();
    expect(name()).not.toHaveAttribute('aria-invalid');
  });

  it('sends name, email, password and the language of the page, then goes on', async () => {
    const fetchMock = stubFetch(() => json({ data: { id: 'usr_1' } }, 201));
    const user = userEvent.setup();
    mount({ next: '/gallery' });
    await fill(user);
    await user.click(submit());

    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/gallery'));
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/register');
    expect(bodyOf(fetchMock)).toEqual({
      name: 'Layla Hassan',
      email: 'layla@example.com',
      password: 'correct horse',
      locale: 'en',
    });
  });

  it('registers the account with the Arabic locale when the page is Arabic', async () => {
    const fetchMock = stubFetch(() => json({ data: {} }, 201));
    const user = userEvent.setup();
    mount({}, 'ar');
    await user.type(screen.getByRole('textbox', { name: 'الاسم' }), 'ليلى');
    await user.type(
      screen.getByRole('textbox', { name: 'البريد الإلكتروني' }),
      'layla@example.com',
    );
    await user.type(screen.getByLabelText(/^كلمة المرور/), 'correct horse');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toMatchObject({ name: 'ليلى', locale: 'ar' });
  });

  it.each([['//evil.com'], ['https://evil.com'], ['/\\evil.com'], ['/register']])(
    'never redirects to %j',
    async (next) => {
      stubFetch(() => json({ data: {} }, 201));
      const user = userEvent.setup();
      mount({ next });
      await fill(user);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
    },
  );

  it('validates all three fields before sending anything', async () => {
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mount();
    await user.type(password(), 'short');
    await user.click(submit());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument();
    expect(name()).toHaveFocus();
    expect(password()).toHaveAccessibleDescription(/Use at least 8 characters\./);
  });

  it('rates the password as it is typed, and announces only the word', async () => {
    const user = userEvent.setup();
    mount();
    const live = () => document.querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live()).toBeEmptyDOMElement();

    await user.type(password(), 'abc12345');
    expect(live()).toHaveTextContent('Password strength: Weak');
    await user.clear(password());
    await user.type(password(), 'Sunny-afternoon-in-Cairo-7!');
    expect(live()).toHaveTextContent('Password strength: Strong');
    // The meter is part of what the field is described by.
    expect(password()).toHaveAccessibleDescription(/At least 8 characters\..*Strong/);
    // Its segments are decoration only.
    expect(document.querySelector('[aria-live="polite"]')?.previousElementSibling).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('turns an already-registered address into a message on the field, with a way to log in', async () => {
    stubFetch(() => apiError(409, 'conflict'));
    const user = userEvent.setup();
    mount({ next: '/gallery' });
    await fill(user);
    await user.keyboard('{Enter}');

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
    expect(email()).toHaveFocus();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    const links = screen.getAllByRole('link', { name: 'Log in' });
    expect(links[0]).toHaveAttribute('href', '/login?next=%2Fgallery');

    // Changing the address answers the message.
    await user.type(email(), 'x');
    expect(
      screen.queryByText('An account with this email already exists.'),
    ).not.toBeInTheDocument();
  });

  it('maps a rejected password from the server to the password field', async () => {
    stubFetch(() =>
      apiError(422, 'validation_failed', { issues: [{ path: 'password', message: 'too common' }] }),
    );
    const user = userEvent.setup();
    mount();
    await fill(user, 'password1234');
    await user.keyboard('{Enter}');
    expect(
      await screen.findByText('This password is too common or easy to guess. Try another one.'),
    ).toBeInTheDocument();
    expect(password()).toHaveFocus();
  });

  it('shows a closed registration as a banner when the server says so', async () => {
    stubFetch(() => apiError(403, 'signup_disabled'));
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'New registrations are currently closed.',
    );
  });

  it('shows throttling with the wait, and a failure with the general text', async () => {
    const fetchMock = stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 3600 }));
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 60 minutes.');
    fetchMock.mockImplementation(async () => apiError(500, 'internal'));
    await user.click(submit());
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.'),
    );
  });

  it('lists what a new account gets, with the real number of credits', () => {
    const { unmount } = mount({ bonus: 120 });
    const list = screen.getByRole('list', { name: 'What you get' });
    expect(within(list).getByText('120 credits free to start')).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    unmount();
    mount({ bonus: 0 });
    const bare = screen.getByRole('list', { name: 'What you get' });
    expect(within(bare).getAllByRole('listitem')).toHaveLength(2);
    expect(within(bare).queryByText(/credits/)).not.toBeInTheDocument();
  });

  it('says the number of credits in Arabic grammar', () => {
    mount({ bonus: 50 }, 'ar');
    const list = screen.getByRole('list', { name: 'ما ستحصل عليه' });
    expect(within(list).getByText('٥٠ رصيدًا مجانًا للبدء')).toBeInTheDocument();
  });

  it('shows no form at all when registration is closed, only the way to log in', () => {
    mount({ signupOpen: false });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create account/ })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-ups are closed for now.');
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('shows progress and ignores a second press while the request is out', async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    mount();
    await fill(user);
    await user.keyboard('{Enter}');
    const busy = screen.getByRole('button', { name: 'Creating your account…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(json({ data: {} }, 201));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
  });
});
