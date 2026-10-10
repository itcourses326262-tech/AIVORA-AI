import { and, eq } from 'drizzle-orm';
import type * as PasswordModule from '@/server/auth/password';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount } from '@/server/auth/account-deletion';
import { toUserDTO } from '@/server/auth/dto';
import { signInWithFirebase } from '@/server/auth/firebase-login';
import { requestPasswordReset, resetPassword } from '@/server/auth/password-reset';
import { provisionUser, registerUser } from '@/server/auth/users';
import {
  confirmEmailVerification,
  getVerificationState,
  markEmailVerified,
  pendingSignupBonus,
} from '@/server/auth/verification';
import { withTx } from '@/server/db';
import { creditLedger, signupBonusClaims, users } from '@/server/db/schema';
import { getOutbox, lastOutboxMessage } from '@/server/email';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { firebaseKeyFixture } from './firebase-support';
import { GOOD_PASSWORD, linkIn, mailTo, stubEnv, stubRelay, trustTestState } from './trust-support';

// Registration hashes the password with scrypt (slow on purpose); these tests are about who gets
// credits, so the hash is a constant.
const hashPassword = vi.hoisted(() => vi.fn(async () => 'scrypt$test-hash'));
vi.mock('@/server/auth/password', async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  hashPassword,
}));

const harness = freshDb();
trustTestState();
const minter = firebaseKeyFixture();

// Built at runtime: key-shaped literals are rejected by tests/security/no-secret-literals.test.ts.
const GOOGLE_ENV = {
  FIREBASE_API_KEY: 'k'.repeat(30),
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};
const SMTP = {
  SMTP_URL: 'smtp://mail.example.com',
  EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
};
// Any mention of free or sign-up credits in a mail, in either language.
const CREDIT_WORDS = /credit|bonus|رصيد|مجان|هدية|مكافأة/i;

/** The product policy unless a test says otherwise: only Google sign-in earns the free credits. */
beforeEach(() => stubEnv({ ...GOOGLE_ENV, SIGNUP_BONUS_PROVIDER: 'google' }));

const input = (email: string, locale: 'ar' | 'en' = 'en') => ({
  email,
  password: GOOD_PASSWORD,
  name: 'Layla',
  locale,
});

async function google(email = 'layla@example.com', sub = 'uid-layla', ip = '203.0.113.7') {
  const idToken = await minter.mint({ sub, email });
  return signInWithFirebase({ idToken, locale: 'en' }, { ip });
}

const userRow = (email: string) =>
  harness.db.select().from(users).where(eq(users.email, email)).get();
const ledgerOf = (userId: string) =>
  harness.db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).all();
const bonusRows = (userId: string) =>
  harness.db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'signup_bonus')))
    .all();
const claims = () => harness.db.select().from(signupBonusClaims).all();

