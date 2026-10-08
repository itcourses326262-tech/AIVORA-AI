import { describe, expect, it } from 'vitest';
import { describeAuthFailure, formatWait } from '@/components/auth/auth-error';
import { ApiError } from '@/lib/api-client';
import { createTranslator } from '@/lib/i18n';

const en = createTranslator('en');
const ar = createTranslator('ar');

const failure = (
  code: ConstructorParameters<typeof ApiError>[0],
  status: number,
  details?: unknown,
) => new ApiError(code, status, 'English message for developers', details);

describe('describeAuthFailure', () => {
  it('says the credentials were wrong, without saying which, and moves focus to the password', () => {
    expect(describeAuthFailure(failure('unauthorized', 401), 'login', en)).toEqual({
      form: 'Incorrect email or password.',
      fields: {},
      focus: 'password',
    });
    expect(describeAuthFailure(failure('unauthorized', 401), 'login', ar).form).toBe(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    );
  });

  it('pins "already registered" to the email field and offers the log in page', () => {
    expect(describeAuthFailure(failure('conflict', 409), 'register', en)).toEqual({
      fields: { email: 'An account with this email already exists.' },
      focus: 'email',
      emailTaken: true,
    });
  });

  it('gives a rate-limit hint when the server said how long, and the general text when not', () => {
    expect(
      describeAuthFailure(failure('rate_limited', 429, { retryAfterSec: 45 }), 'login', en).form,
    ).toBe('Too many attempts. Try again in 45 seconds.');
    expect(
      describeAuthFailure(failure('rate_limited', 429, { retryAfterSec: 45 }), 'login', ar).form,
    ).toBe('محاولات كثيرة. حاول مرة أخرى بعد ٤٥ ثانية.');
    expect(describeAuthFailure(failure('rate_limited', 429), 'login', en).form).toBe(
      'Too many requests. Please wait a moment and try again.',
    );
    for (const details of [{ retryAfterSec: 'soon' }, { retryAfterSec: -3 }, {}, 'x']) {
      expect(describeAuthFailure(failure('rate_limited', 429, details), 'login', en).form).toBe(
        'Too many requests. Please wait a moment and try again.',
      );
    }
  });

  it('maps validation issues to the fields they name, in the active language', () => {
    const issues = [
      { path: 'password', message: 'too common' },
      { path: 'email', message: 'bad' },
      { path: 'unknown', message: 'ignored' },
    ];
    const result = describeAuthFailure(
      failure('validation_failed', 422, { issues }),
      'register',
      en,
    );
    expect(result.fields).toEqual({
      password: 'This password is too common or easy to guess. Try another one.',
      email: 'Enter a valid email address, like you@example.com.',
    });
    expect(result.focus).toBe('email');
    expect(result.form).toBeUndefined();
  });

  it('falls back to the banner when validation details name no field of the form', () => {
    expect(
      describeAuthFailure(failure('validation_failed', 422, { issues: [] }), 'login', en),
    ).toEqual({ form: 'Some of the information you entered is not valid.', fields: {} });
  });

  it.each([
    ['signup_disabled', 403, 'New registrations are currently closed.'],
    ['internal', 500, 'Something went wrong on our side. Please try again.'],
    ['network_error', 0, "We can't reach the server. Check your connection and try again."],
    ['invalid_response', 200, 'The server sent an unexpected response. Please try again.'],
    ['forbidden', 403, "You don't have permission to do that."],
  ] as const)('shows the dictionary text for %s', (code, status, text) => {
    expect(describeAuthFailure(failure(code, status), 'register', en).form).toBe(text);
  });

  it('treats anything that is not an API error as an internal one', () => {
    expect(describeAuthFailure(new TypeError('boom'), 'login', en).form).toBe(
      'Something went wrong on our side. Please try again.',
    );
    expect(describeAuthFailure('weird', 'login', en).form).toBe(
      'Something went wrong on our side. Please try again.',
    );
  });

  it('never shows the server message, which is English and for developers', () => {
    for (const code of ['internal', 'bad_request', 'unauthorized'] as const) {
      expect(JSON.stringify(describeAuthFailure(failure(code, 400), 'register', ar))).not.toContain(
        'English message',
      );
    }
  });
});

describe('formatWait', () => {
  it('counts seconds up to a minute and a half, then whole minutes', () => {
    expect(formatWait(1, 'en')).toBe('1 second');
    expect(formatWait(45, 'en')).toBe('45 seconds');
    expect(formatWait(89, 'en')).toBe('89 seconds');
    expect(formatWait(90, 'en')).toBe('2 minutes');
    expect(formatWait(600, 'en')).toBe('10 minutes');
    expect(formatWait(45, 'ar')).toBe('٤٥ ثانية');
    expect(formatWait(120, 'ar')).toMatch(/٢ دقيقتان|دقيقتان|٢ دقيقة/);
  });
});
