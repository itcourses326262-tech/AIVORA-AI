import { isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import type { MessageKey, TFunction, Translator } from '@/lib/i18n';
import { formatNumber, isRecord } from '@/lib/utils';
import type { FieldName } from './schemas';

export interface AuthFailure {
  /** A problem with the whole form: shown in the banner above the fields. */
  form?: string;
  /** Problems the server pinned to a field. */
  fields: Partial<Record<FieldName, string>>;
  /** The field to move focus to. */
  focus?: FieldName;
  /** The address is already registered: offer the log in page. */
  emailTaken?: boolean;
}

type Mode = 'login' | 'register';

/** Seconds to wait, when the server said (`details.retryAfterSec` of a `rate_limited` error). */
function retryAfterSec(error: unknown): number | undefined {
  if (!isApiError(error) || error.code !== 'rate_limited' || !isRecord(error.details)) {
    return undefined;
  }
  const { retryAfterSec: seconds } = error.details;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}

/** "45 seconds" or "2 minutes" in the active language. */
export function formatWait(seconds: number, locale: Translator['locale']): string {
  const long = { style: 'unit', unitDisplay: 'long' } as const;
  return seconds < 90
    ? formatNumber(seconds, locale, { ...long, unit: 'second' })
    : formatNumber(Math.ceil(seconds / 60), locale, { ...long, unit: 'minute' });
}

/** Where, in the server's validation details, a message about `path` belongs. */
function validationFields(
  error: unknown,
  t: TFunction,
): Partial<Record<FieldName, string>> | undefined {
  if (!isApiError(error) || error.code !== 'validation_failed' || !isRecord(error.details)) {
    return undefined;
  }
  const { issues } = error.details;
  if (!Array.isArray(issues)) return undefined;
  const fields: Partial<Record<FieldName, string>> = {};
  for (const issue of issues) {
    if (!isRecord(issue) || typeof issue.path !== 'string') continue;
    if (issue.path === 'password') fields.password = t('auth.errors.passwordRejected');
    else if (issue.path === 'email') fields.email = t('auth.validation.emailInvalid');
    else if (issue.path === 'name') fields.name = t('auth.validation.nameRequired');
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * Turns whatever the log in or register request threw into text for the form, through the
 * dictionaries: the server's `message` is English and for developers, only its `code` counts.
 */
export function describeAuthFailure(
  error: unknown,
  mode: Mode,
  { t, locale }: Pick<Translator, 't' | 'locale'>,
): AuthFailure {
  const code = errorCodeOf(error);

  if (mode === 'login' && code === 'unauthorized') {
    return { form: t('auth.errors.invalidCredentials'), fields: {}, focus: 'password' };
  }

  if (mode === 'register' && code === 'conflict') {
    return { fields: { email: t('auth.errors.emailTaken') }, focus: 'email', emailTaken: true };
  }

  if (code === 'rate_limited') {
    const seconds = retryAfterSec(error);
    return {
      form:
        seconds === undefined
          ? t('errors.rate_limited')
          : t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) }),
      fields: {},
    };
  }

  const fields = validationFields(error, t);
  if (fields) {
    const focus = (['name', 'email', 'password'] as const).find((field) => fields[field]);
    return { fields, focus };
  }

  return { form: t(`errors.${code}` satisfies MessageKey), fields: {} };
}
