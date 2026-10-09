import { and, eq } from 'drizzle-orm';
import type * as PasswordModule from '@/server/auth/password';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { deleteAccount } from '@/server/auth/account-deletion';
import { UNKNOWN_ADDRESS_CAP_FACTOR, signupCapFor } from '@/server/auth/signup-guard';
import { confirmEmailVerification } from '@/server/auth/verification';
import { provisionUser, registerUser } from '@/server/auth/users';
import { creditLedger, emailTokens, signupBonusClaims, users } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { lastOutboxMessage } from '@/server/email';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { GOOD_PASSWORD, linkIn, mailTo, stubEnv, stubRelay, trustTestState } from './trust-support';

// Registration hashes the password with scrypt (slow on purpose); these tests are about the rules
// around it, so the hash is a constant. The real thing is covered by users.test.ts.
const hashPassword = vi.hoisted(() => vi.fn(async () => 'scrypt$test-hash'));
vi.mock('@/server/auth/password', async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  hashPassword,
}));

const harness = freshDb();
trustTestState();

const input = (email: string, overrides: Partial<Parameters<typeof registerUser>[0]> = {}) => ({
  email,
  password: GOOD_PASSWORD,
  name: 'Layla',
  locale: 'en' as const,
  ...overrides,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const userRow = (email: string) =>
  harness.db.select().from(users).where(eq(users.email, email)).get();
const bonusRows = (userId: string) =>
  harness.db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'signup_bonus')))
    .all();

describe('the confirmation policy matrix (EMAIL_VERIFICATION x SMTP configured)', () => {
  const smtp = {
    SMTP_URL: 'smtp://mail.example.com',
    EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
  };

  it.each([
    ['auto', true, true],
    ['auto', false, false],
    ['required', true, true],
    ['required', false, true],
    ['off', true, false],
    ['off', false, false],
  ] as const)(
    'EMAIL_VERIFICATION=%s, SMTP configured=%s -> confirmation required=%s',
    async (policy, withSmtp, required) => {
      stubEnv({
        EMAIL_VERIFICATION: policy,
        ADMIN_EMAILS: 'layla@example.com',
        ...(withSmtp ? smtp : {}),
      });
      if (withSmtp) stubRelay();
      const result = await registerUser(input('layla@example.com'));
      const row = userRow('layla@example.com');
      const tokens = harness.db
        .select()
        .from(emailTokens)
        .where(eq(emailTokens.userId, result.user.id))
        .all();
      await mailTo('layla@example.com');

      if (required) {
        // No credits and no privileges until the mailbox is proven.
        expect(result.user.creditBalance).toBe(0);
        expect(row).toMatchObject({ creditBalance: 0, role: 'user', emailVerifiedAt: null });
        expect(bonusRows(result.user.id)).toEqual([]);
        expect(tokens).toHaveLength(1);
        expect(tokens[0]).toMatchObject({ type: 'verify', usedAt: null });
        const mail = lastOutboxMessage('layla@example.com');
        expect(mail).toMatchObject({ kind: 'verification' });
        const { url, token } = linkIn(mail);
        expect(url.pathname).toBe('/verify-email');
        expect(url.origin).toBe('http://localhost:3000');

        // Confirming grants the bonus exactly once. A bare click does not promote the admin
        // address (see admin-promotion.test.ts); the account's own signed-in session does.
        const confirmed = confirmEmailVerification(token, Date.now(), {
          signedInUserId: result.user.id,
        });
        expect(confirmed).toEqual({ verified: true, alreadyVerified: false, bonusCredits: 50 });
        expect(userRow('layla@example.com')).toMatchObject({
          creditBalance: 50,
          role: 'admin',
        });
        expect(userRow('layla@example.com')?.emailVerifiedAt).not.toBeNull();
        expect(bonusRows(result.user.id)).toHaveLength(1);
        expectConsistentLedger(harness.db, result.user.id, 0);
        await mailTo('layla@example.com');
        expect(lastOutboxMessage('layla@example.com')?.kind).toBe('welcome');
      } else {
        // Today's first-run behaviour: the bonus is part of registration.
        expect(result.user.creditBalance).toBe(50);
        expect(row).toMatchObject({ creditBalance: 50, role: 'admin', emailVerifiedAt: null });
        expect(bonusRows(result.user.id)).toHaveLength(1);
        expect(tokens).toEqual([]);
        // A welcome message is only worth sending where mail really leaves the machine.
        expect(lastOutboxMessage('layla@example.com')?.kind).toBe(withSmtp ? 'welcome' : undefined);
      }
    },
  );

  it('grants the bonus once even if the same link is replayed or the bonus size changes meanwhile', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    const { token } = linkIn(await mailTo('layla@example.com'));
    stubEnv({ EMAIL_VERIFICATION: 'required', SIGNUP_BONUS_CREDITS: '80' });
    confirmEmailVerification(token);
    expect(() => confirmEmailVerification(token)).toThrow(/invalid, expired or was already used/);
    expect(bonusRows(user.id).map((row) => row.delta)).toEqual([80]);
    expect(userRow('layla@example.com')?.creditBalance).toBe(80);
  });

  it('leaves an account that registered under "off" alone when it confirms later', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    const { user } = await registerUser(input('layla@example.com'));
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    // Another link (requested while the policy was on) must not pay the bonus a second time.
    const { requestEmailVerification } = await import('@/server/auth/verification');
    await requestEmailVerification(user.id);
    const { token } = linkIn(await mailTo('layla@example.com'));
    expect(confirmEmailVerification(token).bonusCredits).toBe(0);
    expect(bonusRows(user.id)).toHaveLength(1);
    expect(userRow('layla@example.com')?.creditBalance).toBe(50);
  });

  it('SIGNUP_BONUS_CREDITS=0 means no bonus either way', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required', SIGNUP_BONUS_CREDITS: '0' });
    const { user } = await registerUser(input('layla@example.com'));
    const { token } = linkIn(await mailTo('layla@example.com'));
    expect(confirmEmailVerification(token).bonusCredits).toBe(0);
    expect(bonusRows(user.id)).toEqual([]);
  });

  it('names the bonus in the confirmation email only when there is one to unlock', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    await registerUser(input('layla@example.com'));
    expect((await mailTo('layla@example.com'))?.text).toContain('50 credits');
    stubEnv({ EMAIL_VERIFICATION: 'required', SIGNUP_BONUS_CREDITS: '0' });
    await registerUser(input('omar@example.com'));
    expect((await mailTo('omar@example.com'))?.text).not.toContain('credits');
  });

  it('writes the email in the language the person registered with', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    await registerUser(input('layla@example.com', { locale: 'ar' }));
    const mail = await mailTo('layla@example.com');
    expect(mail?.html).toContain('<html lang="ar" dir="rtl">');
    expect(mail?.subject).toBe('أكّد بريدك الإلكتروني في AIVORE');
  });
});

