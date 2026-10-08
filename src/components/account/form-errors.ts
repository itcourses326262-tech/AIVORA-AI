import { isApiError } from '@/lib/api-client';
import { errorCodeOf } from '@/lib/errors';
import type { Translator } from '@/lib/i18n';
import { formatWait } from '@/components/auth/auth-error';
import { isRecord } from '@/lib/utils';

/** The `path` of every problem a 422 reported, so a form can pin each one to its field. */
export function issuePaths(error: unknown): ReadonlySet<string> {
  const paths = new Set<string>();
  if (!isApiError(error) || error.code !== 'validation_failed' || !isRecord(error.details)) {
    return paths;
  }
  const { issues } = error.details;
  if (!Array.isArray(issues)) return paths;
  for (const issue of issues) {
    if (isRecord(issue) && typeof issue.path === 'string') paths.add(issue.path);
  }
  return paths;
}

/** Seconds to wait, when the server said (`details.retryAfterSec` of a `rate_limited` error). */
function retryAfterSec(error: unknown): number | undefined {
  if (!isApiError(error) || !isRecord(error.details)) return undefined;
  const { retryAfterSec: seconds } = error.details;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}

/**
 * The text for a failure that belongs to the whole form, from the error's code (the server's
 * `message` is English and for developers). A rate limit says how long to wait when it is known.
 */
export function failureText(
  error: unknown,
  { t, locale }: Pick<Translator, 't' | 'locale'>,
): string {
  const code = errorCodeOf(error);
  if (code === 'rate_limited') {
    const seconds = retryAfterSec(error);
    if (seconds !== undefined)
      return t('auth.errors.rateLimitedIn', { time: formatWait(seconds, locale) });
  }
  return t(`errors.${code}`);
}

/** True when the session is gone: the page should ask the server again (which sends the user to log in). */
export function sessionEnded(error: unknown): boolean {
  return errorCodeOf(error) === 'unauthorized';
}
