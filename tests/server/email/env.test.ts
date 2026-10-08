import { describe, expect, it } from 'vitest';
import { EnvError, parseEnv } from '@/server/env';

const production = {
  NODE_ENV: 'production',
  SESSION_SECRET: 'a-production-secret-that-is-long-enough-0123456789',
};

function problemsOf(source: Record<string, string>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  return [];
}

describe('email and sign-up settings', () => {
  it('defaults: no SMTP, verification on auto, 5 sign-ups per address per day', () => {
    const env = parseEnv({});
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.SMTP_PORT).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
    expect(env).toMatchObject({
      SMTP_SECURE: false,
      EMAIL_VERIFICATION: 'auto',
      DISPOSABLE_EMAIL_DOMAINS: [],
      SIGNUPS_PER_IP_PER_DAY: 5,
    });
  });

  it('treats the blank lines of .env.example as unset', () => {
    const env = parseEnv({
      SMTP_URL: '',
      SMTP_HOST: ' ',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_SECURE: '',
      EMAIL_FROM: '',
      EMAIL_VERIFICATION: '',
      DISPOSABLE_EMAIL_DOMAINS: '',
    });
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.EMAIL_VERIFICATION).toBe('auto');
  });

  it('accepts an SMTP URL, or the separate variables, with a From address', () => {
    expect(
      parseEnv({
        SMTP_URL: 'smtps://user:p%40ss@smtp.example.com:465',
        EMAIL_FROM: 'AIVORE <a@b.co>',
      }).SMTP_URL,
    ).toBe('smtps://user:p%40ss@smtp.example.com:465');
    const parts = parseEnv({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      SMTP_SECURE: 'true',
      EMAIL_FROM: 'no-reply@example.com',
    });
    expect(parts).toMatchObject({ SMTP_PORT: 587, SMTP_SECURE: true });
  });

  it.each([
    ['not a URL', { SMTP_URL: 'smtp.example.com', EMAIL_FROM: 'a@b.co' }, 'SMTP_URL'],
    ['an https URL', { SMTP_URL: 'https://example.com', EMAIL_FROM: 'a@b.co' }, 'SMTP_URL'],
    [
      'a port out of range',
      { SMTP_HOST: 'h', SMTP_PORT: '70000', EMAIL_FROM: 'a@b.co' },
      'SMTP_PORT',
    ],
    [
      'a port that is not a number',
      { SMTP_HOST: 'h', SMTP_PORT: 'x', EMAIL_FROM: 'a@b.co' },
      'SMTP_PORT',
    ],
    [
      'both URL and host',
      { SMTP_URL: 'smtp://h', SMTP_HOST: 'h', EMAIL_FROM: 'a@b.co' },
      'not both',
    ],
    ['SMTP without a From address', { SMTP_HOST: 'h' }, 'EMAIL_FROM: is required'],
    [
      'a user without a password',
      { SMTP_HOST: 'h', SMTP_USER: 'u', EMAIL_FROM: 'a@b.co' },
      'SMTP_PASS',
    ],
    [
      'a From header with a line break',
      { SMTP_HOST: 'h', EMAIL_FROM: 'a@b.co\nBcc: x@y.z' },
      'EMAIL_FROM',
    ],
    ['a From without an address', { SMTP_HOST: 'h', EMAIL_FROM: 'AIVORE' }, 'EMAIL_FROM'],
    ['an unknown policy', { EMAIL_VERIFICATION: 'sometimes' }, 'EMAIL_VERIFICATION'],
    ['a negative sign-up cap', { SIGNUPS_PER_IP_PER_DAY: '-1' }, 'SIGNUPS_PER_IP_PER_DAY'],
  ])('rejects %s', (_label, source, expected) => {
    expect(problemsOf(source).join('\n')).toContain(expected);
  });

  it('refuses mandatory confirmation in production without SMTP: nobody could confirm', () => {
    expect(problemsOf({ ...production, EMAIL_VERIFICATION: 'required' }).join('\n')).toContain(
      'EMAIL_VERIFICATION',
    );
    expect(
      problemsOf({
        ...production,
        EMAIL_VERIFICATION: 'required',
        SMTP_URL: 'smtp://h',
        EMAIL_FROM: 'a@b.co',
      }),
    ).toEqual([]);
    // Fine on a laptop: the outbox shows the link.
    expect(problemsOf({ EMAIL_VERIFICATION: 'required' })).toEqual([]);
  });

  it('lower-cases and trims the extra disposable domains', () => {
    expect(parseEnv({ DISPOSABLE_EMAIL_DOMAINS: ' Throwaway.Example , spam.test' })).toMatchObject({
      DISPOSABLE_EMAIL_DOMAINS: ['throwaway.example', 'spam.test'],
    });
  });
});
