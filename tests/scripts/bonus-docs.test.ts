import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/server/env';

const ROOT = resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

// What the owner decided: the free sign-up credits are for whoever signs up with Google. The docs
// have to say so, in both languages, and name the setting that holds the policy.

describe('the documentation of who earns the free sign-up credits', () => {
  it('.env.example documents the setting with its default', () => {
    const example = read('.env.example');
    expect(example).toMatch(/^SIGNUP_BONUS_PROVIDER=google$/m);
    expect(parseEnv({}).SIGNUP_BONUS_PROVIDER).toBe('google');
  });

  it('the README explains it in Arabic and in English, in the settings table and in the Google section', () => {
    const readme = read('README.md');
    const rows = readme.split('\n').filter((line) => line.startsWith('| `SIGNUP_BONUS_PROVIDER`'));
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toContain('`google`');
    expect(readme).toContain('**الرصيد المجاني:**');
    expect(readme).toContain('**The free credits:**');
    expect(readme).toContain('**Without Google set up nobody gets free credits**');
    expect(readme).toContain('**بلا إعداد Google لا ينال أحد رصيدًا مجانيًا**');
  });

  it('the README no longer promises the credits to every new account', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('50 رصيدًا مجانيًا عند التسجيل');
    expect(readme).not.toContain('Free credits for each new account');
    expect(readme).not.toContain('new accounts get the free credits');
  });

  it('the README quick start does not promise credits to a password account, and says how to get some locally', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('تحصل فورًا على **50 رصيدًا**');
    expect(readme).not.toContain('you get **50 credits** immediately');
    expect(readme).toContain('الحساب بكلمة المرور يبدأ **بلا رصيد**');
    expect(readme).toContain('A password account starts with **no credits**');
    expect(readme).toContain('grant-credits --email');
  });

  it('the CI smoke test funds its account with the development setting', () => {
    const ci = read('.github/workflows/ci.yml');
    expect(ci).toContain('-e SIGNUP_BONUS_PROVIDER=any');
    expect(read('.github/scripts/smoke.sh')).toContain('SIGNUP_BONUS_PROVIDER=any');
  });

  it('LAUNCH.md tells the owner that Google sign-in is what hands the credits out', () => {
    const launch = read('docs/LAUNCH.md');
    expect(launch).toContain('If you do not set up Google sign-in');
    expect(launch).toContain('nobody gets free credits');
    expect(launch).toContain('فلن ينال أحد رصيدًا مجانيًا');
    expect(launch).not.toContain('a new account **gets no free credits and cannot generate');
  });

  it('OPERATIONS.md shows how to give credits by hand, and that confirming pays none', () => {
    const operations = read('docs/OPERATIONS.md');
    expect(operations).toContain('$ADMIN grant-credits --email');
    expect(operations).toContain('This is also how a user gets free credits by hand');
    expect(operations).toContain('It pays no credits');
  });

  it('ARCHITECTURE.md has the paragraph with the policy and the knob', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    expect(architecture).toContain('**Who earns the free credits.**');
    expect(architecture).toContain('`SIGNUP_BONUS_PROVIDER`');
    expect(architecture).toContain('`earnsSignupBonus(env');
    expect(architecture).toContain('`signupBonusOffer(env)`');
  });
});
