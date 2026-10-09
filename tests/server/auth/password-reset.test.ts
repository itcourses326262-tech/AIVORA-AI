import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { EmailTokenError, issueEmailToken } from '@/server/auth/email-tokens';
import { createApiKey, resolveApiKey } from '@/server/auth/api-keys';
import { verifyPassword } from '@/server/auth/password';
import {
  RESET_MIN_GAP_MS,
  requestPasswordReset,
  resetPassword,
} from '@/server/auth/password-reset';
import { resolveSession } from '@/server/auth/sessions';
import { loginUser } from '@/server/auth/users';
import { emailTokens, sessions, users } from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { freshDb } from '../../helpers/db';
import { createSession, createUser } from '../../helpers/factories';
import { GOOD_PASSWORD, linkIn, mailTo, passwordFixture, trustTestState } from './trust-support';

const harness = freshDb();
const fixture = passwordFixture();
trustTestState();

const NEW_PASSWORD = 'a completely different passphrase 42';

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  const error = await failure(promise);
  expect(error).toBeInstanceOf(EmailTokenError);
  return (error as EmailTokenError).reason;
};

let user: ReturnType<typeof createUser>;
beforeEach(() => {
  user = createUser(harness.db, {
    email: 'layla@example.com',
    name: 'Layla',
    locale: 'en',
    passwordHash: fixture.hash,
    emailVerifiedAt: null,
  });
});

const hash = () =>
  harness.db.select().from(users).where(eq(users.id, user.id)).get()?.passwordHash ?? '';

describe('requestPasswordReset', () => {
  it('mails a link for an active account', async () => {
    expect(requestPasswordReset('layla@example.com')).toBe(true);
    const mail = await mailTo('layla@example.com');
    expect(mail).toMatchObject({ kind: 'password_reset', subject: 'Reset your AIVORE password' });
    const { url, token } = linkIn(mail);
    expect(url.pathname).toBe('/reset-password');
    expect(url.origin).toBe('http://localhost:3000');
    expect(token).toHaveLength(43);
    expect(harness.db.select().from(emailTokens).all()).toMatchObject([
      { type: 'reset', userId: user.id },
    ]);
  });

  it('finds the account whatever the case or surrounding space', async () => {
    expect(requestPasswordReset('  Layla@Example.COM ')).toBe(true);
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(1);
  });

  it.each([
    ['an unknown address', () => 'nobody@example.com'],
    ['an empty string', () => ''],
    [
      'a disabled account',
      () => {
        harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
        return 'layla@example.com';
      },
    ],
    [
      'a deleted account',
      () => {
        harness.db
          .update(users)
          .set({ deletedAt: Date.now(), email: 'gone@deleted.invalid' })
          .where(eq(users.id, user.id))
          .run();
        return 'layla@example.com';
      },
    ],
  ])('sends nothing and stores nothing for %s', async (_label, prepare) => {
    const email = prepare();
    expect(requestPasswordReset(email)).toBe(false);
    await mailTo('layla@example.com');
    expect(getOutbox()).toEqual([]);
    expect(harness.db.select().from(emailTokens).all()).toEqual([]);
  });

  it('does not mail the same account twice within a minute (mail-bombing guard)', async () => {
    const now = Date.now();
    expect(requestPasswordReset('layla@example.com', now)).toBe(true);
    expect(requestPasswordReset('layla@example.com', now + RESET_MIN_GAP_MS - 1)).toBe(false);
    expect(requestPasswordReset('layla@example.com', now + RESET_MIN_GAP_MS)).toBe(true);
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(2);
  });

  it('writes the mail in the account language', async () => {
    harness.db.update(users).set({ locale: 'ar' }).where(eq(users.id, user.id)).run();
    requestPasswordReset('layla@example.com');
    const mail = await mailTo('layla@example.com');
    expect(mail?.html).toContain('dir="rtl"');
    expect(mail?.subject).toBe('إعادة تعيين كلمة المرور في AIVORE');
  });
});

