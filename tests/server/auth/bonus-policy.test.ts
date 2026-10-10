import { describe, expect, it } from 'vitest';
import { earnsSignupBonus, signupBonusOffer } from '@/server/auth/bonus';
import { parseEnv } from '@/server/env';

// Built at runtime: key-shaped literals are rejected by tests/security/no-secret-literals.test.ts.
const FAKE_KEY = 'k'.repeat(30);
const GOOGLE = {
  FIREBASE_API_KEY: FAKE_KEY,
  FIREBASE_AUTH_DOMAIN: 'demo-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'demo-project',
};

describe('who earns the free sign-up credits', () => {
  it('is Google sign-in only by default', () => {
    const env = parseEnv({});
    expect(env.SIGNUP_BONUS_PROVIDER).toBe('google');
    expect(earnsSignupBonus(env, 'google')).toBe(true);
    expect(earnsSignupBonus(env, 'password')).toBe(false);
  });

  it('lets a development setup hand them to password accounts too', () => {
    const env = parseEnv({ SIGNUP_BONUS_PROVIDER: 'any' });
    expect(earnsSignupBonus(env, 'password')).toBe(true);
  });

  it('gives nobody anything when the amount is zero', () => {
    const env = parseEnv({ SIGNUP_BONUS_CREDITS: '0', SIGNUP_BONUS_PROVIDER: 'any' });
    expect(earnsSignupBonus(env, 'google')).toBe(false);
    expect(earnsSignupBonus(env, 'password')).toBe(false);
  });

  it('rejects an unknown provider setting', () => {
    expect(() => parseEnv({ SIGNUP_BONUS_PROVIDER: 'everyone' })).toThrow(/SIGNUP_BONUS_PROVIDER/);
  });
});

describe('what the pages may promise', () => {
  it('promises the credits only where they can be earned', () => {
    // Google sign-in off and password accounts excluded: nothing to promise.
    expect(signupBonusOffer(parseEnv({}))).toBe(0);
    // Google sign-in on: the amount.
    expect(signupBonusOffer(parseEnv(GOOGLE))).toBe(50);
    expect(signupBonusOffer(parseEnv({ ...GOOGLE, FIREBASE_AUTH: 'off' }))).toBe(0);
    // Password accounts that earn them (development, tests) are never advertised.
    expect(signupBonusOffer(parseEnv({ SIGNUP_BONUS_PROVIDER: 'any' }))).toBe(0);
    expect(signupBonusOffer(parseEnv({ ...GOOGLE, SIGNUP_BONUS_PROVIDER: 'any' }))).toBe(50);
    // Sign-up closed: a visitor cannot take it.
    expect(signupBonusOffer(parseEnv({ ...GOOGLE, SIGNUP_ENABLED: 'false' }))).toBe(0);
    // Zero amount: never.
    expect(signupBonusOffer(parseEnv({ ...GOOGLE, SIGNUP_BONUS_CREDITS: '0' }))).toBe(0);
  });
});