describe('a password account gets no free credits', () => {
  it.each(['off', 'required'])(
    'at registration (EMAIL_VERIFICATION=%s): no balance, no ledger row, no mailbox claim, nothing pending',
    async (policy) => {
      stubEnv({ EMAIL_VERIFICATION: policy });
      const { user } = await registerUser(input('layla@example.com'));

      expect(user.creditBalance).toBe(0);
      expect(user.pendingBonusCredits).toBe(0);
      expect(userRow('layla@example.com')?.creditBalance).toBe(0);
      expect(ledgerOf(user.id)).toEqual([]);
      expect(claims()).toEqual([]);
      expect(getVerificationState(user.id)?.bonusCredits).toBe(0);
      expect(toUserDTO(userRow('layla@example.com')!).pendingBonusCredits).toBe(0);
    },
  );

  it.each(['en', 'ar'] as const)(
    'when its address is confirmed by the emailed link (%s): nothing is paid or promised',
    async (locale) => {
      stubEnv({ EMAIL_VERIFICATION: 'required', ...SMTP });
      stubRelay();
      const { user } = await registerUser(input('layla@example.com', locale));
      const mail = await mailTo('layla@example.com');
      expect(mail?.kind).toBe('verification');
      for (const body of [mail?.subject, mail?.text, mail?.html]) {
        expect(body).not.toMatch(CREDIT_WORDS);
      }

      expect(
        confirmEmailVerification(linkIn(mail).token, Date.now(), { signedInUserId: user.id }),
      ).toEqual({ verified: true, alreadyVerified: false, bonusCredits: 0 });

      const row = userRow('layla@example.com');
      expect(row?.emailVerifiedAt).not.toBeNull();
      expect(row?.creditBalance).toBe(0);
      expect(ledgerOf(user.id)).toEqual([]);
      expect(claims()).toEqual([]);
      expect(toUserDTO(row!)).toMatchObject({ emailVerified: true, pendingBonusCredits: 0 });
      // The welcome mail that follows does not claim credits that were not given.
      const welcome = await mailTo('layla@example.com');
      expect(welcome?.kind).toBe('welcome');
      expect(welcome?.text).not.toMatch(CREDIT_WORDS);
      expect(welcome?.html).not.toMatch(CREDIT_WORDS);
    },
  );

  it('registered without a confirmation step: the welcome mail names no credits either', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'off', ...SMTP });
    stubRelay();
    await registerUser(input('layla@example.com'));
    const welcome = await mailTo('layla@example.com');
    expect(welcome?.kind).toBe('welcome');
    expect(welcome?.text).not.toMatch(CREDIT_WORDS);
  });

  it('while it waits for the confirmation, the API reports nothing pending', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    const row = userRow('layla@example.com')!;
    expect(toUserDTO(row)).toMatchObject({
      emailVerified: false,
      emailVerificationRequired: true,
      pendingBonusCredits: 0,
    });
    expect(pendingSignupBonus(harness.db, row)).toBe(0);
    expect(user.emailVerificationRequired).toBe(true);
  });

  it('when a password reset proves its mailbox: confirmed, but no credits', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    expect(requestPasswordReset('layla@example.com')).toBe(true);
    const reset = (await mailTo('layla@example.com')) ?? undefined;
    await resetPassword(linkIn(reset).token, 'a-brand-new-passphrase-2026');

    expect(userRow('layla@example.com')?.emailVerifiedAt).not.toBeNull();
    expect(userRow('layla@example.com')?.creditBalance).toBe(0);
    expect(ledgerOf(user.id)).toEqual([]);
  });

  it('when the primitive is told a password confirmation may pay: still nothing, by policy', () => {
    const user = createUser(harness.db, {
      email: 'a@example.com',
      emailVerifiedAt: null,
      creditBalance: 0,
    });
    const outcome = withTx(harness.db, (tx) =>
      markEmailVerified(tx, user.id, Date.now(), { bonus: 'password' }),
    );
    expect(outcome).toMatchObject({ changed: true, bonus: null });
    expect(ledgerOf(user.id)).toEqual([]);
    expect(claims()).toEqual([]);
  });

  it('and an operator-made account starts empty unless the operator names an amount', async () => {
    const plain = await provisionUser({
      email: 'ops@example.com',
      password: GOOD_PASSWORD,
      name: 'Ops',
    });
    expect(plain.creditBalance).toBe(0);
    expect(ledgerOf(plain.id)).toEqual([]);
    expect(claims()).toEqual([]);

    const funded = await provisionUser({
      email: 'funded@example.com',
      password: GOOD_PASSWORD,
      name: 'Funded',
      bonusCredits: 20,
    });
    expect(funded.creditBalance).toBe(20);
    expectConsistentLedger(harness.db, funded.id, 0);
  });
});

