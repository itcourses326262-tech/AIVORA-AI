import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const apps: Array<{ name: string; options: unknown }> = [];
  const authInstance = { kind: 'auth-instance' };
  const user = { getIdToken: vi.fn(async () => 'id-token-1') };
  return {
    apps,
    authInstance,
    user,
    initializeApp: vi.fn((options: unknown, name: string) => {
      const app = { name, options };
      apps.push(app);
      return app;
    }),
    getApps: vi.fn(() => apps),
    initializeAuth: vi.fn(() => authInstance),
    getAuth: vi.fn(() => authInstance),
    signInWithPopup: vi.fn(async (_auth: unknown, _provider: unknown) => ({ user })),
    signOut: vi.fn(async (_auth: unknown) => undefined),
    setCustomParameters: vi.fn(),
  };
});

vi.mock('@firebase/app', () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps }));
vi.mock('@firebase/auth', () => ({
  initializeAuth: sdk.initializeAuth,
  getAuth: sdk.getAuth,
  inMemoryPersistence: { type: 'NONE' },
  browserPopupRedirectResolver: { kind: 'popup-resolver' },
  GoogleAuthProvider: class {
    setCustomParameters = sdk.setCustomParameters;
  },
  signInWithPopup: sdk.signInWithPopup,
  signOut: sdk.signOut,
}));

import { AUTH_PAGE_PATHS } from '@/components/auth/firebase-client';
import { GoogleSignIn } from '@/components/auth/google-button';
import { LoginForm } from '@/components/auth/login-form';
import { RegisterForm } from '@/components/auth/register-form';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { axeViolations } from '../axe';
import { renderUi } from '../render';
import { apiError, bodyOf, json, router, stubFetch } from './support';

vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login' }));

const CONFIG: FirebaseWebConfig = {
  apiKey: 'k'.repeat(30),
  authDomain: 'test-project.firebaseapp.com',
  projectId: 'test-project',
};

class FirebaseAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** `window.location` with navigation recorded: jsdom cannot navigate. */
const location = { assign: vi.fn(), reload: vi.fn() };

beforeEach(() => {
  sdk.apps.length = 0;
  location.assign.mockReset();
  location.reload.mockReset();
  vi.stubGlobal('location', {
    ...window.location,
    href: 'http://localhost:3000/login?next=%2Fstudio',
    ...location,
  });
  router.replace.mockReset();
  router.refresh.mockReset();
  sdk.signInWithPopup.mockClear();
  sdk.signOut.mockReset().mockResolvedValue(undefined);
  sdk.initializeApp.mockClear();
  sdk.initializeAuth.mockClear();
  sdk.getAuth.mockClear();
  sdk.setCustomParameters.mockClear();
  sdk.initializeApp.mockImplementation((options: unknown, name: string) => {
    const app = { name, options };
    sdk.apps.push(app);
    return app;
  });
  sdk.user.getIdToken.mockReset().mockResolvedValue('id-token-1');
  sdk.signInWithPopup.mockResolvedValue({ user: sdk.user });
});
afterEach(() => {
  // Unmount first: the buttons clean up with the browser features the test gave this window.
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // Properties a test put on this window's navigator; the prototype's own values show again.
  for (const property of ['userAgent', 'maxTouchPoints']) {
    Reflect.deleteProperty(window.navigator, property);
  }
  Reflect.deleteProperty(window, 'requestIdleCallback');
  Reflect.deleteProperty(window, 'cancelIdleCallback');
});

const googleButton = () =>
  screen.getByRole('button', { name: /Continue with Google|Waiting for Google/ });
const mountButton = (
  props: Partial<Parameters<typeof GoogleSignIn>[0]> = {},
  locale: 'ar' | 'en' = 'en',
) => renderUi(<GoogleSignIn config={CONFIG} next="/gallery" {...props} />, { locale });