describe('operator-created accounts', () => {
  it('are confirmed on the spot and receive their credits, even where confirmation is required', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const user = await provisionUser({
      email: 'ops@example.com',
      password: GOOD_PASSWORD,
      name: 'Ops',
      role: 'admin',
    });
    const row = userRow('ops@example.com');
    expect(row?.emailVerifiedAt).not.toBeNull();
    expect(user.creditBalance).toBe(50);
    expect(row?.signupIp).toBeNull();
    expect(harness.db.select().from(emailTokens).all()).toEqual([]);
  });

  it('are not subject to the throwaway-mail list or the sign-up cap (the operator vouches)', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    await provisionUser({ email: 'a@mailinator.com', password: GOOD_PASSWORD, name: 'A' });
    await provisionUser({ email: 'b@mailinator.com', password: GOOD_PASSWORD, name: 'B' });
    expect(harness.db.select().from(users).all()).toHaveLength(2);
  });
});

describe('aliases of one mailbox', () => {
  const generic = 'This account could not be created with these details';

  it.each([
    ['ab@gmail.com', 'a.b@gmail.com'],
    ['ab@gmail.com', 'a.b+promo@gmail.com'],
    ['a.b@gmail.com', 'ab@googlemail.com'],
    ['AB@Gmail.com', 'a.b+1@gmail.com'],
    ['name@example.com', 'name+second@example.com'],
    ['name+first@example.com', 'name+second@example.com'],
  ])('refuses %s after %s with the same answer as a plain duplicate', async (first, second) => {
    await registerUser(input(first));
    const error = await failure(registerUser(input(second, { name: 'Someone else' })));
    expect(error).toMatchObject({ code: 'conflict', status: 409, message: generic });
    expect(error.details).toBeUndefined();
    const plain = await failure(registerUser(input(first)));
    expect(plain.message).toBe(error.message);
    expect(harness.db.select().from(users).all()).toHaveLength(1);
  });

  it('lets different mailboxes through: dots matter outside Gmail, and other names are other people', async () => {
    await registerUser(input('first.last@example.com'));
    await registerUser(input('firstlast@example.com'));
    await registerUser(input('someone.else@gmail.com'));
    await registerUser(input('someoneelse2@gmail.com'));
    expect(harness.db.select().from(users).all()).toHaveLength(4);
  });

  it('keeps the address as typed (lower-cased) and stores the canonical form beside it', async () => {
    await registerUser(input('  A.B+Promo@Gmail.com '));
    expect(userRow('a.b+promo@gmail.com')).toMatchObject({
      email: 'a.b+promo@gmail.com',
      emailCanonical: 'ab@gmail.com',
    });
  });

  it('also protects rows that predate the canonical column', async () => {
    // A legacy row: no canonical form stored.
    createUser(harness.db, { email: 'legacy@gmail.com', emailCanonical: null });
    const error = await failure(registerUser(input('leg.acy+x@gmail.com')));
    expect(error.code).toBe('conflict');
  });

  it('is backed by a unique index, so two simultaneous sign-ups cannot both win', async () => {
    createUser(harness.db, { email: 'someone@example.com', emailCanonical: 'someone@example.com' });
    expect(() =>
      createUser(harness.db, {
        email: 'someone+x@example.com',
        emailCanonical: 'someone@example.com',
      }),
    ).toThrow(/UNIQUE/);
  });
});

