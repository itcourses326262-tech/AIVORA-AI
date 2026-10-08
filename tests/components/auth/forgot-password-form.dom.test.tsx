import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, bodyOf, json, stubDesktopPointer, stubFetch } from './support';

afterEach(() => {
  vi.unstubAllGlobals();
});

const email = () => screen.getByRole('textbox', { name: /^Email/ });
const submit = () => screen.getByRole('button', { name: /^Send reset link|^Sending/ });

describe('ForgotPasswordForm', () => {
  it('asks for the email with the hints keyboards and autofill look for', () => {
    stubDesktopPointer();
    renderUi(<ForgotPasswordForm />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(email()).toHaveAttribute('type', 'email');
    expect(email()).toHaveAttribute('autocomplete', 'email');
    expect(email()).toHaveAttribute('dir', 'ltr');
    expect(email()).toHaveFocus();
    expect(document.querySelector('form')).toHaveAttribute('novalidate');
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  it('checks the address before asking the server', async () => {
    const fetchMock = stubFetch(() => json({ data: { accepted: true } }, 202));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);

    await user.click(submit());
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    await user.type(email(), 'not-an-email');
    await user.click(submit());
    expect(await screen.findByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(email()).toHaveAttribute('aria-invalid', 'true');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the trimmed address and then says to check the inbox, naming the address', async () => {
    const fetchMock = stubFetch(() => json({ data: { accepted: true } }, 202));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);
    await user.type(email(), '  layla@example.com ');
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Check your email' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/password/forgot');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(bodyOf(fetchMock)).toEqual({ email: 'layla@example.com' });
    // It does not claim an account exists.
    expect(screen.getByText(/If there is an account for/)).toHaveTextContent('layla@example.com');
    expect(screen.getByRole('status')).toHaveTextContent('It works for one hour');
  });

  it('says exactly the same for every address the server accepts', async () => {
    stubFetch(() => json({ data: { accepted: true } }, 202));
    const user = userEvent.setup();
    const { unmount } = renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'someone-unknown@example.com');
    await user.keyboard('{Enter}');
    await screen.findByText('Check your email');
    const unknownText = screen
      .getByRole('status')
      .textContent?.replace('someone-unknown@example.com', 'X');
    unmount();

    renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'layla@example.com');
    await user.keyboard('{Enter}');
    await screen.findByText('Check your email');
    expect(screen.getByRole('status').textContent?.replace('layla@example.com', 'X')).toBe(
      unknownText,
    );
  });

  it('lets the person correct the address and ask again', async () => {
    stubFetch(() => json({ data: { accepted: true } }, 202));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'layla@example.com');
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Use a different email' }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    // The previous address stays, so a typo is a quick fix rather than a retype.
    expect(email()).toHaveValue('layla@example.com');
  });

  it('does not send twice while a request is in flight', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'layla@example.com');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await user.click(submit());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(submit()).toHaveAttribute('aria-busy', 'true');
    release(json({ data: { accepted: true } }, 202));
    await screen.findByText('Check your email');
  });

  it.each([
    [
      'rate limited with a wait',
      apiError(429, 'rate_limited', { retryAfterSec: 1800 }),
      /Too many attempts\. Try again in 30 minutes\./,
    ],
    ['rate limited without a wait', apiError(429, 'rate_limited'), /Too many requests/],
    [
      'the server refusing the address',
      apiError(422, 'validation_failed', { issues: [{ path: 'email', message: 'x' }] }),
      undefined,
    ],
    ['a server error', apiError(500, 'internal'), /Something went wrong on our side/],
  ])('shows %s in words and keeps the form', async (_label, response, text) => {
    stubFetch(() => response.clone());
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'layla@example.com');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(submit()).not.toHaveAttribute('aria-busy', 'true'));
    if (text) expect(await screen.findByRole('alert')).toHaveTextContent(text);
    else expect(await screen.findByText(/Enter a valid email address/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Forgot your password?' }),
    ).toBeInTheDocument();
    expect(email()).toHaveValue('layla@example.com');
  });

  it('survives a dropped connection', async () => {
    stubFetch(() => Promise.reject(new TypeError('network down')));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />);
    await user.type(email(), 'layla@example.com');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("We can't reach the server");
  });

  it('is right to left and fully in Arabic', async () => {
    stubFetch(() => json({ data: { accepted: true } }, 202));
    const user = userEvent.setup();
    renderUi(<ForgotPasswordForm />, { locale: 'ar' });
    expect(
      screen.getByRole('heading', { level: 1, name: 'نسيت كلمة المرور؟' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إرسال رابط إعادة التعيين' })).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: /^البريد الإلكتروني/ }),
      'layla@example.com',
    );
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'تحقق من بريدك' }),
    ).toBeInTheDocument();
    // The address stays readable inside the Arabic sentence: wrapped in bidi isolates.
    expect(screen.getByText(/إن كان هناك حساب مرتبط بالبريد/).textContent).toContain(
      `${String.fromCodePoint(0x2066)}layla@example.com${String.fromCodePoint(0x2069)}`,
    );
  });

  it.each(['en', 'ar'] as const)(
    'has no accessibility violations in %s, form and result',
    async (locale) => {
      stubFetch(() => json({ data: { accepted: true } }, 202));
      const user = userEvent.setup();
      const { container } = renderUi(<ForgotPasswordForm />, { locale });
      expect(await axeViolations(container)).toEqual([]);
      await user.type(screen.getByRole('textbox'), 'layla@example.com');
      await user.keyboard('{Enter}');
      await screen.findByRole('status');
      expect(await axeViolations(container)).toEqual([]);
    },
  );
});
