import { describe, expect, it, vi } from 'vitest';
import { isEmailVerificationRequired } from '@/server/auth/email-policy';
import { resetEnvForTests } from '@/server/env';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { authContextFor, createApiKeyFor } from './trust-fixtures';
import { trustTestState } from './trust-support';

const harness = freshDb();
trustTestState();

describe('isEmailVerificationRequired: the policy matrix', () => {
  const smtp = { SMTP_URL: 'smtp://mail.example.com', SMTP_HOST: undefined };
  const noSmtp = { SMTP_URL: undefined, SMTP_HOST: undefined };

  it.each([
    ['auto', true, true],
    ['auto', false, false],
    ['required', true, true],
    ['required', false, true],
    ['off', true, false],
    ['off', false, false],
  ] as const)(
    'EMAIL_VERIFICATION=%s with SMTP configured=%s -> required=%s',
    (policy, withSmtp, expected) => {
      expect(
        isEmailVerificationRequired({ EMAIL_VERIFICATION: policy, ...(withSmtp ? smtp : noSmtp) }),
      ).toBe(expected);
    },
  );

  it('SMTP_HOST alone counts as configured', () => {
    expect(
      isEmailVerificationRequired({
        EMAIL_VERIFICATION: 'auto',
        SMTP_URL: undefined,
        SMTP_HOST: 'mail.example.com',
      }),
    ).toBe(true);
  });

  it('reads the live environment by default, and defaults to off on a fresh checkout', () => {
    expect(isEmailVerificationRequired()).toBe(false);
    vi.stubEnv('SMTP_URL', 'smtp://mail.example.com');
    vi.stubEnv('EMAIL_FROM', 'a@example.com');
    resetEnvForTests();
    expect(isEmailVerificationRequired()).toBe(true);
  });
});

describe('AuthContext.mustVerifyEmail follows the policy and the account', () => {
  it('is false while confirmation is not required, whatever the account', async () => {
    const { db } = harness;
    const user = createUser(db, { emailVerifiedAt: null });
    expect((await authContextFor(db, user.id))?.mustVerifyEmail).toBe(false);
  });

  it('is true for an unconfirmed account once confirmation is required, for a session and for an API key', async () => {
    vi.stubEnv('EMAIL_VERIFICATION', 'required');
    resetEnvForTests();
    const { db } = harness;
    const user = createUser(db, { emailVerifiedAt: null });
    expect((await authContextFor(db, user.id))?.mustVerifyEmail).toBe(true);
    expect((await createApiKeyFor(user.id))?.mustVerifyEmail).toBe(true);
  });

  it('is false for a confirmed account', async () => {
    vi.stubEnv('EMAIL_VERIFICATION', 'required');
    resetEnvForTests();
    const { db } = harness;
    const user = createUser(db, { emailVerifiedAt: Date.now() });
    expect((await authContextFor(db, user.id))?.mustVerifyEmail).toBe(false);
  });
});
