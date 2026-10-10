import { eq } from 'drizzle-orm';
import type * as BonusModule from '@/server/auth/bonus';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { EmailTokenError, findEmailToken, issueEmailToken } from '@/server/auth/email-tokens';
import {
  RESEND_COOLDOWN_SEC,
  confirmEmailVerification,
  getVerificationState,
  markEmailVerified,
  pendingSignupBonus,
  requestEmailVerification,
  resendVerificationNow,
} from '@/server/auth/verification';
import { withTx } from '@/server/db';
import { creditLedger, emailTokens, users } from '@/server/db/schema';
import { getOutbox, lastOutboxMessage } from '@/server/email';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { linkIn, mailTo, stubEnv, trustTestState } from './trust-support';

const failing = vi.hoisted(() => ({ ledger: false }));
vi.mock('@/server/auth/bonus', async (importOriginal) => {
  const real = await importOriginal<typeof BonusModule>();
  return {
    ...real,
    grantSignupBonus: (...args: Parameters<typeof real.grantSignupBonus>) => {
      if (failing.ledger) throw new Error('ledger down');
      return real.grantSignupBonus(...args);
    },
  };
});

const harness = freshDb();
trustTestState();
// The mechanics below (paid once, in the confirming transaction, undone with it) are those of the
// sign-up bonus wherever password accounts earn it. WHO earns it is google-only-bonus.test.ts.
beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));

const SECOND = 1000;

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function reasonOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EmailTokenError) return error.reason;
    throw error;
  }
  return 'ok';
}

const userRow = (id: string) => harness.db.select().from(users).where(eq(users.id, id)).get();

function unconfirmedUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  return createUser(harness.db, {
    email: 'layla@example.com',
    name: 'Layla',
    locale: 'en',
    creditBalance: 0,
    emailVerifiedAt: null,
    ...overrides,
  });
}

