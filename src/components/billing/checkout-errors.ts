import { isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import type { MessageKey, TFunction } from '@/lib/i18n';
import type { Locale } from '@/lib/i18n/locales';
import { loginUrl } from '@/lib/next-path';
import { formatNumber, isRecord } from '@/lib/utils';
import { errorMessage } from '@/components/ui/error-message';

/** What went wrong with a billing request, in the user's language, and where to go from here. */
export interface BillingProblem {
  message: string;
  link?: { href: string; label: string };
}

/** `details.reason` of an error answer: the billing routes use it to tell conflicts apart. */
export function reasonOf(error: unknown): string | undefined {
  if (!isApiError(error) || !isRecord(error.details)) return undefined;
  const { reason } = error.details;
  return typeof reason === 'string' ? reason : undefined;
}

const REASON_KEYS = {
  billing_disabled: 'billing.errors.billingDisabled',
  subscription_exists: 'billing.errors.subscriptionExists',
  checkout_in_progress: 'billing.errors.checkoutInProgress',
  idempotency_key_reused: 'billing.errors.keyReused',
  checkout_closed: 'billing.errors.checkoutClosed',
  subscription_ended: 'billing.errors.subscriptionEnded',
} as const satisfies Record<string, MessageKey>;

type KnownReason = keyof typeof REASON_KEYS;

function isKnownReason(reason: string | undefined): reason is KnownReason {
  return reason !== undefined && Object.hasOwn(REASON_KEYS, reason);
}

/** Seconds the server asked to wait (`details.retryAfterSec`), when it sent a usable number. */
function retryAfterSecOf(error: unknown): number | undefined {
  if (!isApiError(error) || !isRecord(error.details)) return undefined;
  const { retryAfterSec } = error.details;
  return typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? Math.ceil(retryAfterSec)
    : undefined;
}

/** "45 seconds", "20 minutes" or "5 hours": the 24-hour checkout limit can ask for a long wait. */
export function formatLongWait(seconds: number, locale: Locale): string {
  const long = { style: 'unit', unitDisplay: 'long' } as const;
  if (seconds < 90) return formatNumber(seconds, locale, { ...long, unit: 'second' });
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90
    ? formatNumber(minutes, locale, { ...long, unit: 'minute' })
    : formatNumber(Math.ceil(minutes / 60), locale, { ...long, unit: 'hour' });
}

export interface DescribeOptions {
  /** The page to come back to after logging in again. */
  returnTo: string;
  /** Needed to say how long to wait; without it the text says "later". */
  locale?: Locale;
  /** The subscription routes answer 404 when there is no plan; checkout answers it for an unknown item. */
  subscription?: boolean;
}

/** Maps any failure of a billing request to localized text (never the API's English message). */
export function describeBillingError(
  t: TFunction,
  error: unknown,
  { returnTo, locale, subscription = false }: DescribeOptions,
): BillingProblem {
  const reason = reasonOf(error);
  if (isKnownReason(reason)) {
    const message = t(REASON_KEYS[reason]);
    return reason === 'subscription_exists'
      ? { message, link: { href: '/account/billing', label: t('billing.errors.openBilling') } }
      : { message };
  }
  const code = errorCodeOf(error);
  if (code === 'too_many_active') {
    // The unpaid checkouts are listed in Billing, where each one can still be paid.
    return {
      message: t('billing.errors.tooManyOpen'),
      link: { href: '/account/billing', label: t('billing.errors.openBilling') },
    };
  }
  if (code === 'email_not_verified') {
    // Checked before anything is created: the account has to confirm its address first.
    return {
      message: t('billing.errors.emailNotVerified'),
      link: { href: '/account', label: t('billing.errors.openAccount') },
    };
  }
  // The payment provider could not be reached or refused: the buyer never got a payment page.
  if (code === 'provider_error') return { message: t('billing.errors.gatewayDown') };
  if (code === 'rate_limited' && reason === 'daily_checkout_limit') {
    const seconds = retryAfterSecOf(error);
    return {
      message:
        seconds !== undefined && locale !== undefined
          ? t('billing.errors.dailyLimit', { wait: formatLongWait(seconds, locale) })
          : t('billing.errors.dailyLimitLater'),
    };
  }
  if (code === 'unauthorized') {
    return {
      message: t('billing.errors.unauthorized'),
      link: { href: loginUrl(returnTo), label: t('billing.errors.logIn') },
    };
  }
  if (subscription && code === 'not_found') return { message: t('billing.errors.noSubscription') };
  return { message: errorMessage(t, error) };
}

/**
 * Whether the next click on the same item may re-send the same `Idempotency-Key`. Only when the
 * outcome of the request is unknown (the answer never arrived) or the server is still creating
 * that very checkout: a retry then returns the original order. After any definite answer the
 * next click is a new attempt with a new key: replaying the key of a failed checkout would hand
 * back that failed order.
 */
export function keepsIdempotencyKey(error: unknown): boolean {
  if (isApiError(error) && error.status === 0) return true;
  return reasonOf(error) === 'checkout_in_progress';
}
