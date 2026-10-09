'use client';

import { Coins, LogIn, MailWarning, Sparkles, TriangleAlert } from 'lucide-react';
import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';
import { isolateLtr } from '@/components/auth/bidi';
import { useResendVerification } from '@/components/layout/verify-email-banner';
import { creditsLabel } from '@/components/marketing/credits-label';
import { creditsText } from '@/lib/generations/format';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatCredits } from '@/lib/utils';
import { useUser } from '@/lib/user-context';
import { Button } from '../ui/button';
import { Kbd } from '../ui/kbd';
import {
  CONFIRM_NOTICE_ID,
  PRICING_HREF,
  isShort,
  mustConfirmEmail,
  type CreditStatus,
} from './credits';

export interface CreditNoticeProps {
  status: CreditStatus;
  /** The phone's strip: the unconfirmed-address notice is shown on one line. */
  compact?: boolean;
  /** Where "Log in" leads once the session has ended (back to this studio). */
  loginHref?: string;
  className?: string;
}

/**
 * An account that has not confirmed its email address while the server requires it has a balance
 * of 0 only until the link is opened: this says so, with the way to get a new link, where "you
 * need more credits - get credits" would send the person to buy what they cannot yet use.
 * `compact` is the phone's strip above the tab bar: the title and the button on one line, the
 * longer explanation kept for screen readers (the banner above the page has it in full).
 */
export function ConfirmEmailNotice({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const { user, refresh } = useUser();
  const onVerified = useCallback(() => void refresh(), [refresh]);
  const { remaining, busy, resend, label } = useResendVerification(onVerified);
  if (!user) return null;
  const bonus = user.pendingBonusCredits ?? 0;
  const email = isolateLtr(user.email);
  const title = bonus > 0 ? t('studio.confirmEmail.title') : t('studio.confirmEmail.titleNoBonus');
  const body =
    bonus > 0
      ? t('studio.confirmEmail.bodyBonus', { email, credits: creditsLabel(i18n, bonus) })
      : t('studio.confirmEmail.body', { email });
  const button = (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      disabled={remaining > 0}
      onClick={resend}
      className={compact ? 'shrink-0' : 'justify-self-start'}
    >
      {label}
    </Button>
  );
  if (compact) {
    return (
      <div
        id={CONFIRM_NOTICE_ID}
        role="status"
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-warning/35 bg-warning-soft px-3 py-2.5',
          className,
        )}
      >
        <MailWarning aria-hidden="true" className="size-4 shrink-0 text-warning" />
        <p className="min-w-0 flex-1 basis-40 text-sm font-semibold text-foreground">
          {title}
          <span className="sr-only"> {body}</span>
        </p>
        {button}
      </div>
    );
  }
  return (
    <div
      id={CONFIRM_NOTICE_ID}
      role="status"
      className={cn(
        'grid gap-3 rounded-xl border border-warning/35 bg-warning-soft px-3 py-3',
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <MailWarning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
        <div className="grid min-w-0 gap-1 text-sm">
          <p className="font-semibold text-foreground">{title}</p>
          <p className="break-words text-muted">{body}</p>
        </div>
      </div>
      {button}
    </div>
  );
}

/**
 * Says what is missing and links to the page that sells it. Renders nothing when affordable. After
 * the session ended it says so instead, and links to the login page; while the email address is
 * unconfirmed it asks for the confirmation instead of for credits.
 */
export function CreditNotice({ status, compact, loginHref, className }: CreditNoticeProps) {
  const i18n = useI18n();
  const { t } = i18n;
  if (mustConfirmEmail(status))
    return <ConfirmEmailNotice className={className} compact={compact} />;
  if (status.signedOut) {
    return (
      <div
        role="status"
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/35 bg-warning-soft px-3 py-2.5',
          className,
        )}
      >
        <p className="flex items-center gap-2 text-sm text-foreground">
          <LogIn aria-hidden="true" className="size-4 shrink-0 text-warning" />
          {t('studio.submit.sessionExpired')}
        </p>
        <Button href={loginHref ?? '/login'} size="sm" variant="secondary">
          {t('common.nav.login')}
        </Button>
      </div>
    );
  }
  if (!isShort(status) || status.cost === null) return null;
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-warning/35 bg-warning-soft px-3 py-2.5',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm text-foreground">
        <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
        {t('errors.insufficient_credits')}{' '}
        {t('studio.cost.short', { missing: creditsText(i18n, status.cost - status.balance) })}
      </p>
      <Button href={PRICING_HREF} size="sm" variant="secondary">
        {t('studio.cost.getCredits')}
      </Button>
    </div>
  );
}