describe('requestEmailVerification', () => {
  it('mails a fresh link and starts the resend gap', async () => {
    const user = unconfirmedUser();
    const result = await requestEmailVerification(user.id);
    expect(result).toEqual({ sent: true, verified: false, resendAfterSec: RESEND_COOLDOWN_SEC });

    const mail = await mailTo('layla@example.com');
    expect(mail?.kind).toBe('verification');
    const { url, token } = linkIn(mail);
    expect(url.pathname).toBe('/verify-email');
    // The link in the mail is the one the database knows (by hash only).
    expect(findEmailToken(harness.db, 'verify', token)).toMatchObject({ userId: user.id });
  });

  it('answers a repeat within the gap with 429 and how long to wait, and sends nothing more', async () => {
    const user = unconfirmedUser();
    const start = Date.now();
    await requestEmailVerification(user.id, start);
    await mailTo('layla@example.com');

    const error = await failure(requestEmailVerification(user.id, start + 20 * SECOND));
    expect(error).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(error.details).toEqual({ retryAfterSec: 40 });
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(1);
    expect(harness.db.select().from(emailTokens).all()).toHaveLength(1);

    // Exactly at the end of the gap it works again.
    await expect(requestEmailVerification(user.id, start + 60 * SECOND)).resolves.toMatchObject({
      sent: true,
    });
    expect(harness.db.select().from(emailTokens).all()).toHaveLength(2);
  });

  it('counts the link mailed at registration towards the gap', async () => {
    const user = unconfirmedUser();
    issueEmailToken(harness.db, user.id, 'verify', Date.now() - 10 * SECOND);
    const error = await failure(requestEmailVerification(user.id));
    expect(error.code).toBe('rate_limited');
    expect((error.details as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(40);
    expect((error.details as { retryAfterSec: number }).retryAfterSec).toBeLessThanOrEqual(50);
  });

  it('has nothing to send to an account that is already confirmed', async () => {
    const user = unconfirmedUser({ emailVerifiedAt: Date.now() });
    expect(await requestEmailVerification(user.id)).toEqual({
      sent: false,
      verified: true,
      resendAfterSec: 0,
    });
    await mailTo('layla@example.com');
    expect(getOutbox()).toEqual([]);
    expect(harness.db.select().from(emailTokens).all()).toEqual([]);
  });

  it.each([
    ['an unknown id', () => 'usr_00000000000000000000000000'],
    ['a deleted account', () => unconfirmedUser({ deletedAt: Date.now() }).id],
    ['a disabled account', () => unconfirmedUser({ disabledAt: Date.now() }).id],
  ])('is "not found" for %s', async (_label, makeId) => {
    expect((await failure(requestEmailVerification(makeId()))).code).toBe('not_found');
  });

  it('never promises credits: confirming an address is not what pays them', async () => {
    const user = unconfirmedUser();
    // Even where password accounts do get a bonus (the setting of this file), the mail only asks
    // for the confirmation.
    expect(pendingSignupBonus(harness.db, user)).toBe(50);
    await requestEmailVerification(user.id);
    expect((await mailTo('layla@example.com'))?.text).not.toMatch(/credit|bonus/i);
  });
});

describe('resendVerificationNow (operators)', () => {
  it('ignores the gap, and reports an account that is already confirmed', async () => {
    const user = unconfirmedUser();
    expect(resendVerificationNow(user.id)).toBe(true);
    expect(resendVerificationNow(user.id)).toBe(true);
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(2);
    const done = unconfirmedUser({ email: 'done@example.com', emailVerifiedAt: Date.now() });
    expect(resendVerificationNow(done.id)).toBe(false);
    expect(() => resendVerificationNow('usr_00000000000000000000000000')).toThrow(/not found/i);
  });
});

describe('getVerificationState', () => {
  it('reports the policy, the account and the remaining gap', () => {
    const user = unconfirmedUser();
    const now = Date.now();
    expect(getVerificationState(user.id, now)).toEqual({
      required: false,
      verified: false,
      email: 'layla@example.com',
      resendAfterSec: 0,
      bonusCredits: 50,
    });

    stubEnv({ EMAIL_VERIFICATION: 'required' });
    issueEmailToken(harness.db, user.id, 'verify', now - 15 * SECOND);
    expect(getVerificationState(user.id, now)).toMatchObject({
      required: true,
      verified: false,
      resendAfterSec: 45,
    });
    expect(getVerificationState(user.id, now + 3600 * SECOND)?.resendAfterSec).toBe(0);
  });

  it('knows a confirmed account, and has nothing for one that is gone', () => {
    const user = unconfirmedUser({ emailVerifiedAt: Date.now() });
    expect(getVerificationState(user.id)?.verified).toBe(true);
    expect(getVerificationState('usr_00000000000000000000000000')).toBeNull();
    const deleted = unconfirmedUser({ email: 'gone@example.com', deletedAt: Date.now() });
    expect(getVerificationState(deleted.id)).toBeNull();
  });
});

describe('confirmEmailVerification', () => {
  it('confirms the address, pays the bonus (where password accounts earn one) and welcomes the person - once', async () => {
    const user = unconfirmedUser();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');

    const outcome = confirmEmailVerification(secret);
    expect(outcome).toEqual({ verified: true, alreadyVerified: false, bonusCredits: 50 });
    expect(userRow(user.id)).toMatchObject({ creditBalance: 50 });
    expect(userRow(user.id)?.emailVerifiedAt).toBeGreaterThan(0);

    const welcome = await mailTo('layla@example.com');
    expect(welcome?.kind).toBe('welcome');
    expect(welcome?.text).toContain('50 credits');
    expect(linkIn(welcome).url.pathname).toBe('/studio');

    expect(reasonOf(() => confirmEmailVerification(secret))).toBe('used');
    expect(userRow(user.id)?.creditBalance).toBe(50);
  });

  it.each([
    ['garbage', 'not-a-token'],
    ['an empty string', ''],
    ['a reset link', 'RESET'],
  ])('says "invalid" for %s', (_label, secret) => {
    const user = unconfirmedUser();
    const reset = issueEmailToken(harness.db, user.id, 'reset');
    expect(
      reasonOf(() => confirmEmailVerification(secret === 'RESET' ? reset.secret : secret)),
    ).toBe('invalid');
    expect(userRow(user.id)?.emailVerifiedAt).toBeNull();
  });

  it('says "expired" after a day, and does not confirm', () => {
    const user = unconfirmedUser();
    const now = Date.now();
    const { secret, expiresAt } = issueEmailToken(harness.db, user.id, 'verify', now);
    expect(reasonOf(() => confirmEmailVerification(secret, expiresAt))).toBe('expired');
    expect(userRow(user.id)).toMatchObject({ emailVerifiedAt: null, creditBalance: 0 });
  });

  it('confirms an account that was already confirmed without paying or mailing again', async () => {
    const user = unconfirmedUser({ emailVerifiedAt: Date.now(), creditBalance: 0 });
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const outcome = confirmEmailVerification(secret);
    expect(outcome.alreadyVerified).toBe(true);
    await mailTo('layla@example.com');
    expect(getOutbox()).toEqual([]);
  });

  it('does not confirm a disabled or deleted account, and does not burn the link', () => {
    const disabled = unconfirmedUser({ disabledAt: Date.now() });
    const first = issueEmailToken(harness.db, disabled.id, 'verify');
    expect(reasonOf(() => confirmEmailVerification(first.secret))).toBe('invalid');
    expect(userRow(disabled.id)?.emailVerifiedAt).toBeNull();
    harness.db.update(users).set({ disabledAt: null }).where(eq(users.id, disabled.id)).run();
    expect(reasonOf(() => confirmEmailVerification(first.secret))).toBe('ok');

    const deleted = unconfirmedUser({ email: 'gone@example.com', deletedAt: Date.now() });
    const second = issueEmailToken(harness.db, deleted.id, 'verify');
    expect(reasonOf(() => confirmEmailVerification(second.secret))).toBe('invalid');
  });

  it('is all or nothing: if granting the bonus fails, the link is still good and nothing changed', () => {
    const user = unconfirmedUser();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    failing.ledger = true;
    try {
      expect(() => confirmEmailVerification(secret)).toThrow('ledger down');
    } finally {
      failing.ledger = false;
    }
    expect(userRow(user.id)).toMatchObject({ emailVerifiedAt: null, creditBalance: 0 });
    expect(harness.db.select().from(creditLedger).all()).toEqual([]);
    expect(confirmEmailVerification(secret)).toMatchObject({ verified: true, bonusCredits: 50 });
  });

  it('needs no session: the link is the credential', () => {
    // Nothing in the service takes a caller; a link opened on a phone confirms the address.
    const user = unconfirmedUser();
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    expect(confirmEmailVerification(secret).verified).toBe(true);
  });
});

describe('markEmailVerified', () => {
  const PAYS = { bonus: 'password' } as const;

  it('is idempotent and never pays twice', () => {
    const user = unconfirmedUser();
    const first = withTx(harness.db, (tx) => markEmailVerified(tx, user.id, Date.now(), PAYS));
    const second = withTx(harness.db, (tx) => markEmailVerified(tx, user.id, Date.now(), PAYS));
    expect(first).toMatchObject({ changed: true, bonus: { created: true } });
    expect(second).toMatchObject({ changed: false, bonus: { created: false } });
    expect(first.user.emailVerifiedAt).toBe(second.user.emailVerifiedAt);
    expect(userRow(user.id)?.creditBalance).toBe(50);
  });

  it('refuses a deleted or unknown account', () => {
    const deleted = unconfirmedUser({ deletedAt: Date.now() });
    expect(() =>
      withTx(harness.db, (tx) => markEmailVerified(tx, deleted.id, Date.now(), PAYS)),
    ).toThrow(/not found/i);
    expect(() =>
      withTx(harness.db, (tx) =>
        markEmailVerified(tx, 'usr_00000000000000000000000000', Date.now(), PAYS),
      ),
    ).toThrow(/not found/i);
  });

  it('leaves the last mail alone: no email is sent by the primitive itself', async () => {
    const user = unconfirmedUser();
    withTx(harness.db, (tx) => markEmailVerified(tx, user.id, Date.now(), PAYS));
    await mailTo('layla@example.com');
    expect(lastOutboxMessage('layla@example.com')).toBeUndefined();
  });

  it('pays nothing when the caller says the confirmation may not (Google sign-in pays by itself)', () => {
    const user = unconfirmedUser();
    const outcome = withTx(harness.db, (tx) =>
      markEmailVerified(tx, user.id, Date.now(), { bonus: 'none' }),
    );
    // Confirmed, but no credit even though password accounts earn one in this file's setting.
    expect(outcome).toMatchObject({ changed: true, bonus: null });
    expect(userRow(user.id)).toMatchObject({ creditBalance: 0 });
    expect(harness.db.select().from(creditLedger).all()).toEqual([]);
  });
});
