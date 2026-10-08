import { describe, expect, it } from 'vitest';
import { failureText, issuePaths, sessionEnded } from '@/components/account/form-errors';
import { ApiError } from '@/lib/api-client';
import { createTranslator } from '@/lib/i18n';

const en = createTranslator('en');
const ar = createTranslator('ar');

const invalid = (...paths: unknown[]) =>
  new ApiError('validation_failed', 422, 'Invalid', {
    issues: paths.map((path) => ({ path, message: 'bad' })),
  });

describe('issuePaths', () => {
  it('collects the field of every problem the server reported', () => {
    expect([...issuePaths(invalid('name', 'currentPassword'))].sort()).toEqual([
      'currentPassword',
      'name',
    ]);
  });

  it('ignores problems without a usable path', () => {
    expect(issuePaths(invalid(3, null, undefined)).size).toBe(0);
    expect(
      issuePaths(new ApiError('validation_failed', 422, 'Invalid', { issues: 'x' })).size,
    ).toBe(0);
    expect(issuePaths(new ApiError('validation_failed', 422, 'Invalid', 'x')).size).toBe(0);
    expect(issuePaths(new ApiError('validation_failed', 422, 'Invalid')).size).toBe(0);
  });

  it('only trusts a validation error', () => {
    const other = new ApiError('conflict', 409, 'Conflict', { issues: [{ path: 'name' }] });
    expect(issuePaths(other).size).toBe(0);
    expect(issuePaths(new Error('boom')).size).toBe(0);
    expect(issuePaths(null).size).toBe(0);
  });
});

describe('failureText', () => {
  it('speaks for the whole form from the error code, never from the server message', () => {
    const text = failureText(new ApiError('conflict', 409, 'English developer text'), en);
    expect(text).toBe(en.t('errors.conflict'));
    expect(text).not.toContain('English developer text');
    expect(failureText(new ApiError('conflict', 409, 'x'), ar)).toBe(ar.t('errors.conflict'));
  });

  it('says how long to wait when the server said so, rounded up', () => {
    const limited = new ApiError('rate_limited', 429, 'Slow down', { retryAfterSec: 44.2 });
    expect(failureText(limited, en)).toBe('Too many attempts. Try again in 45 seconds.');
    const long = new ApiError('rate_limited', 429, 'Slow down', { retryAfterSec: 300 });
    expect(failureText(long, en)).toBe('Too many attempts. Try again in 5 minutes.');
  });

  it('falls back to the plain rate limit message when the wait is unknown or nonsense', () => {
    for (const details of [
      undefined,
      {},
      { retryAfterSec: 0 },
      { retryAfterSec: -4 },
      { retryAfterSec: 'soon' },
      { retryAfterSec: Infinity },
    ]) {
      const limited = new ApiError('rate_limited', 429, 'Slow down', details);
      expect(failureText(limited, en), JSON.stringify(details)).toBe(en.t('errors.rate_limited'));
    }
  });

  it('treats a failure that is not an API error as an internal one', () => {
    expect(failureText(new TypeError('Failed to fetch'), en)).toBe(en.t('errors.internal'));
  });
});

describe('sessionEnded', () => {
  it('is true only when the server says the session is gone', () => {
    expect(sessionEnded(new ApiError('unauthorized', 401, 'No session'))).toBe(true);
    expect(sessionEnded(new ApiError('forbidden', 403, 'No'))).toBe(false);
    expect(sessionEnded(new Error('x'))).toBe(false);
  });
});