const noSubscription = () => () => {};

/** ⌘ on Apple devices, Ctrl elsewhere. The server render says Ctrl; the browser corrects it. */
function useShortcutModifier(): string {
  return useSyncExternalStore(
    noSubscription,
    () => (/mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl'),
    () => 'Ctrl',
  );
}

export interface GenerateButtonProps extends CreditStatus {
  busy: boolean;
  /** No model can run this tool (or the catalog has not loaded). */
  noModel: boolean;
  onGenerate: (event: MouseEvent<HTMLButtonElement>) => void;
  size?: 'md' | 'lg';
  fullWidth?: boolean;
}

export function GenerateButton({
  cost,
  balance,
  signedOut,
  unconfirmed,
  busy,
  noModel,
  onGenerate,
  size = 'lg',
  fullWidth = true,
}: GenerateButtonProps) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <Button
      size={size}
      fullWidth={fullWidth}
      loading={busy}
      disabled={
        noModel ||
        cost === null ||
        isShort({ cost, balance, signedOut, unconfirmed }) ||
        mustConfirmEmail({ cost, balance, signedOut, unconfirmed })
      }
      aria-describedby={
        mustConfirmEmail({ cost, balance, signedOut, unconfirmed }) ? CONFIRM_NOTICE_ID : undefined
      }
      startIcon={busy ? undefined : <Sparkles aria-hidden="true" />}
      onClick={onGenerate}
    >
      {busy
        ? t('studio.action.starting')
        : cost === null
          ? t('studio.generate')
          : t('studio.action.generate', { price: creditsText(i18n, cost) })}
    </Button>
  );
}

export interface GenerateBarProps extends GenerateButtonProps {
  loginHref?: string;
  className?: string;
}

/** Cost, balance, the "get credits" way out and the Generate button, pinned under the controls. */
export function GenerateBar({ className, loginHref, ...button }: GenerateBarProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const modifier = useShortcutModifier();
  const { cost, balance, signedOut, unconfirmed } = button;
  return (
    <div className={cn('grid gap-3 border-t border-border bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="flex items-center gap-2 text-muted">
          <Coins aria-hidden="true" className="size-4 text-brand" />
          <span>{t('studio.cost.label')}</span>
          <strong className="font-semibold text-foreground tabular-nums">
            {cost === null ? '—' : creditsText(i18n, cost)}
          </strong>
        </p>
        <p className="text-muted tabular-nums">
          {t('studio.cost.balance', { balance: signedOut ? '—' : formatCredits(balance, locale) })}
        </p>
      </div>
      <CreditNotice status={{ cost, balance, signedOut, unconfirmed }} loginHref={loginHref} />
      {cost === null && !button.noModel ? (
        <p role="status" className="text-sm text-warning">
          {t('studio.cost.unavailable')}
        </p>
      ) : null}
      <GenerateButton {...button} />
      <p className="hidden items-center justify-center gap-1.5 text-xs text-subtle lg:flex">
        <span dir="ltr" className="inline-flex items-center gap-1">
          <Kbd>{modifier}</Kbd>
          <Kbd>Enter</Kbd>
        </span>
        <span>{t('studio.prompt.shortcut')}</span>
      </p>
    </div>
  );
}
