import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '@/components/auth/login-form';
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

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const email = () => screen.getByRole('textbox', { name: 'Email' });
const password = () => screen.getByLabelText(/^Password/);
const submit = () => screen.getByRole('button', { name: /^Log in|^Logging in/ });

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.type(email(), 'layla@example.com');
  await user.type(password(), 'correct horse');
  await user.keyboard('{Enter}');
}

describe('LoginForm', () => {
  it('has the fields and attributes password managers and keyboards look for', () => {
    renderUi(<LoginForm next="/studio" />);
    expect(email()).toHaveAttribute('type', 'email');
    // The address is the login name: the browser's password manager saves it with the password.
    expect(email()).toHaveAttribute('autocomplete', 'username');
    expect(email()).toHaveAttribute('inputmode', 'email');
    expect(email()).toHaveAttribute('dir', 'ltr');
    expect(email()).toBeRequired();
    expect(password()).toHaveAttribute('type', 'password');
    expect(password()).toHaveAttribute('autocomplete', 'current-password');
    expect(password()).toHaveAttribute('dir', 'ltr');
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeInTheDocument();
    // Validation is ours, not the browser's tooltips.
    expect(document.querySelector('form')).toHaveAttribute('novalidate');
  });

  it('focuses the email field on a device with a keyboard, and leaves a phone alone', () => {
    stubDesktopPointer();
    renderUi(<LoginForm next="/studio" />);
    expect(email()).toHaveFocus();
  });

  it('does not grab focus without a fine pointer (it would raise the phone keyboard)', () => {
    renderUi(<LoginForm next="/studio" />);
    expect(email()).not.toHaveFocus();
  });

  it('submits with Enter, sends the trimmed address and password, then goes to the next page', async () => {
    const fetchMock = stubFetch(() => json({ data: { id: 'usr_1' } }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/gallery" />);
    await user.type(email(), '  layla@example.com ');
    await user.type(password(), '  spaced password ');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/gallery'));
    expect(router.refresh).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/login');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(bodyOf(fetchMock)).toEqual({
      email: 'layla@example.com',
      password: '  spaced password ',
    });
  });

  it.each([
    ['//evil.com'],
    ['https://evil.com'],
    ['http://evil.com/studio'],
    ['/\\evil.com'],
    ['\\\\evil.com'],
    ['/\t/evil.com'],
    ['javascript:alert(1)'],
    ['/login'],
    ['/register?next=/studio'],
    ['studio'],
    [''],
  ])('never redirects to %j: it falls back to the studio', async (next) => {
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next={next} />);
    await fillAndSubmit(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledExactlyOnceWith('/studio'));
  });

  it('follows a safe deep link with its query string', async () => {
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/gallery/gen_1?view=large" />);
    await fillAndSubmit(user);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/gallery/gen_1?view=large'));
  });

  it('explains empty fields next to them, without a request, and focuses the first one', async () => {
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.click(submit());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(password()).toHaveAttribute('aria-invalid', 'true');
    expect(email()).toHaveFocus();
    // The message is tied to the field it describes.
    expect(email()).toHaveAccessibleDescription('Enter your email address.');
  });

  it('checks the address as soon as the field is left, and clears the message once it is fixed', async () => {
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.type(email(), 'not-an-email');
    expect(screen.queryByText(/Enter a valid email/)).not.toBeInTheDocument();
    await user.tab();
    expect(
      screen.getByText('Enter a valid email address, like you@example.com.'),
    ).toBeInTheDocument();
    await user.clear(email());
    await user.type(email(), 'layla@example.com');
    expect(screen.queryByText(/Enter a valid email/)).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute('aria-invalid');
  });

  it('does not flag an empty field just because focus left it: the message would move the link being clicked', async () => {
    // The email field has focus on load. Pressing "Forgot password?" or "Create an account" first
    // blurs it; a message appearing there shifts the links down before the button comes up and the
    // click is lost (seen in Chromium). Submitting still reports the empty fields.
    stubDesktopPointer();
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    expect(email()).toHaveFocus();
    await focusLink('Forgot password?');
    expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument();
    expect(email()).not.toHaveAttribute('aria-invalid');

    await user.click(email());
    await user.tab();
    expect(screen.queryByText('Enter your email address.')).not.toBeInTheDocument();
    await user.click(submit());
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
  });

  it('keeps a half-typed address quiet while focus moves to a link, and flags it when focus moves on', async () => {
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.type(email(), 'not-an-email');
    await focusLink('Forgot password?');
    expect(screen.queryByText(/Enter a valid email/)).not.toBeInTheDocument();

    await user.click(email());
    await user.click(password());
    expect(
      screen.getByText('Enter a valid email address, like you@example.com.'),
    ).toBeInTheDocument();
  });

  it('flags an address that was typed and then cleared when the field is left', async () => {
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.type(email(), 'a');
    await user.clear(email());
    await user.tab();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
  });

  it('shows the wrong-credentials banner and puts the cursor back in the password field', async () => {
    stubFetch(() => apiError(401, 'unauthorized'));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(password()).toHaveFocus();
    expect(router.replace).not.toHaveBeenCalled();
    expect(submit()).not.toHaveAttribute('aria-busy');
    // The server's English message is never shown.
    expect(screen.queryByText(/English message/)).not.toBeInTheDocument();
  });

  it('tells a throttled visitor how long to wait', async () => {
    stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 45 }));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many attempts. Try again in 45 seconds.',
    );
  });

  it.each([
    [500, 'internal', 'Something went wrong on our side. Please try again.'],
    [502, 'provider_error', 'The generation service ran into a problem. Please try again.'],
  ])('maps a %s %s to its dictionary text', async (status, code, text) => {
    stubFetch(() => apiError(status, code));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });

  it('reports a dropped connection and lets the visitor try again', async () => {
    const fetchMock = stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await fillAndSubmit(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We can't reach the server. Check your connection and try again.",
    );
    fetchMock.mockImplementation(async () => json({ data: {} }));
    await user.click(submit());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/studio'));
  });

  it('shows progress while waiting and ignores a second press', async () => {
    let finish: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await fillAndSubmit(user);

    const busy = screen.getByRole('button', { name: 'Logging in…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    await user.keyboard('{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => finish(json({ data: {} })));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/studio'));
    // It stays busy while the next page loads: no flash of the form, no second login.
    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeInTheDocument();
  });

  it('shows and hides the password with a button that says what it will do', async () => {
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />);
    await user.type(password(), 'secret');
    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show).toHaveAttribute('aria-controls', password().id);
    await user.click(show);
    expect(password()).toHaveAttribute('type', 'text');
    expect(password()).toHaveValue('secret');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password()).toHaveAttribute('type', 'password');
  });

  it('links to registration and keeps the page the visitor was heading for', () => {
    const { rerender } = renderUi(<LoginForm next="/studio" />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register',
    );
    rerender(<LoginForm next="/gallery/gen_1?x=1" />);
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/register?next=%2Fgallery%2Fgen_1%3Fx%3D1',
    );
  });

  it('speaks Arabic, right to left, down to the error messages', async () => {
    stubFetch(() => apiError(401, 'unauthorized'));
    const user = userEvent.setup();
    renderUi(<LoginForm next="/studio" />, { locale: 'ar' });
    expect(screen.getByRole('heading', { level: 1, name: 'مرحبًا بعودتك' })).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'البريد الإلكتروني' }),
      'layla@example.com',
    );
    await user.type(screen.getByLabelText(/^كلمة المرور/), 'correct horse');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    );
    expect(screen.getByRole('button', { name: 'إظهار كلمة المرور' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'أنشئ حسابًا' })).toHaveAttribute('href', '/register');
  });
});
