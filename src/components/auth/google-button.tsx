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
import { GoogleLogo, OrDivider } from './google-parts';
import { isInAppBrowser } from './in-app-browser';
import { InAppBrowserNote } from './in-app-note';

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
      <OrDivider />
    </div>
  );
}
