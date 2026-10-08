'use client';

import { CircleCheck, MailQuestion, TimerOff, TriangleAlert, WifiOff } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { creditsLabel } from '@/components/marketing/credits-label';
import { Button } from '@/components/ui/button';
import { SpinnerIcon } from '@/components/ui/spinner-icon';
import { api, isApiError } from '@/lib/api-client';
import type { LinkProblem } from './recovery-error';
import { linkProblemOf, retryAfterOf } from './recovery-error';
import { useI18n } from '@/lib/i18n/client';
import { DEFAULT_NEXT_PATH } from '@/lib/next-path';
import { StatusPanel } from './status-panel';
import { formatWait } from './auth-error';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/components/ui/error-message';

export interface VerifyEmailPanelProps {
  /** The `?token=` of the emailed link; null when the link had none. */
  token: string | null;
  /** Whether somebody is logged in here (they can request a new link without leaving). */
  signedIn: boolean;
}

interface Confirmed {
  already: boolean;
  bonusCredits: number;
}

type Outcome =
  | { kind: 'pending' }
  | { kind: 'confirmed'; confirmed: Confirmed }
  | { kind: 'problem'; problem: LinkProblem }
  | { kind: 'network' };

const PROBLEM_ICON: Record<LinkProblem, LucideIcon> = {
  invalid: MailQuestion,
  expired: TimerOff,
  used: TriangleAlert,
};

interface ConfirmResponse {
  verified: true;
  alreadyVerified: boolean;
  bonusCredits: number;
}

/** Takes the token out of the address bar once the link has been dealt with. */
function stripToken(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token')) return;
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url);
}

function ResendLink({ signedIn }: { signedIn: boolean }) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [waitSec, setWaitSec] = useState(0);

  if (!signedIn) {
    return (
      <>
        <p>{t('auth.verify.loginToRequest')}</p>
        <Button href={`/login?next=${encodeURIComponent(DEFAULT_NEXT_PATH)}`} size="lg" fullWidth>
          {t('auth.verify.logIn')}
        </Button>
      </>
    );
  }
  if (sent) return <p>{t('auth.verify.resendSent')}</p>;
  return (
    <Button
      size="lg"
      fullWidth
      loading={busy}
      disabled={waitSec > 0}
      onClick={() => {
        setBusy(true);
        api
          .post('/auth/verify-email/request')
          .then(() => setSent(true))
          .catch((error: unknown) => {
            const seconds = retryAfterOf(error);
            if (seconds !== undefined) setWaitSec(seconds);
            toast.error(
              seconds === undefined
                ? errorMessage(t, error)
                : t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) }),
            );
          })
          .finally(() => setBusy(false));
      }}
    >
      {t('auth.verify.resend')}
    </Button>
  );
}

/**
 * The page behind the link in the confirmation email. Opening it confirms the address (a POST made
 * here, never a GET, so mail scanners that fetch links cannot burn them) and shows the outcome:
 * confirmed, or why the link cannot work. Strict-mode double effects do not send it twice.
 */
export function VerifyEmailPanel({ token, signedIn }: VerifyEmailPanelProps) {
  const i18n = useI18n();
  const { t } = i18n;
  const [outcome, setOutcome] = useState<Outcome>(
    token ? { kind: 'pending' } : { kind: 'problem', problem: 'invalid' },
  );
  const started = useRef(false);

  const confirm = useCallback(() => {
    if (!token) return;
    setOutcome({ kind: 'pending' });
    api
      .post<ConfirmResponse>('/auth/verify-email/confirm', { token })
      .then((result) => {
        setOutcome({
          kind: 'confirmed',
          confirmed: { already: result.alreadyVerified, bonusCredits: result.bonusCredits },
        });
        stripToken();
      })
      .catch((error: unknown) => {
        const problem = linkProblemOf(error);
        if (problem) {
          setOutcome({ kind: 'problem', problem });
          stripToken();
          return;
        }
        // A dropped connection leaves the link usable: offer another try instead of a verdict.
        setOutcome({ kind: 'network' });
        if (isApiError(error) && error.code === 'rate_limited') {
          toast.error(errorMessage(t, error));
        }
      });
  }, [token, t]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    confirm();
  }, [confirm]);

  if (outcome.kind === 'pending') {
    return (
      <StatusPanel
        tone="info"
        icon={MailQuestion}
        title={t('auth.verify.confirming')}
        mark={<SpinnerIcon className="size-7" />}
      />
    );
  }

  if (outcome.kind === 'confirmed') {
    const { already, bonusCredits } = outcome.confirmed;
    return (
      <StatusPanel
        tone="success"
        icon={CircleCheck}
        title={t('auth.verify.successTitle')}
        actions={
          signedIn ? (
            <Button href={DEFAULT_NEXT_PATH} size="lg" fullWidth>
              {t('auth.verify.openStudio')}
            </Button>
          ) : (
            <Button
              href={`/login?next=${encodeURIComponent(DEFAULT_NEXT_PATH)}`}
              size="lg"
              fullWidth
            >
              {t('auth.verify.logIn')}
            </Button>
          )
        }
      >
        <p>{already ? t('auth.verify.alreadyBody') : t('auth.verify.successBody')}</p>
        {bonusCredits > 0 ? (
          <p className="font-medium text-foreground">
            {t('auth.verify.bonus', { credits: creditsLabel(i18n, bonusCredits) })}
          </p>
        ) : null}
      </StatusPanel>
    );
  }

  if (outcome.kind === 'network') {
    return (
      <StatusPanel
        tone="warning"
        icon={WifiOff}
        title={t('auth.verify.networkTitle')}
        actions={
          <Button size="lg" fullWidth onClick={confirm}>
            {t('auth.verify.retry')}
          </Button>
        }
      >
        <p>{t('auth.verify.networkBody')}</p>
      </StatusPanel>
    );
  }

  const { problem } = outcome;
  return (
    <StatusPanel
      tone="danger"
      icon={PROBLEM_ICON[problem]}
      title={t(`auth.verify.problem.${problem}.title`)}
      actions={<ResendLink signedIn={signedIn} />}
    >
      <p>{t(`auth.verify.problem.${problem}.body`)}</p>
    </StatusPanel>
  );
}
