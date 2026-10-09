'use client';

import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ConsentLine } from '@/components/legal/consent-line';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import type { FirebaseWebConfig } from '@/lib/firebase-config';
import { useI18n } from '@/lib/i18n/client';
import { safeNextPath } from '@/lib/next-path';
import {
  createFirebaseClient,
  isTouchDevice,
  loadedOutsideAuthPages,
  whenIdle,
  type FirebaseClient,
} from './firebase-client';
import {
  QUICK_CLOSE_MS,
  describeGoogleFailure,
  firebaseCodeOf,
  type GoogleFailure,
} from './google-error';
import { isInAppBrowser } from './in-app-browser';
import { InAppBrowserNote } from './in-app-note';

/** The official four-colour "G". Decorative: the button's text carries the meaning. */
function GoogleLogo() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-5">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

export interface GoogleSignInProps {
  /** The public Firebase identifiers; the page renders this only when the server has them. */
  config: FirebaseWebConfig;
  /** Where to go after signing in: already a safe, same-site path (checked again here). */
  next: string;
  /** Set on the sign-in page, where nothing else says that a first Google sign-in creates an account. */
  showConsent?: boolean;
  /** `id` of text that describes the button (the consent line on the register page). */
  describedBy?: string;
}

const noSubscription = () => () => undefined;

/**
 * "Continue with Google" with the "or" divider below it, to sit above the email form. One click:
 * Google popup, then the Firebase ID token goes to `POST /auth/firebase`, whose answer is the app's
 * own session cookie, and the page the person was heading for is loaded afresh (a full page load,
 * so that page's own, stricter security headers apply; see `AUTH_PAGE_PATHS`). Firebase is signed
 * out again whatever happened.
 *
 * Safari and mobile browsers only let a popup open straight after a tap, so Firebase must already
 * be initialized when the click comes (see `createFirebaseClient`): that starts on the first
 * pointer, focus or touch on the button, and on a touch screen also once the page is idle. The
 * click handler then reaches `signInWithPopup` without awaiting anything.
 *
 * Closing the popup says nothing, unless it closes within a second: that is a browser Google
 * refuses. A blocked popup, a refused token, a site that is not set up for Google and network
 * trouble each get their own sentence; an in-app browser (Instagram, TikTok ...) is told to open
 * the page in a real one.
 */
export function GoogleSignIn({ config, next, showConsent, describedBy }: GoogleSignInProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<GoogleFailure | null>(null);
  // State updates are asynchronous: a quick second click would pass a `busy` check once more.
  const running = useRef(false);
  // The ready Firebase client, once warming up has finished; what `start` reaches for first.
  const ready = useRef<FirebaseClient | null>(null);
  const warming = useRef<Promise<FirebaseClient | null> | null>(null);
  // The server renders without it; the browser's user agent is read after hydration, no mismatch.
  const inAppBrowser = useSyncExternalStore(
    noSubscription,
    () => isInAppBrowser(navigator.userAgent),
    () => false,
  );

  const warmUp = useCallback(() => {
    if (ready.current || warming.current) return;
    warming.current = createFirebaseClient(config).then(
      (client) => {
        ready.current = client;
        return client;
      },
      () => {
        // A failed download is not remembered: the next touch or the click tries again.
        warming.current = null;
        return null;
      },
    );
  }, [config]);

  useEffect(() => {
    if (loadedOutsideAuthPages()) {
      window.location.reload();
      return;
    }
    // A finger never "arrives" at a button before it taps it, so warm up on a touch screen as soon
    // as the page has settled.
    if (isTouchDevice()) return whenIdle(warmUp);
  }, [warmUp]);

  async function clientAfterWaiting(): Promise<FirebaseClient> {
    return (await warming.current) ?? createFirebaseClient(config);
  }

  async function start() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setFailure(null);
    const clickedAt = Date.now();
    let client: FirebaseClient | undefined;
    let signedIn = false;
    try {
      // With the client ready there is NO await before the popup opens (see above).
      client = ready.current ?? (await clientAfterWaiting());
      ready.current = client;
      const idToken = await client.signInWithGoogle();
      await api.post<unknown>('/auth/firebase', { idToken, locale });
      signedIn = true;
    } catch (error) {
      const described = describeGoogleFailure(error, i18n, {
        closedQuickly: Date.now() - clickedAt < QUICK_CLOSE_MS,
      });
      // The code alone (never the message, which may carry details), for whoever sets the site up.
      const code = firebaseCodeOf(error);
      if (code !== null && described !== null) console.warn(`Google sign-in failed: ${code}`);
      setFailure(described);
    } finally {
      await client?.signOut();
    }
    if (signedIn) {
      // Stay busy while the next page loads: no second click, no flash of the form. A full load,
      // not a client-side transition: the page we came from has the relaxed headers of the sign-in
      // pages, and the destination must run under its own.
      window.location.assign(safeNextPath(next));
      return;
    }
    running.current = false;
    setBusy(false);
  }

  const inAppFailure = failure?.inApp === true;
  return (
    <div className="grid gap-4">
      <Button
        variant="secondary"
        size="lg"
        fullWidth
        loading={busy}
        startIcon={<GoogleLogo />}
        aria-describedby={describedBy}
        onPointerEnter={warmUp}
        onFocus={warmUp}
        onTouchStart={warmUp}
        onClick={() => void start()}
      >
        {busy ? t('auth.google.busy') : t('auth.google.button')}
      </Button>
      {inAppBrowser && !inAppFailure ? (
        <InAppBrowserNote tone="note">{t('auth.google.inApp.note')}</InAppBrowserNote>
      ) : null}
      <div aria-live="polite" aria-atomic="true">
        {inAppFailure ? (
          <InAppBrowserNote tone="error">{failure.message}</InAppBrowserNote>
        ) : failure ? (
          <p className="flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 flex-1">{failure.message}</span>
          </p>
        ) : null}
      </div>
      {showConsent ? <ConsentLine /> : null}
      <div className="flex items-center gap-3 text-sm text-muted">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        <span>{t('auth.google.divider')}</span>
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
