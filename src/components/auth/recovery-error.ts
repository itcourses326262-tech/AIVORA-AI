import { isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import type { MessageKey, Translator } from '@/lib/i18n';
import { isRecord } from '@/lib/utils';
import { formatWait } from './auth-error';

export type RecoveryField = 'email' | 'password';

export interface RecoveryFailure {
  /** A problem with the whole form: shown in the banner above the fields. */
  form?: string;
  /** Problems the server pinned to a field. */
  fields: Partial<Record<RecoveryField, string>>;
  focus?: RecoveryField;
}

/** Why an emailed link could not be used (`details.reason` of the 400 the server answers). */
export type LinkProblem = 'invalid' | 'expired' | 'used';

function isLinkProblem(value: unknown): value is LinkProblem {
  return value === 'invalid' || value === 'expired' || value === 'used';
}

/** The reason in a failed confirm/reset response, or null when the failure was something else. */
export function linkProblemOf(error: unknown): LinkProblem | null {
  if (!isApiError(error) || error.code !== 'bad_request' || !isRecord(error.details)) return null;
  return isLinkProblem(error.details.reason) ? error.details.reason : null;
}

/** Seconds the server asked to wait (`details.retryAfterSec` of a `rate_limited` error). */
export function retryAfterOf(error: unknown): number | undefined {
  if (!isApiError(error) || error.code !== 'rate_limited' || !isRecord(error.details)) {
    return undefined;
  }
  const { retryAfterSec } = error.details;
  return typeof retryAfterSec === 'number' && Number.isFinite(retryAfterSec) && retryAfterSec > 0
    ? Math.ceil(retryAfterSec)
    : undefined;
}

/**
 * Turns whatever a forgot-password or reset-password request threw into text for the form,
 * through the dictionaries: the server's `message` is English and only its `code` counts.
 */
export function describeRecoveryFailure(
  error: unknown,
  { t, locale }: Pick<Translator, 't' | 'locale'>,
): RecoveryFailure {
  const code = errorCodeOf(error);

  if (code === 'rate_limited') {
    const seconds = retryAfterOf(error);
    return {
      form:
        seconds === undefined
          ? t('errors.rate_limited')
          : t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) }),
      fields: {},
    };
  }

  if (code === 'validation_failed' && isApiError(error) && isRecord(error.details)) {
    const { issues } = error.details;
    const fields: RecoveryFailure['fields'] = {};
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (!isRecord(issue)) continue;
        if (issue.path === 'password') fields.password = t('auth.errors.passwordRejected');
        else if (issue.path === 'email') fields.email = t('auth.validation.emailInvalid');
      }
    }
    const focus = (['email', 'password'] as const).find((field) => fields[field]);
    if (focus) return { fields, focus };
  }

  return { form: t(`errors.${code}` satisfies MessageKey), fields: {} };
}