describe('visibility', () => {
  it('is not on the log in page without a Firebase configuration', () => {
    renderUi(<LoginForm next="/studio" />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
  });

  it('is not on the log in page with a null configuration either', () => {
    renderUi(<LoginForm next="/studio" firebase={null} />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });

  it('is not on the register page without a configuration', () => {
    renderUi(<RegisterForm next="/studio" bonus={50} signupOpen />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
    renderUi(<RegisterForm next="/studio" bonus={50} signupOpen firebase={null} />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });

  it('is above the email form on the log in page, with an "or" divider between them', () => {
    renderUi(<LoginForm next="/studio" firebase={CONFIG} />);
    const button = googleButton();
    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(button.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const divider = screen.getByText('or');
    expect(button.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(divider.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The heading stays first.
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is above the email form on the register page, with the consent line directly under it', () => {
    renderUi(<RegisterForm next="/studio" bonus={50} signupOpen firebase={CONFIG} />);
    const button = googleButton();
    expect(button.compareDocumentPosition(screen.getByRole('textbox', { name: 'Name' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const consent = screen.getByText(/By creating an account, you agree/);
    // Under the button, before the "or" divider and the first field of the form.
    expect(button.compareDocumentPosition(consent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const divider = screen.getByText('or');
    expect(
      consent.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(button).toHaveAccessibleDescription(/By creating an account, you agree/);
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Privacy Policy/ })).toBeInTheDocument();
    // The line has a fixed id, so it is on the page once; the submit button is described by it too.
    expect(screen.getAllByText(/By creating an account, you agree/)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Create account' })).toHaveAccessibleDescription(
      /By creating an account, you agree/,
    );
  });

  it('keeps the consent line above the submit button where Google is not offered', () => {
    renderUi(<RegisterForm next="/studio" bonus={50} signupOpen />);
    const consent = screen.getByText(/By creating an account, you agree/);
    const submit = screen.getByRole('button', { name: 'Create account' });
    expect(consent.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit).toHaveAccessibleDescription(/By creating an account, you agree/);
  });

  it('is not offered where registration is closed', () => {
    renderUi(<RegisterForm next="/studio" bonus={50} signupOpen={false} firebase={CONFIG} />);
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });

  it('says on the log in page that a first Google sign-in creates an account, with the terms', () => {
    renderUi(<LoginForm next="/studio" firebase={CONFIG} />);
    expect(screen.getByText(/By creating an account, you agree/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Terms of Service/ })).toBeInTheDocument();
  });
});

describe('the sign-in flow', () => {
  it('opens the Google popup, posts the ID token and goes to the next page, signing out of Firebase', async () => {
    const fetchMock = stubFetch(() => json({ data: { id: 'usr_1' } }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());

    await waitFor(() => expect(location.assign).toHaveBeenCalledExactlyOnceWith('/gallery'));
    // A full page load, not a client-side transition: the destination runs under its own headers.
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith(sdk.authInstance);

    // Firebase: one named app, the account chooser every time, nothing persisted.
    expect(sdk.initializeApp).toHaveBeenCalledExactlyOnceWith(CONFIG, 'aivore-google-signin');
    expect(sdk.initializeAuth).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'aivore-google-signin' }),
      {
        persistence: { type: 'NONE' },
        popupRedirectResolver: { kind: 'popup-resolver' },
      },
    );
    expect(sdk.setCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);

    // The app: the ID token to the session route, with the language of the page.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/auth/firebase');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
    expect(bodyOf(fetchMock)).toEqual({ idToken: 'id-token-1', locale: 'en' });
  });

  it('signs out of Firebase only after the token was handed over', async () => {
    const order: string[] = [];
    stubFetch(() => {
      order.push('post');
      return json({ data: {} });
    });
    sdk.signOut.mockImplementation(async () => {
      order.push('signOut');
    });
    location.assign.mockImplementation(() => void order.push('navigate'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    // Signing out of Firebase finishes before the page is left, or it could be cut off.
    expect(order).toEqual(['post', 'signOut', 'navigate']);
  });

  it('stays busy after success, while the next page loads', async () => {
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(googleButton()).toHaveAttribute('aria-busy', 'true');
    expect(googleButton()).toHaveTextContent('Waiting for Google…');
  });

  it('is busy while the popup is open and ignores a second click', async () => {
    let finish: (value: { user: typeof sdk.user }) => void = () => undefined;
    sdk.signInWithPopup.mockImplementation(
      () => new Promise((resolve) => (finish = resolve as typeof finish)),
    );
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.dblClick(googleButton());

    await waitFor(() => expect(googleButton()).toHaveAttribute('aria-busy', 'true'));
    await user.click(googleButton());
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);

    await act(async () => finish({ user: sdk.user }));
    await waitFor(() => expect(location.assign).toHaveBeenCalledTimes(1));
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
  });

  it('does not initialize Firebase twice for a second attempt', async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(new FirebaseAuthError('auth/popup-closed-by-user'));
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await waitFor(() => expect(googleButton()).not.toHaveAttribute('aria-busy'));
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['//evil.com'],
    ['https://evil.com'],
    ['/\\evil.com'],
    ['javascript:alert(1)'],
    ['/login'],
    [''],
  ])('never redirects to %j: it falls back to the studio', async (next) => {
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton({ next });
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalledExactlyOnceWith('/studio'));
  });

  it('follows a safe deep link with its query string', async () => {
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton({ next: '/gallery/gen_1?view=large' });
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/gallery/gen_1?view=large'));
  });

  it('sends the Arabic page language', async () => {
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton({}, 'ar');
    await user.click(screen.getByRole('button', { name: 'المتابعة باستخدام Google' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(bodyOf(fetchMock)).toEqual({ idToken: 'id-token-1', locale: 'ar' });
  });

  it('is not stopped by a failing Firebase sign-out', async () => {
    sdk.signOut.mockRejectedValue(new Error('storage unavailable'));
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('/gallery'));
    expect(sdk.signOut).toHaveBeenCalled();
  });
});

describe('when it does not work out', () => {
  const alertText = () => document.querySelector('[aria-live="polite"]')?.textContent ?? '';

  it.each(['auth/cancelled-popup-request', 'auth/user-cancelled'])(
    'says nothing when the person backs out (%s), signs out and can try again',
    async (code) => {
      sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError(code));
      const fetchMock = stubFetch(() => json({ data: {} }));
      const user = userEvent.setup();
      mountButton();
      await user.click(googleButton());

      await waitFor(() => expect(googleButton()).not.toHaveAttribute('aria-busy'));
      expect(alertText()).toBe('');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(location.assign).not.toHaveBeenCalled();
      expect(sdk.signOut).toHaveBeenCalledTimes(1);
      expect(googleButton()).toBeEnabled();
    },
  );

  /** The Google window closes `ms` after the click (a clock that only moves when told to). */
  function closePopupAfter(ms: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    sdk.signInWithPopup.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + ms);
      throw new FirebaseAuthError('auth/popup-closed-by-user');
    });
  }

  it('says nothing when the person closes the Google window after looking at it', async () => {
    closePopupAfter(1500);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchMock = stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());

    await waitFor(() => expect(googleButton()).not.toHaveAttribute('aria-busy'));
    expect(alertText()).toBe('');
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not stay silent when the Google window closes within a second of the click', async () => {
    closePopupAfter(300);
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());

    expect(await screen.findByText(/does not work inside this app's browser/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(googleButton()).toBeEnabled();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
  });

  it('draws the line at exactly one second', async () => {
    closePopupAfter(1000);
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await waitFor(() => expect(googleButton()).not.toHaveAttribute('aria-busy'));
    expect(alertText()).toBe('');
  });

  it('explains a blocked popup', async () => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/popup-blocked'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/blocked the Google window/)).toBeInTheDocument();
    expect(alertText()).toMatch(/Allow pop-ups for this site/);
    expect(location.assign).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalled();
  });

  it('explains it in Arabic too', async () => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/popup-blocked'));
    const user = userEvent.setup();
    mountButton({}, 'ar');
    await user.click(screen.getByRole('button', { name: 'المتابعة باستخدام Google' }));
    expect(await screen.findByText(/منع المتصفح نافذة Google/)).toBeInTheDocument();
  });

  it('reports Firebase trouble with the network as network trouble', async () => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/network-request-failed'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/can't reach the server/)).toBeInTheDocument();
  });

  it.each([
    'auth/unauthorized-domain',
    'auth/operation-not-allowed',
    'auth/invalid-api-key',
    'auth/configuration-not-found',
  ])('says the site is not set up for Google yet for the setup mistake %s', async (code) => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError(code));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(
      await screen.findByText(/Google sign-in is not set up for this site yet/),
    ).toBeInTheDocument();
    // No jargon for the visitor: the code is for the console.
    expect(alertText()).not.toMatch(/auth\/|domain|api key|firebase/i);
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
    expect(googleButton()).toBeEnabled();
  });

  it('says it in Arabic too for a setup mistake', async () => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/unauthorized-domain'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const user = userEvent.setup();
    mountButton({}, 'ar');
    await user.click(screen.getByRole('button', { name: 'المتابعة باستخدام Google' }));
    expect(
      await screen.findByText(/تسجيل الدخول عبر Google غير مُعدّ لهذا الموقع بعد/),
    ).toBeInTheDocument();
  });

  it.each(['auth/internal-error', 'auth/too-many-requests'])(
    'says plainly that it failed for %s',
    async (code) => {
      sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError(code));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const user = userEvent.setup();
      mountButton();
      await user.click(googleButton());
      expect(await screen.findByText(/could not sign you in with Google/)).toBeInTheDocument();
      expect(googleButton()).toBeEnabled();
    },
  );

  describe('what goes to the console', () => {
    it('is the Firebase error code and nothing else', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const error = new FirebaseAuthError('auth/unauthorized-domain');
      error.message =
        'Firebase: Error (auth/unauthorized-domain). Domain shop.example.test, key AIza-secret';
      sdk.signInWithPopup.mockRejectedValue(error);
      const user = userEvent.setup();
      mountButton();
      await user.click(googleButton());
      await screen.findByText(/not set up for this site yet/);

      expect(warn).toHaveBeenCalledExactlyOnceWith(
        'Google sign-in failed: auth/unauthorized-domain',
      );
    });

    it.each([
      ['a blocked popup', 'auth/popup-blocked'],
      ['an in-app browser', 'auth/operation-not-supported-in-this-environment'],
    ])('names the code for %s as well', async (_label, code) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError(code));
      const user = userEvent.setup();
      mountButton();
      await user.click(googleButton());
      await waitFor(() =>
        expect(warn).toHaveBeenCalledExactlyOnceWith(`Google sign-in failed: ${code}`),
      );
    });

    it('is quiet when the person backs out and for failures that are not Firebase codes', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      sdk.signInWithPopup.mockRejectedValueOnce(
        new FirebaseAuthError('auth/cancelled-popup-request'),
      );
      const user = userEvent.setup();
      mountButton();
      await user.click(googleButton());
      await waitFor(() => expect(googleButton()).not.toHaveAttribute('aria-busy'));

      sdk.signInWithPopup.mockRejectedValueOnce(new TypeError('x is not a function'));
      await user.click(googleButton());
      await screen.findByText(/could not sign you in with Google/);

      stubFetch(() => apiError(401, 'unauthorized'));
      await user.click(googleButton());
      await screen.findByText(/could not verify your Google sign-in/);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('in an embedded in-app browser', () => {
    it.each(['auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'])(
      'tells the person to open the page in their browser for %s',
      async (code) => {
        sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError(code));
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const user = userEvent.setup();
        mountButton();
        await user.click(googleButton());

        expect(
          await screen.findByText(/does not work inside this app's browser/),
        ).toBeInTheDocument();
        expect(alertText()).toMatch(/Open this page in your browser \(Chrome or Safari\)/);
        expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
        expect(screen.queryByText(/could not sign you in with Google/)).toBeNull();
        expect(googleButton()).toBeEnabled();
        expect(sdk.signOut).toHaveBeenCalledTimes(1);
      },
    );

    it('says it in Arabic', async () => {
      sdk.signInWithPopup.mockRejectedValue(
        new FirebaseAuthError('auth/operation-not-supported-in-this-environment'),
      );
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const user = userEvent.setup();
      mountButton({}, 'ar');
      await user.click(screen.getByRole('button', { name: 'المتابعة باستخدام Google' }));
      expect(
        await screen.findByText(/لا يعمل تسجيل الدخول عبر Google داخل متصفح هذا التطبيق/),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'نسخ الرابط' })).toBeInTheDocument();
    });

    const UNSUPPORTED = new FirebaseAuthError('auth/operation-not-supported-in-this-environment');
    const IN_APP_AGENTS: Array<[string, string]> = [
      [
        'Facebook on iOS',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 [FBAN/FBIOS;FBAV/450.0.0.38.108;FBBV/565;FBDV/iPhone15,2]',
      ],
      [
        'Facebook on Android',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UD1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.38.108;]',
      ],
      [
        'Instagram',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Instagram 330.0.0.20.114 (iPhone15,2; iOS 17_4; en_US)',
      ],
      [
        'TikTok',
        'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 musical_ly_2023 trill_330 BytedanceWebview/d8a21c6',
      ],
      [
        'TikTok on iOS',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 TikTok 33.0.0',
      ],
      [
        'Snapchat',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Snapchat/12.80.0.34 (like Safari/8618.1.15.10.11)',
      ],
      [
        'Twitter',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Twitter for iPhone/10.30',
      ],
      [
        'LINE',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 Safari Line/14.2.0',
      ],
      [
        'WhatsApp',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21E219 WhatsApp/24.10.80',
      ],
      [
        'an Android WebView',
        'Mozilla/5.0 (Linux; Android 12; moto g(30) Build/S1RLS32.74-23-18-1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/122.0.0.0 Mobile Safari/537.36',
      ],
    ];
    const REAL_BROWSERS: Array<[string, string]> = [
      [
        'Chrome on Android',
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      ],
      [
        'Safari on iOS',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      ],
      [
        'Chrome on Windows',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ],
      [
        'Firefox',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
      ],
      [
        'Samsung Internet',
        'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
      ],
    ];
    const withUserAgent = (userAgent: string) =>
      Object.defineProperty(window.navigator, 'userAgent', {
        value: userAgent,
        configurable: true,
      });

    it.each(IN_APP_AGENTS)('shows the note up front inside %s', (_label, userAgent) => {
      withUserAgent(userAgent);
      mountButton();
      expect(screen.getByText(/Opened this page inside another app\?/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
      // The Google button stays: some of these browsers do work.
      expect(googleButton()).toBeEnabled();
    });

    it.each(REAL_BROWSERS)('shows nothing extra in %s', (_label, userAgent) => {
      withUserAgent(userAgent);
      mountButton();
      expect(screen.queryByText(/Opened this page inside another app/)).toBeNull();
      expect(screen.queryByRole('button', { name: /Copy link/ })).toBeNull();
    });

    it('shows the note in Arabic, and the Arabic copy button', () => {
      withUserAgent(IN_APP_AGENTS[2]?.[1] ?? '');
      mountButton({}, 'ar');
      expect(screen.getByText(/فتحت هذه الصفحة داخل تطبيق آخر؟/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'نسخ الرابط' })).toBeInTheDocument();
    });

    it('replaces the note with the error when the sign-in fails there: one block, not two', async () => {
      withUserAgent(IN_APP_AGENTS[2]?.[1] ?? '');
      sdk.signInWithPopup.mockRejectedValue(UNSUPPORTED);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const user = userEvent.setup();
      mountButton();
      expect(screen.getByText(/Opened this page inside another app/)).toBeInTheDocument();
      await user.click(googleButton());
      await screen.findByText(/does not work inside this app's browser/);
      expect(screen.queryByText(/Opened this page inside another app/)).toBeNull();
      expect(screen.getAllByRole('button', { name: 'Copy link' })).toHaveLength(1);
    });

    it('copies the address of the page', async () => {
      withUserAgent(IN_APP_AGENTS[0]?.[1] ?? '');
      const user = userEvent.setup();
      mountButton();
      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(
        await screen.findByText('Link copied. Paste it into your browser.'),
      ).toBeInTheDocument();
      expect(await navigator.clipboard.readText()).toBe(
        'http://localhost:3000/login?next=%2Fstudio',
      );
    });

    it('shows the link to copy by hand where the browser refuses to copy', async () => {
      withUserAgent(IN_APP_AGENTS[0]?.[1] ?? '');
      const user = userEvent.setup();
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      mountButton();
      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      expect(await screen.findByText(/Could not copy/)).toBeInTheDocument();
      const field = screen.getByRole('textbox', { name: 'Page link' });
      expect(field).toHaveValue('http://localhost:3000/login?next=%2Fstudio');
      expect(field).toHaveAttribute('readonly');
      expect(field).toHaveAttribute('dir', 'ltr');
    });

    it('passes axe with the note, with the error and with the link to copy', async () => {
      withUserAgent(IN_APP_AGENTS[0]?.[1] ?? '');
      sdk.signInWithPopup.mockRejectedValue(UNSUPPORTED);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const user = userEvent.setup();
      const { container } = mountButton();
      expect(await axeViolations(container)).toEqual([]);
      await user.click(googleButton());
      await screen.findByText(/does not work inside this app's browser/);
      expect(await axeViolations(container)).toEqual([]);
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
      await user.click(screen.getByRole('button', { name: 'Copy link' }));
      await screen.findByRole('textbox', { name: 'Page link' });
      expect(await axeViolations(container)).toEqual([]);
    });
  });

  it('says it when the Firebase code could not be loaded or something else broke', async () => {
    sdk.signInWithPopup.mockRejectedValue(new TypeError('x is not a function'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/could not sign you in with Google/)).toBeInTheDocument();
  });

  it('says it when the token was not accepted (401), not "wrong password"', async () => {
    stubFetch(() => apiError(401, 'unauthorized'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/could not verify your Google sign-in/)).toBeInTheDocument();
    expect(screen.queryByText(/password/i)).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(googleButton()).toBeEnabled();
  });

  it('says it when the account is disabled (403)', async () => {
    stubFetch(() => apiError(403, 'forbidden'));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/This account is disabled/)).toBeInTheDocument();
  });

  it('shows how long to wait after a rate limit', async () => {
    stubFetch(() => apiError(429, 'rate_limited', { retryAfterSec: 45 }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/Try again in 45 seconds/)).toBeInTheDocument();
  });

  it.each([
    [403, 'signup_disabled', /registrations are currently closed/i],
    [422, 'email_not_allowed', /disposable email addresses/i],
    [429, 'signup_limit', /Too many accounts were created/],
    [503, 'service_busy', /under heavy load/],
    [500, 'internal', /went wrong on our side/],
  ])('maps the server error %i %s to its sentence', async (status, code, text) => {
    stubFetch(() => apiError(status, code));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('maps a network failure of the request to the network sentence and signs out', async () => {
    stubFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    expect(await screen.findByText(/can't reach the server/)).toBeInTheDocument();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(googleButton()).toBeEnabled();
  });

  it('keeps errors in a polite live region that exists before the error does', async () => {
    mountButton();
    const region = document.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region).toBeEmptyDOMElement();
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/popup-blocked'));
    const user = userEvent.setup();
    await user.click(googleButton());
    await waitFor(() => expect(region).not.toBeEmptyDOMElement());
    expect(document.querySelector('[aria-live="polite"]')).toBe(region);
  });

  it('clears the previous error when it tries again', async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(new FirebaseAuthError('auth/popup-blocked'));
    stubFetch(() => json({ data: {} }));
    const user = userEvent.setup();
    mountButton();
    await user.click(googleButton());
    await screen.findByText(/blocked the Google window/);
    await user.click(googleButton());
    await waitFor(() => expect(screen.queryByText(/blocked the Google window/)).toBeNull());
  });
});