describe('Google sign-in is what pays the free credits', () => {
  it('a new Google account gets exactly the sign-up credits, once', async () => {
    const first = await google();
    expect(first.created).toBe(true);
    expect(first.user.creditBalance).toBe(50);
    expect(bonusRows(first.user.id)).toMatchObject([{ delta: 50, reason: 'signup_bonus' }]);
    expect(claims()).toHaveLength(1);

    const again = await google();
    expect(again.created).toBe(false);
    expect(again.user.creditBalance).toBe(50);
    expect(bonusRows(first.user.id)).toHaveLength(1);
    expectConsistentLedger(harness.db, first.user.id, 0);
  });

  it('six simultaneous first sign-ins make one user and one bonus', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => google()));
    const userId = results[0]?.user.id ?? '';
    expect(new Set(results.map((result) => result.user.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(bonusRows(userId)).toHaveLength(1);
    expect(userRow('layla@example.com')?.creditBalance).toBe(50);
  });

  it('a Google account deleted and created again gets no second bonus', async () => {
    const first = await google();
    await deleteAccount(first.user.id, { force: true });
    const again = await google();
    expect(again.created).toBe(true);
    expect(again.user.creditBalance).toBe(0);
    expect(bonusRows(again.user.id)).toEqual([]);
    expect(claims()).toHaveLength(1);
  });

  it('the welcome mail of a new Google account names the credits it was given', async () => {
    stubEnv(SMTP);
    stubRelay();
    await google();
    const welcome = await mailTo('layla@example.com');
    expect(welcome?.kind).toBe('welcome');
    expect(welcome?.text).toContain('50 credits');
  });

  it('SIGNUP_BONUS_CREDITS=0 means nothing for Google accounts either', async () => {
    stubEnv({ SIGNUP_BONUS_CREDITS: '0' });
    const created = await google();
    expect(created.user.creditBalance).toBe(0);
    expect(ledgerOf(created.user.id)).toEqual([]);
    createUser(harness.db, { email: 'old@example.com', emailVerifiedAt: null, creditBalance: 0 });
    const claimed = await google('old@example.com', 'uid-old');
    expect(claimed.user.creditBalance).toBe(0);
  });
});

describe('an existing password account that links Google for the first time', () => {
  it('unconfirmed: the link confirms it and pays the credits, once', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    expect(user.creditBalance).toBe(0);

    const linked = await google();
    expect(linked.created).toBe(false);
    expect(linked.user.id).toBe(user.id);
    expect(linked.user.creditBalance).toBe(50);
    expect(userRow('layla@example.com')?.emailVerifiedAt).not.toBeNull();
    expect(bonusRows(user.id)).toHaveLength(1);

    await google();
    expect(bonusRows(user.id)).toHaveLength(1);
    expect(userRow('layla@example.com')?.creditBalance).toBe(50);
    expectConsistentLedger(harness.db, user.id, 0);
  });

  it('confirmed by the emailed link earlier (which paid nothing): the link pays it', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    expect(userRow('layla@example.com')?.creditBalance).toBe(0);

    const linked = await google();
    expect(linked.user.id).toBe(user.id);
    expect(linked.user.creditBalance).toBe(50);
    expect(bonusRows(user.id)).toHaveLength(1);
  });

  it('that already holds its sign-up credits (paid where passwords earned them): no second bonus', async () => {
    stubEnv({ SIGNUP_BONUS_PROVIDER: 'any', EMAIL_VERIFICATION: 'off' });
    const { user } = await registerUser(input('layla@example.com'));
    expect(user.creditBalance).toBe(50);

    stubEnv({ SIGNUP_BONUS_PROVIDER: 'google' });
    const linked = await google();
    expect(linked.user.id).toBe(user.id);
    expect(linked.user.creditBalance).toBe(50);
    expect(bonusRows(user.id)).toHaveLength(1);
  });

  it('whose mailbox was already paid under a deleted account: no bonus', async () => {
    const first = await google();
    await deleteAccount(first.user.id, { force: true });
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));

    const linked = await google('layla@example.com', 'uid-new');
    expect(linked.user.id).toBe(user.id);
    expect(linked.user.creditBalance).toBe(0);
    expect(bonusRows(user.id)).toEqual([]);
    expect(claims()).toHaveLength(1);
  });

  it('an operator-made account with no credits is paid at its first link', async () => {
    const made = await provisionUser({
      email: 'ops@example.com',
      password: GOOD_PASSWORD,
      name: 'Ops',
    });
    const linked = await google('ops@example.com', 'uid-ops');
    expect(linked.user.id).toBe(made.id);
    expect(linked.user.creditBalance).toBe(50);
    expect(bonusRows(made.id)).toHaveLength(1);
  });

  it('the welcome mail reports what this sign-in paid, not the whole balance', async () => {
    stubEnv(SMTP);
    stubRelay();
    // An unconfirmed account that already holds 12 credits from somewhere else.
    createUser(harness.db, {
      email: 'layla@example.com',
      emailVerifiedAt: null,
      creditBalance: 12,
      locale: 'en',
    });
    await google();
    await mailTo('layla@example.com');
    // (The password of that account ended too, which has its own notice.)
    const welcome = getOutbox().find((message) => message.kind === 'welcome');
    expect(welcome?.text).toContain('50 credits');
    expect(welcome?.text).not.toContain('62');
    expect(userRow('layla@example.com')?.creditBalance).toBe(62);
  });

  it('the welcome mail names no credits when none were paid (the mailbox was paid before)', async () => {
    const first = await google();
    await deleteAccount(first.user.id, { force: true });
    stubEnv(SMTP);
    stubRelay();
    createUser(harness.db, {
      email: 'layla@example.com',
      emailVerifiedAt: null,
      creditBalance: 12,
      locale: 'en',
    });

    const linked = await google('layla@example.com', 'uid-new');
    expect(linked.user.creditBalance).toBe(12);
    await mailTo('layla@example.com');
    const welcome = getOutbox().find((message) => message.kind === 'welcome');
    expect(welcome, 'the account was confirmed by this sign-in').toBeDefined();
    expect(welcome?.text).not.toMatch(CREDIT_WORDS);
  });

  it('a password registration racing the first Google sign-in still ends with one user and one bonus', async () => {
    const outcomes = await Promise.allSettled([
      google('layla@example.com', 'uid-layla', '203.0.113.10'),
      registerUser(input('layla@example.com')),
    ]);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    const rows = harness.db.select().from(users).all();
    expect(rows).toHaveLength(1);
    const userId = rows[0]?.id ?? '';
    // Whichever order they ran in: the password side pays nothing, Google pays once.
    expect(bonusRows(userId)).toHaveLength(1);
    expect(lastOutboxMessage('layla@example.com')?.text ?? '').not.toMatch(/62/);
  });
});