describe('throwaway email addresses', () => {
  it('are refused with a clear, localizable code - before any password is hashed', async () => {
    hashPassword.mockClear();
    const error = await failure(registerUser(input('someone@mailinator.com')));
    expect(error).toMatchObject({ code: 'email_not_allowed', status: 422 });
    expect(hashPassword).not.toHaveBeenCalled();
    expect(harness.db.select().from(users).all()).toEqual([]);
  });

  it('are refused whatever the case or subdomain', async () => {
    for (const email of ['x@YOPMAIL.com', 'x@mail.guerrillamail.com']) {
      expect((await failure(registerUser(input(email)))).code).toBe('email_not_allowed');
    }
  });

  it('can be extended by the operator', async () => {
    await registerUser(input('someone@throwaway.example'));
    stubEnv({ DISPOSABLE_EMAIL_DOMAINS: 'Throwaway.Example, other.test' });
    expect((await failure(registerUser(input('second@throwaway.example')))).code).toBe(
      'email_not_allowed',
    );
    expect((await failure(registerUser(input('x@sub.other.test')))).code).toBe('email_not_allowed');
  });

  it('say the same thing whether or not the (otherwise valid) address is already registered', async () => {
    await registerUser(input('taken@example.com'));
    const first = await failure(registerUser(input('someone@mailinator.com')));
    const second = await failure(registerUser(input('someone-else@mailinator.com')));
    expect(first.message).toBe(second.message);
  });
});

describe('the daily cap per client address', () => {
  it('stops an address after its share and leaves other addresses alone', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '2' });
    await registerUser(input('a@example.com'), { ip: '203.0.113.7' });
    await registerUser(input('b@example.com'), { ip: '203.0.113.7' });
    const error = await failure(registerUser(input('c@example.com'), { ip: '203.0.113.7' }));
    expect(error).toMatchObject({ code: 'signup_limit', status: 429 });
    const retry = (error.details as { retryAfterSec: number }).retryAfterSec;
    expect(retry).toBeGreaterThan(23 * 3600);
    expect(retry).toBeLessThanOrEqual(24 * 3600);
    expect(userRow('c@example.com')).toBeUndefined();

    await registerUser(input('d@example.com'), { ip: '203.0.113.8' });
    expect(harness.db.select().from(users).all()).toHaveLength(3);
  });

  it('stores the address on the account and counts a rolling 24 hours', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    const { user } = await registerUser(input('a@example.com'), { ip: '203.0.113.7' });
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()?.signupIp).toBe(
      '203.0.113.7',
    );
    expect((await failure(registerUser(input('b@example.com'), { ip: '203.0.113.7' }))).code).toBe(
      'signup_limit',
    );
    // 25 hours later the account no longer counts.
    harness.db
      .update(users)
      .set({ createdAt: Date.now() - 25 * 3600 * 1000 })
      .where(eq(users.id, user.id))
      .run();
    await registerUser(input('b@example.com'), { ip: '203.0.113.7' });
  });

  it('is off with SIGNUPS_PER_IP_PER_DAY=0 and with RATE_LIMIT_DISABLED=true (e2e suites)', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '0' });
    for (const name of ['a', 'b', 'c'])
      await registerUser(input(`${name}@example.com`), { ip: '203.0.113.7' });
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1', RATE_LIMIT_DISABLED: 'true' });
    for (const name of ['d', 'e'])
      await registerUser(input(`${name}@example.com`), { ip: '203.0.113.7' });
    expect(harness.db.select().from(users).all()).toHaveLength(5);
  });

  describe('when the address is unknown (no trusted proxy)', () => {
    it('shares a much larger budget, so one script cannot close sign-up for everybody', () => {
      // 1000 accounts a day at the default of 5: a launch day does not lock out newcomers.
      expect(UNKNOWN_ADDRESS_CAP_FACTOR).toBe(200);
      expect(
        signupCapFor(undefined, { SIGNUPS_PER_IP_PER_DAY: 5, RATE_LIMIT_DISABLED: false }),
      ).toBe(1000);
      expect(
        signupCapFor('unknown', { SIGNUPS_PER_IP_PER_DAY: 5, RATE_LIMIT_DISABLED: false }),
      ).toBe(1000);
      expect(
        signupCapFor('203.0.113.7', { SIGNUPS_PER_IP_PER_DAY: 5, RATE_LIMIT_DISABLED: false }),
      ).toBe(5);
      expect(
        signupCapFor('x', { SIGNUPS_PER_IP_PER_DAY: 0, RATE_LIMIT_DISABLED: false }),
      ).toBeNull();
    });

    it('still bounds how many accounts a day can mint', async () => {
      stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
      for (let index = 0; index < UNKNOWN_ADDRESS_CAP_FACTOR - 1; index += 1) {
        createUser(harness.db, { signupIp: 'unknown' });
      }
      await registerUser(input('last-one@example.com'), { ip: 'unknown' });
      expect((await failure(registerUser(input('too-many@example.com')))).code).toBe(
        'signup_limit',
      );
    });
  });

  it('leaves no half-made account behind: a refused sign-up creates nothing, not even a bonus', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    await registerUser(input('a@example.com'), { ip: '203.0.113.7' });
    await failure(registerUser(input('b@example.com'), { ip: '203.0.113.7' }));
    expect(harness.db.select().from(users).all()).toHaveLength(1);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(1);
    expect(harness.db.select().from(signupBonusClaims).all()).toHaveLength(1);
  });
});

