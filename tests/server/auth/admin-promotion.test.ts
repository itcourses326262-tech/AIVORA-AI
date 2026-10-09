import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { requestPasswordReset, resetPassword } from '@/server/auth/password-reset';
import { resolveSession } from '@/server/auth/sessions';
import { confirmEmailVerification, markEmailVerified } from '@/server/auth/verification';
import { registerUser } from '@/server/auth/users';
import { users } from '@/server/db/schema';
import { withTx } from '@/server/db';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import {
  GOOD_PASSWORD,
  linkIn,
  mailTo,
  passwordFixture,
  stubEnv,
  trustTestState,
} from './trust-support';

const harness = freshDb();
passwordFixture();
trustTestState();

const NEW_PASSWORD = 'a completely different passphrase 42';

function userRow(email: string) {
  return harness.db.select().from(users).where(eq(users.email, email)).get();
}

/** The scenario of the review: confirmation is mandatory and the boss's address is an admin address. */
async function squatBossAddress() {
  stubEnv({ ADMIN_EMAILS: 'boss@example.com', EMAIL_VERIFICATION: 'required' });
  const squatter = await registerUser({
    email: 'boss@example.com',
    password: GOOD_PASSWORD,
    name: 'Squatter',
    locale: 'en',
  });
  const { token } = linkIn(await mailTo('boss@example.com'));
  return { squatter, link: token };
}

describe('ADMIN_EMAILS promotion needs proof that the owner of the mailbox holds the account', () => {
  it('a bare click on the link (no session of that account) confirms but does not promote', async () => {
    const { squatter, link } = await squatBossAddress();

    const outcome = confirmEmailVerification(link);
    expect(outcome).toMatchObject({ verified: true, alreadyVerified: false });

    // The squatter's own session and password now belong to a confirmed account, but not an admin one.
    expect(userRow('boss@example.com')).toMatchObject({ role: 'user' });
    expect(userRow('boss@example.com')?.emailVerifiedAt).not.toBeNull();
    expect(resolveSession(squatter.token, harness.db)?.user.role).toBe('user');
  });

  it('a session of a DIFFERENT account does not promote either', async () => {
    const { link } = await squatBossAddress();
    const stranger = createUser(harness.db, { email: 'stranger@example.com' });
    confirmEmailVerification(link, Date.now(), { signedInUserId: stranger.id });
    expect(userRow('boss@example.com')?.role).toBe('user');
    expect(userRow('stranger@example.com')?.role).toBe('user');
  });

  it('confirming while signed in as that very account promotes it (the usual sign-up flow)', async () => {
    const { squatter, link } = await squatBossAddress();
    confirmEmailVerification(link, Date.now(), { signedInUserId: squatter.user.id });
    expect(userRow('boss@example.com')?.role).toBe('admin');
  });

  it('a password reset promotes: the mailbox owner chose the password and every old session died', async () => {
    const { squatter } = await squatBossAddress();
    expect(requestPasswordReset('boss@example.com')).toBe(true);
    const reset = linkIn(await mailTo('boss@example.com'));
    await resetPassword(reset.token, NEW_PASSWORD);

    expect(userRow('boss@example.com')?.role).toBe('admin');
    // The squatter's session is gone, so nothing they hold reaches the admin account.
    expect(resolveSession(squatter.token, harness.db)).toBeNull();
  });

  it('the sign-up bonus is still granted on a bare click (credits are not a privilege)', async () => {
    const { link } = await squatBossAddress();
    expect(confirmEmailVerification(link)).toMatchObject({ bonusCredits: 50 });
    expect(userRow('boss@example.com')?.creditBalance).toBe(50);
  });

  it('markEmailVerified promotes only when the caller says the holder is proven', async () => {
    stubEnv({ ADMIN_EMAILS: 'boss@example.com' });
    const plain = createUser(harness.db, { email: 'boss@example.com', emailVerifiedAt: null });
    withTx(harness.db, (tx) => markEmailVerified(tx, plain.id));
    expect(userRow('boss@example.com')?.role).toBe('user');
    // Promotion does not depend on the address having been unconfirmed a moment ago.
    withTx(harness.db, (tx) => markEmailVerified(tx, plain.id, Date.now(), { promoteAdmin: true }));
    expect(userRow('boss@example.com')?.role).toBe('admin');
    // Not listed: never promoted, whatever the caller asks.
    const other = createUser(harness.db, { email: 'other@example.com', emailVerifiedAt: null });
    withTx(harness.db, (tx) => markEmailVerified(tx, other.id, Date.now(), { promoteAdmin: true }));
    expect(userRow('other@example.com')?.role).toBe('user');
  });
});