describe('where password accounts earn the credits too (SIGNUP_BONUS_PROVIDER=any, development)', () => {
  beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));

  it('registration pays them at once when no confirmation is needed', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    const { user } = await registerUser(input('layla@example.com'));
    expect(user.creditBalance).toBe(50);
    expect(bonusRows(user.id)).toHaveLength(1);
  });

  it('confirming pays them, the API reports them pending until then, and the mail still promises none', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    const mail = await mailTo('layla@example.com');
    expect(mail?.text).not.toMatch(CREDIT_WORDS);
    expect(toUserDTO(userRow('layla@example.com')!).pendingBonusCredits).toBe(50);
    expect(getVerificationState(user.id)?.bonusCredits).toBe(50);

    expect(confirmEmailVerification(linkIn(mail).token).bonusCredits).toBe(50);
    expect(toUserDTO(userRow('layla@example.com')!).pendingBonusCredits).toBe(0);
    expect(bonusRows(user.id)).toHaveLength(1);
  });

  it('the primitive pays only when asked to, whatever the setting', () => {
    const asked = createUser(harness.db, {
      email: 'a@example.com',
      emailVerifiedAt: null,
      creditBalance: 0,
    });
    withTx(harness.db, (tx) => markEmailVerified(tx, asked.id, Date.now(), { bonus: 'password' }));
    expect(bonusRows(asked.id)).toHaveLength(1);

    const declined = createUser(harness.db, {
      email: 'b@example.com',
      emailVerifiedAt: null,
      creditBalance: 0,
    });
    withTx(harness.db, (tx) => markEmailVerified(tx, declined.id, Date.now(), { bonus: 'none' }));
    expect(bonusRows(declined.id)).toEqual([]);
  });

  it('Google sign-in still pays, exactly once', async () => {
    const created = await google();
    expect(created.user.creditBalance).toBe(50);
    await google();
    expect(bonusRows(created.user.id)).toHaveLength(1);
  });
});