describe('the free bonus is claimed once per mailbox, even across deletion', () => {
  it('a deleted account that registers again gets the account but not a second bonus', async () => {
    const first = await registerUser(input('layla@example.com'));
    expect(first.user.creditBalance).toBe(50);
    await deleteAccount(first.user.id);

    const second = await registerUser(input('layla@example.com'));
    expect(second.user.id).not.toBe(first.user.id);
    expect(second.user.creditBalance).toBe(0);
    expect(bonusRows(second.user.id)).toEqual([]);
  });

  it('holds for an alias of the same mailbox', async () => {
    const first = await registerUser(input('lay.la@gmail.com'));
    await deleteAccount(first.user.id);
    const again = await registerUser(input('laylA+again@gmail.com'));
    expect(again.user.creditBalance).toBe(0);
  });

  it('stores a keyed hash of the mailbox, never the address', async () => {
    const { user } = await registerUser(input('layla@example.com'));
    const claims = harness.db.select().from(signupBonusClaims).all();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ userId: user.id });
    expect(claims[0]?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(claims)).not.toContain('layla');
  });

  it('under mandatory confirmation, the second account confirms without a bonus', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const first = await registerUser(input('layla@example.com'));
    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    await deleteAccount(first.user.id);

    const second = await registerUser(input('layla@example.com'));
    const outcome = confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    expect(outcome).toMatchObject({ verified: true, bonusCredits: 0 });
    expect(userRow('layla@example.com')?.id).toBe(second.user.id);
    expect(userRow('layla@example.com')?.creditBalance).toBe(0);
  });
});

describe('administrators are made by proof, not by typing', () => {
  it('without confirmation required, the listed address is admin at registration (the documented risk)', async () => {
    stubEnv({ ADMIN_EMAILS: 'boss@example.com' });
    const { user } = await registerUser(input('boss@example.com'));
    expect(user.role).toBe('admin');
  });

  it('with confirmation required, nobody is admin until the mailbox is proven', async () => {
    stubEnv({ ADMIN_EMAILS: 'boss@example.com', EMAIL_VERIFICATION: 'required' });
    const squatter = await registerUser(input('boss@example.com'));
    expect(squatter.user.role).toBe('user');
    expect(userRow('boss@example.com')?.role).toBe('user');
    // The squatter cannot read the mailbox; the owner can. Reading it proves the mailbox, not who
    // holds the account, so the click alone does not promote (admin-promotion.test.ts has the
    // signed-in and password-reset cases that do).
    confirmEmailVerification(linkIn(await mailTo('boss@example.com')).token);
    expect(userRow('boss@example.com')?.role).toBe('user');
  });
});

describe('policy changes mid-flight', () => {
  it('registration under "required" leaves a usable link even if the policy is switched off afterwards', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    stubEnv({ EMAIL_VERIFICATION: 'off' });
    resetEnvForTests();
    const outcome = confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    expect(outcome.bonusCredits).toBe(50);
    expect(bonusRows(user.id)).toHaveLength(1);
  });
});
