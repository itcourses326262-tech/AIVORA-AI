import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as FirebaseClientModule from '@/components/auth/firebase-client';

// The placeholder must never reach Firebase: any use of the client is a failure.
const firebase = vi.hoisted(() => ({ create: vi.fn(), preload: vi.fn() }));
vi.mock('@/components/auth/firebase-client', async (importOriginal) => ({
  ...(await importOriginal<typeof FirebaseClientModule>()),
  createFirebaseClient: firebase.create,
  preloadFirebase: firebase.preload,
}));

import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { router, stubFetch } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));

const CONFIG: FirebaseWebConfig = {
  apiKey: 'k'.repeat(30),
  authDomain: 'test-project.firebaseapp.com',
  projectId: 'test-project',
};

const COMMAND = 'npm run setup:firebase -- --signin-only';
const POWERSHELL = 'npm.cmd run setup:firebase -- --signin-only';

beforeEach(() => {
  firebase.create.mockReset();
  firebase.preload.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const placeholder = () => screen.getByRole('button', { name: 'Continue with Google' });
const mountLogin = (props: Partial<Parameters<typeof LoginForm>[0]> = {}, locale?: 'ar' | 'en') =>
  renderUi(<LoginForm next="/studio" googlePlaceholder {...props} />, { locale });
const mountRegister = (
  props: Partial<Parameters<typeof RegisterForm>[0]> = {},
  locale?: 'ar' | 'en',
) =>
  renderUi(<RegisterForm next="/studio" bonus={0} signupOpen googlePlaceholder {...props} />, {
    locale,
  });

describe('the placeholder where the Google button will be', () => {
  it.each([
    ['log in', mountLogin],
    ['sign up', mountRegister],
  ])('shows on the %s page, dashed, with the command that sets sign-in up', (_name, mount) => {
    mount();
    const button = placeholder();
    const box = button.parentElement as HTMLElement;
    expect(box.className).toContain('border-dashed');
    const codes = [...box.querySelectorAll('code')];
    expect(codes.map((code) => code.textContent)).toEqual([COMMAND, POWERSHELL]);
    // A command reads left to right whatever the language of the page.
    for (const code of codes) expect(code).toHaveAttribute('dir', 'ltr');
    expect(box).toHaveTextContent('Developer note');
    expect(box).toHaveTextContent('Google sign-in is not set up yet. Run:');
    expect(box).toHaveTextContent('In PowerShell:');
    expect(box).toHaveTextContent('Then reload this page.');
  });

  it('is not a working button: disabled for assistive technology, explained, and inert', async () => {
    const fetchMock = stubFetch(() => new Response(null, { status: 204 }));
    const user = userEvent.setup();
    mountLogin();
    const button = placeholder();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    // Still focusable, so a keyboard or screen reader user finds the explanation.
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAccessibleDescription(/Google sign-in is not set up yet/);
    expect(button).toHaveAccessibleDescription(expect.stringContaining(COMMAND));

    await user.hover(button);
    await user.click(button);
    await user.keyboard('{Enter}');
    button.focus();
    await user.keyboard(' ');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(firebase.create).not.toHaveBeenCalled();
    expect(firebase.preload).not.toHaveBeenCalled();
    // The email form is untouched by it.
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('');
  });

  it('sits above the email form with the "or" divider between them, like the real button', () => {
    mountLogin();
    const email = screen.getByRole('textbox', { name: 'Email' });
    const divider = screen.getByText('or');
    expect(
      placeholder().compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(divider.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the consent line where the real button puts it: once, under the placeholder', () => {
    mountRegister();
    expect(document.querySelectorAll('#legal-consent')).toHaveLength(1);
    const consent = document.getElementById('legal-consent') as HTMLElement;
    expect(
      placeholder().compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      consent.compareDocumentPosition(screen.getByText('or')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The register button is still described by it, and so is the placeholder.
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAttribute(
      'aria-describedby',
      'legal-consent',
    );
    expect(placeholder().getAttribute('aria-describedby')).toContain('legal-consent');
  });

  it('the sign-in page shows the consent line under it too (a first Google sign-in creates an account)', () => {
    mountLogin();
    expect(document.querySelectorAll('#legal-consent')).toHaveLength(1);
  });

  it.each([
    ['log in', () => renderUi(<LoginForm next="/studio" />)],
    ['sign up', () => renderUi(<RegisterForm next="/studio" bonus={0} signupOpen />)],
    [
      'log in, switched off',
      () => renderUi(<LoginForm next="/studio" googlePlaceholder={false} />),
    ],
    [
      'sign up, closed',
      () =>
        renderUi(<RegisterForm next="/studio" bonus={0} signupOpen={false} googlePlaceholder />),
    ],
  ])('is not there on the %s page without the flag from the server', (_name, mount) => {
    mount();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByText(/not set up yet/)).toBeNull();
    expect(document.querySelector('.border-dashed')).toBeNull();
  });

  it.each([
    ['log in', mountLogin],
    ['sign up', mountRegister],
  ])(
    'gives way to the real button on the %s page once the identifiers are there',
    (_name, mount) => {
      mount({ firebase: CONFIG });
      expect(placeholder()).not.toHaveAttribute('aria-disabled');
      expect(screen.queryByText(/not set up yet/)).toBeNull();
      expect(document.querySelectorAll('code')).toHaveLength(0);
      expect(document.querySelectorAll('#legal-consent')).toHaveLength(1);
    },
  );

  it('is in Arabic, right to left, with the commands still left to right', () => {
    mountLogin({}, 'ar');
    const button = screen.getByRole('button', { name: 'المتابعة باستخدام Google' });
    const box = button.parentElement as HTMLElement;
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(box).toHaveTextContent('ملاحظة للمطوّر');
    expect(box).toHaveTextContent('تسجيل الدخول عبر Google غير مُعدّ بعد. شغّل:');
    expect(box).toHaveTextContent('في PowerShell:');
    expect(box).toHaveTextContent('ثم أعد تحميل هذه الصفحة');
    expect([...box.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
      COMMAND,
      POWERSHELL,
    ]);
    for (const code of box.querySelectorAll('code')) expect(code).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('أو')).toBeInTheDocument();
  });

  it('has no accessibility violations, in English and in Arabic', async () => {
    const english = mountRegister();
    expect(await axeViolations(english.container)).toEqual([]);
    english.unmount();
    const arabic = mountLogin({}, 'ar');
    expect(await axeViolations(arabic.container)).toEqual([]);
  });
});