describe('Firebase is ready before the click (Safari and phones only open a popup right after a tap)', () => {
  const settle = () => act(async () => undefined);
  const warmedUp = async () => {
    await waitFor(() => expect(sdk.initializeAuth).toHaveBeenCalled());
    await settle();
  };

  it('does nothing on a desktop until the pointer reaches the button', async () => {
    mountButton();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sdk.initializeApp).not.toHaveBeenCalled();
    expect(sdk.initializeAuth).not.toHaveBeenCalled();
  });

  it.each([
    ['the pointer reaching the button', (button: HTMLElement) => fireEvent.pointerEnter(button)],
    ['keyboard focus', (button: HTMLElement) => fireEvent.focus(button)],
    ['the first touch', (button: HTMLElement) => fireEvent.touchStart(button)],
  ])('initializes Firebase Auth on %s, without opening any popup', async (_label, touch) => {
    mountButton();
    touch(googleButton());
    await warmedUp();
    expect(sdk.initializeApp).toHaveBeenCalledExactlyOnceWith(CONFIG, 'aivore-google-signin');
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithPopup).not.toHaveBeenCalled();
  });

  it('opens the popup in the click itself, with nothing awaited before it', async () => {
    stubFetch(() => json({ data: {} }));
    mountButton();
    fireEvent.pointerEnter(googleButton());
    await warmedUp();

    fireEvent.click(googleButton());
    // Synchronously, in the same turn of the event loop as the click.
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
  });

  it('initializes only once however often the button is touched, and a click reuses it', async () => {
    stubFetch(() => json({ data: {} }));
    mountButton();
    for (const touch of [fireEvent.pointerEnter, fireEvent.focus, fireEvent.touchStart]) {
      touch(googleButton());
      touch(googleButton());
    }
    await warmedUp();
    fireEvent.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
  });

  it('still works for a click that comes before anything was warmed up: it waits, then opens the popup', async () => {
    stubFetch(() => json({ data: {} }));
    mountButton();
    fireEvent.click(googleButton());
    await waitFor(() => expect(sdk.signInWithPopup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
  });

  it('keeps the client for the next attempt after a failed one', async () => {
    sdk.signInWithPopup.mockRejectedValueOnce(new FirebaseAuthError('auth/popup-blocked'));
    stubFetch(() => json({ data: {} }));
    mountButton();
    fireEvent.pointerEnter(googleButton());
    await warmedUp();
    fireEvent.click(googleButton());
    await screen.findByText(/blocked the Google window/);
    // The second attempt opens the popup in the click too.
    fireEvent.click(googleButton());
    expect(sdk.signInWithPopup).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failed warm-up: the next touch and the click try again', async () => {
    sdk.initializeApp.mockImplementationOnce(() => {
      throw new Error('chunk failed to load');
    });
    stubFetch(() => json({ data: {} }));
    mountButton();
    fireEvent.pointerEnter(googleButton());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    // Nothing was said to the person about a warm-up that did not work.
    expect(document.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
    expect(sdk.initializeAuth).not.toHaveBeenCalled();

    fireEvent.click(googleButton());
    await waitFor(() => expect(location.assign).toHaveBeenCalled());
    expect(sdk.initializeAuth).toHaveBeenCalledTimes(1);
  });

  describe('on a touch screen, where no pointer ever hovers', () => {
    function touchScreen(idle: 'idle-callback' | 'none') {
      Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
      const callbacks: Array<() => void> = [];
      if (idle === 'idle-callback') {
        Object.defineProperty(window, 'requestIdleCallback', {
          value: (callback: () => void) => callbacks.push(callback),
          configurable: true,
        });
        Object.defineProperty(window, 'cancelIdleCallback', {
          value: vi.fn(),
          configurable: true,
        });
      }
      return callbacks;
    }

    it('initializes when the browser is idle after the page was shown, before any touch', async () => {
      const idle = touchScreen('idle-callback');
      mountButton();
      expect(sdk.initializeAuth).not.toHaveBeenCalled();
      expect(idle).toHaveLength(1);
      act(() => idle[0]?.());
      await warmedUp();
      expect(sdk.initializeApp).toHaveBeenCalledTimes(1);
      expect(sdk.signInWithPopup).not.toHaveBeenCalled();
    });

    it('uses a short timer where there is no idle callback (Safari)', async () => {
      touchScreen('none');
      const timer = vi.spyOn(window, 'setTimeout');
      mountButton();
      const warmUpTimer = timer.mock.calls.find(([, delay]) => delay === 1500);
      expect(warmUpTimer).toBeDefined();
      act(() => (warmUpTimer?.[0] as () => void)());
      await warmedUp();
    });

    it('cancels the idle warm-up when the button goes away', () => {
      touchScreen('idle-callback');
      const { unmount } = mountButton();
      unmount();
      expect(window.cancelIdleCallback).toHaveBeenCalledTimes(1);
    });

    it('does not warm up a page that is about to reload', () => {
      const idle = touchScreen('idle-callback');
      vi.spyOn(performance, 'getEntriesByType').mockImplementation(
        () => [{ name: 'http://localhost:3000/studio' }] as unknown as PerformanceEntryList,
      );
      mountButton();
      expect(location.reload).toHaveBeenCalled();
      expect(idle).toHaveLength(0);
    });
  });
});

describe('the page it runs on', () => {
  function stubLoadedDocument(url: string | null) {
    vi.spyOn(performance, 'getEntriesByType').mockImplementation((type: string) =>
      type === 'navigation' && url !== null
        ? ([{ name: url }] as unknown as PerformanceEntryList)
        : [],
    );
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    return reload;
  }

  it('reloads once when the page was reached by a client-side transition from elsewhere', () => {
    const reload = stubLoadedDocument('http://localhost:3000/studio');
    mountButton();
    expect(reload).toHaveBeenCalled();
  });

  it.each(['/login', '/register', '/login?next=%2Fstudio', '/register?next=%2Fgallery'])(
    'does not reload when the loaded document is %s',
    (path) => {
      const reload = stubLoadedDocument(`http://localhost:3000${path}`);
      mountButton();
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it('does not reload where the browser keeps no navigation entry', () => {
    const reload = stubLoadedDocument(null);
    mountButton();
    expect(reload).not.toHaveBeenCalled();
  });

  it('knows the same pages as the header rule', () => {
    expect([...AUTH_PAGE_PATHS]).toEqual(['/login', '/register']);
  });
});

describe('look and feel', () => {
  it('has a touch target of at least 44px', () => {
    mountButton();
    // `h-12` is 48px at every pointer type; the small sizes are the ones that need `pointer-coarse`.
    expect(googleButton().className).toMatch(/\bh-12\b/);
    expect(googleButton().className).toMatch(/\bw-full\b/);
  });

  it('draws the Google "G" in the four official colours, hidden from assistive technology', () => {
    const { container } = mountButton();
    const svg = container.querySelector('button svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    const fills = [...(svg?.querySelectorAll('path') ?? [])].map((p) => p.getAttribute('fill'));
    expect(fills.toSorted()).toEqual(['#34A853', '#4285F4', '#EA4335', '#FBBC05']);
  });

  it('uses logical (start/end) spacing only, so it mirrors in right-to-left', () => {
    const { container } = renderUi(<LoginForm next="/studio" firebase={CONFIG} />, {
      locale: 'ar',
    });
    const googleSection = screen.getByRole('button', { name: 'المتابعة باستخدام Google' })
      .parentElement?.parentElement;
    const html = googleSection?.outerHTML ?? '';
    expect(html).not.toMatch(
      /\b(?:ml|mr|pl|pr|left|right)-|text-(?:left|right)|float-(?:left|right)/,
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(container).toBeDefined();
  });

  it('shows Arabic text on the Arabic page: the button and the divider', () => {
    renderUi(<LoginForm next="/studio" firebase={CONFIG} />, { locale: 'ar' });
    expect(screen.getByRole('button', { name: 'المتابعة باستخدام Google' })).toBeInTheDocument();
    expect(screen.getByText('أو')).toBeInTheDocument();
  });
});

describe('accessibility', () => {
  it('passes axe on the log in page with the button, in English and Arabic', async () => {
    for (const locale of ['en', 'ar'] as const) {
      const { container, unmount } = renderUi(<LoginForm next="/studio" firebase={CONFIG} />, {
        locale,
      });
      expect(await axeViolations(container)).toEqual([]);
      unmount();
    }
  });

  it('passes axe on the register page with the button', async () => {
    const { container } = renderUi(
      <RegisterForm next="/studio" bonus={50} signupOpen firebase={CONFIG} />,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it('passes axe while showing an error and while busy', async () => {
    sdk.signInWithPopup.mockRejectedValue(new FirebaseAuthError('auth/popup-blocked'));
    const user = userEvent.setup();
    const { container } = mountButton();
    await user.click(googleButton());
    await screen.findByText(/blocked the Google window/);
    expect(await axeViolations(container)).toEqual([]);

    sdk.signInWithPopup.mockImplementation(() => new Promise(() => undefined));
    await user.click(googleButton());
    await waitFor(() => expect(googleButton()).toHaveAttribute('aria-busy', 'true'));
    expect(await axeViolations(container)).toEqual([]);
    expect(within(container).getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});
