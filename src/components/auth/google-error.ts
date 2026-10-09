import { isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import type { Translator } from '@/lib/i18n';
import { describeAuthFailure } from './auth-error';

/** What the Firebase SDK threw (`auth/popup-closed-by-user`, ...); the SDK is not imported here. */
export function firebaseCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const { code } = error as { code: unknown };
  return typeof code === 'string' && code.startsWith('auth/') ? code : null;
}

/** The person closed the window or clicked again: nothing went wrong, so nothing is said. */
const SILENT = new Set([
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/user-cancelled',
]);

/**
 * Mistakes in the Firebase project or in this site's settings (a domain that is not authorized, a
 * sign-in method that is not switched on, a wrong key). Nothing a visitor can do: the sentence says
 * so without technical words, and the code itself goes to the console for whoever sets the site up.
 */
const NOT_CONFIGURED = new Set([
  'auth/unauthorized-domain',
  'auth/operation-not-allowed',
  'auth/invalid-api-key',
  'auth/configuration-not-found',
]);

/**
 * What an embedded in-app browser (the one inside Instagram, Facebook, TikTok ...) answers with: it
 * cannot open the popup or keep the web storage the SDK needs. Trying again can never work there.
 */
const IN_APP_BROWSER = new Set([
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

/**
 * A popup that is closed this soon after the click was not closed by a person: Google's page for a
 * refused browser (or a browser that blocks the window) goes away at once. Reading a Google page
 * and closing it takes longer than this.
 */
export const QUICK_CLOSE_MS = 1000;

export interface GoogleFailure {
  message: string;
  /** The sentence is about opening the page in a real browser: the page offers to copy the link. */
  inApp: boolean;
}

export interface GoogleFailureContext {
  /** The popup was closed within {@link QUICK_CLOSE_MS} of the click. */
  closedQuickly?: boolean;
}

/**
 * The text for a failed Google sign-in, or null when the person simply backed out. Firebase codes
 * come first; everything else is a failed request to this app and goes through the same code to
 * text mapping as the other forms, except that a 401 means "the Google sign-in was not accepted"
 * (not "wrong password") and a 403 means a disabled account.
 */
export function describeGoogleFailure(
  error: unknown,
  { t, locale }: Pick<Translator, 't' | 'locale'>,
  { closedQuickly = false }: GoogleFailureContext = {},
): GoogleFailure | null {
  const plain = (message: string): GoogleFailure => ({ message, inApp: false });
  const inApp = (): GoogleFailure => ({
    message: t('auth.google.errors.inAppBrowser'),
    inApp: true,
  });

  const firebase = firebaseCodeOf(error);
  if (firebase !== null) {
    if (firebase === 'auth/popup-closed-by-user' && closedQuickly) return inApp();
    if (SILENT.has(firebase)) return null;
    if (IN_APP_BROWSER.has(firebase)) return inApp();
    if (NOT_CONFIGURED.has(firebase)) return plain(t('auth.google.errors.notConfigured'));
    if (firebase === 'auth/popup-blocked') return plain(t('auth.google.errors.popupBlocked'));
    if (firebase === 'auth/network-request-failed') return plain(t('errors.network_error'));
    return plain(t('auth.google.errors.failed'));
  }

  // Not a failed request: the SDK chunk did not load, or something unexpected broke in the browser.
  if (!isApiError(error)) return plain(t('auth.google.errors.failed'));

  const code = errorCodeOf(error);
  if (code === 'unauthorized') return plain(t('auth.google.errors.verifyFailed'));
  if (code === 'forbidden') return plain(t('auth.google.errors.disabled'));
  const failure = describeAuthFailure(error, 'login', { t, locale });
  return plain(failure.form ?? t(`errors.${code}`));
}