describe('resetPassword', () => {
  function issue() {
    return issueEmailToken(harness.db, user.id, 'reset');
  }

  it('sets the password, signs out EVERY device and tells the owner', async () => {
    const sessionsBefore = [
      createSession(harness.db, user.id),
      createSession(harness.db, user.id),
      createSession(harness.db, user.id),
    ];
    const { secret } = issue();

    await resetPassword(secret, NEW_PASSWORD);

    expect(await verifyPassword(NEW_PASSWORD, hash())).toBe(true);
    expect(await verifyPassword(GOOD_PASSWORD, hash())).toBe(false);
    for (const session of sessionsBefore) {
      expect(resolveSession(session.token, harness.db)).toBeNull();
    }
    expect(harness.db.select().from(sessions).where(eq(sessions.userId, user.id)).all()).toEqual(
      [],
    );

    const notice = await mailTo('layla@example.com');
    expect(notice).toMatchObject({ kind: 'password_changed' });
    expect(notice?.text).toContain('UTC');
    expect(linkIn(notice).url.pathname).toBe('/forgot-password');

    // The new password signs in; the old one does not.
    await expect(
      loginUser({ email: 'layla@example.com', password: NEW_PASSWORD }),
    ).resolves.toMatchObject({
      user: { id: user.id },
    });
    await expect(
      loginUser({ email: 'layla@example.com', password: GOOD_PASSWORD }),
    ).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('works once; the second attempt says "used" and changes nothing', async () => {
    const { secret } = issue();
    await resetPassword(secret, NEW_PASSWORD);
    const afterFirst = hash();
    expect(await reasonOf(resetPassword(secret, 'yet another good passphrase 7'))).toBe('used');
    expect(hash()).toBe(afterFirst);
  });

  it('expires after an hour', async () => {
    const now = Date.now();
    const { secret, expiresAt } = issueEmailToken(harness.db, user.id, 'reset', now);
    expect(await reasonOf(resetPassword(secret, NEW_PASSWORD, expiresAt))).toBe('expired');
    expect(await verifyPassword(GOOD_PASSWORD, hash())).toBe(true);
    // Not burned by the expired attempt: still good a moment before the deadline.
    await resetPassword(secret, NEW_PASSWORD, expiresAt - 1);
    expect(await verifyPassword(NEW_PASSWORD, hash())).toBe(true);
  });

  it.each([
    ['tampered', (secret: string) => `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`],
    ['truncated', (secret: string) => secret.slice(0, 20)],
    ['empty', () => ''],
    ['not a token at all', () => 'please let me in'],
  ])('refuses a %s link', async (_label, mangle) => {
    const { secret } = issue();
    expect(await reasonOf(resetPassword(mangle(secret), NEW_PASSWORD))).toBe('invalid');
    expect(await verifyPassword(GOOD_PASSWORD, hash())).toBe(true);
  });

  it('refuses a confirmation link: the kinds are not interchangeable', async () => {
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    expect(await reasonOf(resetPassword(secret, NEW_PASSWORD))).toBe('invalid');
  });

  it('applies the password policy before burning the link: a weak password can be corrected', async () => {
    const { secret } = issue();
    for (const weak of ['short', 'password', 'layla@example.com', 'aaaaaaaaaaaa', '']) {
      const error = await failure(resetPassword(secret, weak));
      expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
      expect((error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe(
        'password',
      );
    }
    expect(await verifyPassword(GOOD_PASSWORD, hash())).toBe(true);
    await resetPassword(secret, NEW_PASSWORD);
    expect(await verifyPassword(NEW_PASSWORD, hash())).toBe(true);
  });

  it('checks the link before the password, so a dead link is "used" even with a weak password', async () => {
    const { secret } = issue();
    await resetPassword(secret, NEW_PASSWORD);
    expect(await reasonOf(resetPassword(secret, 'short'))).toBe('used');
  });

  it('kills the other outstanding reset links, but not confirmation links', async () => {
    const first = issue();
    const second = issue();
    const verify = issueEmailToken(harness.db, user.id, 'verify');
    await resetPassword(first.secret, NEW_PASSWORD);
    expect(await reasonOf(resetPassword(second.secret, 'another good passphrase 99'))).toBe('used');
    const rows = harness.db.select().from(emailTokens).where(eq(emailTokens.id, verify.id)).get();
    expect(rows?.usedAt).toBeNull();
  });

  it('lets exactly one of two simultaneous submissions win', async () => {
    const { secret } = issue();
    const results = await Promise.allSettled([
      resetPassword(secret, 'first simultaneous passphrase 1'),
      resetPassword(secret, 'second simultaneous passphrase 2'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = results.find((result) => result.status === 'rejected');
    expect(lost?.status === 'rejected' && lost.reason).toBeInstanceOf(EmailTokenError);
    // Whichever won, exactly one of the two passwords is now the password.
    const first = await verifyPassword('first simultaneous passphrase 1', hash());
    const second = await verifyPassword('second simultaneous passphrase 2', hash());
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('proves the mailbox: the address counts as confirmed (and the bonus follows, once)', async () => {
    const before = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(before?.emailVerifiedAt).toBeNull();
    const { secret } = issue();
    await resetPassword(secret, NEW_PASSWORD);
    const after = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(after?.emailVerifiedAt).toBeGreaterThan(0);
  });

  it('does not reset a disabled account, nor revive a deleted one', async () => {
    const { secret } = issue();
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(await reasonOf(resetPassword(secret, NEW_PASSWORD))).toBe('invalid');
    expect(await verifyPassword(GOOD_PASSWORD, hash())).toBe(true);
    harness.db
      .update(users)
      .set({ disabledAt: null, deletedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();
    expect(await reasonOf(resetPassword(secret, NEW_PASSWORD))).toBe('invalid');
  });

  it('revokes API keys as well (the details are in credential-eviction.test.ts)', async () => {
    const { key } = await createApiKey(user.id, 'ci');
    const { secret } = issue();
    await resetPassword(secret, NEW_PASSWORD);
    expect(resolveApiKey(key, harness.db)).toBeNull();
  });
});
