'use client';

import { MailWarning } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { formatWait } from '@/components/auth/auth-error';
import { isolateLtr } from '@/components/auth/bidi';
import { retryAfterOf } from '@/components/auth/recovery-error';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/components/ui/error-message';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';
import { useOptionalUser } from '@/lib/user-context';

export interface VerifyEmailBannerProps {
  /** The address the confirmation link goes to. */
  email: string;
  /** Free credits that confirming unlocks (0 or less: the banner does not mention them). */
  bonusCredits?: number;
  /** Seconds before a new link may be requested (the server's resend gap, already running). */
  resendAfterSec?: number;
}

interface RequestResult {
  sent: boolean;
  verified: boolean;
  resendAfterSec: number;
}

/** Re-checks the account while the banner is up, at most this often, when the tab comes back. */
const RECHECK_MS = 15_000;

/*
 * The gap the server keeps between two confirmation links (60 seconds) is ONE thing on a page that
 * has several buttons asking for a link: the banner above the page, the Studio's notice, the price
 * list's notice. They share it here, so a request made through one, the gap the server rendered
 * into the layout, or a "too soon" answer shows up as the same countdown on all of them (a button
 * that looked usable and then met a 429 was the defect). The state lives outside React, in the
 * browser's copy of this module, and is only ever written from effects and event handlers, so the
 * server render (which has no gap of its own to share) never sees another visitor's.
 */

/** When the server will accept the next request (epoch ms); 0 while nothing is known. */
let notBefore = 0;
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | undefined;

/** Whole seconds left of the gap; -1 while nothing is known. */
function secondsLeft(): number {
  return notBefore === 0 ? -1 : Math.max(0, Math.ceil((notBefore - Date.now()) / 1000));
}

function stopTicking() {
  if (ticker === undefined) return;
  clearInterval(ticker);
  ticker = undefined;
}

/** One timer for all buttons, running only while somebody listens and there is time left. */
function startTicking() {
  if (ticker !== undefined || listeners.size === 0 || secondsLeft() <= 0) return;
  ticker = setInterval(() => {
    for (const listener of listeners) listener();
    if (secondsLeft() <= 0) stopTicking();
  }, 1000);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  startTicking();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopTicking();
  };
}

/**
 * Starts the gap (`seconds` from now). With `keepLonger` a gap that is running and ends later is
 * left alone: the layout's value is old news next to a request made a moment ago.
 */
function startGap(seconds: number, { keepLonger = false } = {}) {
  const until = Date.now() + Math.max(0, seconds) * 1000;
  if (keepLonger && until <= notBefore) return;
  notBefore = until;
  for (const listener of listeners) listener();
  startTicking();
}

/** Tests start every case without a gap (the module outlives a test, the page does not). */
export function resetResendCooldownForTests() {
  notBefore = 0;
  stopTicking();
}

export interface ResendVerification {
  /** Seconds until another link may be requested (0: now). */
  remaining: number;
  busy: boolean;
  resend: () => void;
  /** "Resend link" or "Resend in 42 seconds". */
  label: string;
}

/**
 * Asking for a new confirmation link, as the banner, the studio and the price list all do it: one
 * request at a time, the server's 60 second gap shown as a countdown shared by all of them (also
 * when the server says "too soon" with its own `retryAfterSec`), a toast for the outcome.
 * `onVerified` runs when the server says the address is confirmed already (it was, in another
 * tab): the caller refreshes whatever shows the unconfirmed state. `initialWaitSec` is the gap that
 * is already running when the page is rendered (only the layout knows it): it is what the first
 * render, which is also the server's, shows, and it is handed to the buttons that do not know it.
 */
export function useResendVerification(
  onVerified: () => void,
  initialWaitSec: number = 0,
): ResendVerification {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const known = useSyncExternalStore(subscribe, secondsLeft, () => -1);
  const remaining = known < 0 ? Math.max(0, Math.ceil(initialWaitSec)) : known;

  useEffect(() => {
    if (initialWaitSec > 0) startGap(Math.ceil(initialWaitSec), { keepLonger: true });
  }, [initialWaitSec]);

  const resend = useCallback(() => {
    if (remaining > 0) return;
    setBusy(true);
    api
      .post<RequestResult>('/auth/verify-email/request')
      .then((result) => {
        if (result.verified) {
          onVerified();
          return;
        }
        startGap(result.resendAfterSec);
        toast.success(t('auth.banner.sent'));
      })
      .catch((error: unknown) => {
        const seconds = retryAfterOf(error);
        if (seconds !== undefined) startGap(seconds);
        toast.error(
          seconds === undefined
            ? errorMessage(t, error)
            : t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) }),
        );
      })
      .finally(() => setBusy(false));
  }, [locale, onVerified, remaining, t]);

  const label =
    remaining > 0
      ? t('auth.banner.resendIn', { time: formatWait(remaining, locale) })
      : t('auth.banner.resend');
  return { remaining, busy, resend, label };
}

/**
 * Shown at the top of the signed-in app to an account that has not confirmed its email while the
 * server requires it (the server decides; the layout renders this only then). Offers "resend" with
 * the server's 60 second gap shown as a countdown, and goes away by itself once the link was used
 * in another tab or on a phone: it follows the account that `useUser()` keeps current (which
 * re-reads it a few seconds after the window or the tab comes back) and, when the account turns
 * out to be confirmed, asks the server render to drop it as well. It re-reads the page when the
 * tab becomes visible too, so the content below it catches up.
 */
export function VerifyEmailBanner({
  email,
  bonusCredits = 0,
  resendAfterSec = 0,
}: VerifyEmailBannerProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const router = useRouter();
  const refreshPage = useCallback(() => router.refresh(), [router]);
  const { remaining, busy, resend, label } = useResendVerification(refreshPage, resendAfterSec);
  // The page around the banner already follows the account; showing "confirm to claim your bonus"
  // above a balance of 50 and an enabled Generate button would contradict it.
  const session = useOptionalUser();
  const confirmedMeanwhile =
    session !== null && session.user !== null && !session.emailConfirmationNeeded;
  useEffect(() => {
    if (confirmedMeanwhile) router.refresh();
  }, [confirmedMeanwhile, router]);

  useEffect(() => {
    let last = Date.now();
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < RECHECK_MS) return;
      last = Date.now();
      router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [router]);

  if (confirmedMeanwhile) return null;

  const shownEmail = isolateLtr(email);
  const message =
    bonusCredits > 0
      ? t('auth.banner.messageBonus', {
          email: shownEmail,
          credits: creditsLabel(i18n, bonusCredits),
        })
      : t('auth.banner.message', { email: shownEmail });

  return (
    <div
      role="region"
      aria-label={t('auth.banner.label')}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-warning/30 bg-warning-soft px-4 py-2.5 text-sm text-foreground sm:px-6"
    >
      <MailWarning aria-hidden="true" className="size-5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 basis-64 break-words">{message}</p>
      <Button
        size="sm"
        variant="secondary"
        loading={busy}
        disabled={remaining > 0}
        onClick={resend}
        className="shrink-0"
      >
        {label}
      </Button>
    </div>
  );
}
