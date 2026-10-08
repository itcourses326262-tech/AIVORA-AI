'use client';

import { MailWarning } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { formatWait } from '@/components/auth/auth-error';
import { isolateLtr } from '@/components/auth/bidi';
import { retryAfterOf } from '@/components/auth/recovery-error';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/components/ui/error-message';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n/client';

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

/**
 * Shown at the top of the signed-in app to an account that has not confirmed its email while the
 * server requires it (the server decides; the layout renders this only then). Offers "resend" with
 * the server's 60 second gap shown as a countdown, and re-reads the page when the tab regains
 * focus so the banner disappears once the link was used in another tab or on a phone.
 */
export function VerifyEmailBanner({
  email,
  bonusCredits = 0,
  resendAfterSec = 0,
}: VerifyEmailBannerProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const router = useRouter();
  const [remaining, setRemaining] = useState(Math.max(0, Math.ceil(resendAfterSec)));
  const [busy, setBusy] = useState(false);

  const counting = remaining > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setRemaining((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [counting]);

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

  function resend() {
    setBusy(true);
    api
      .post<RequestResult>('/auth/verify-email/request')
      .then((result) => {
        if (result.verified) {
          router.refresh();
          return;
        }
        setRemaining(result.resendAfterSec);
        toast.success(t('auth.banner.sent'));
      })
      .catch((error: unknown) => {
        const seconds = retryAfterOf(error);
        if (seconds !== undefined) setRemaining(seconds);
        toast.error(
          seconds === undefined
            ? errorMessage(t, error)
            : t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) }),
        );
      })
      .finally(() => setBusy(false));
  }

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
        {remaining > 0
          ? t('auth.banner.resendIn', { time: formatWait(remaining, locale) })
          : t('auth.banner.resend')}
      </Button>
    </div>
  );
}
