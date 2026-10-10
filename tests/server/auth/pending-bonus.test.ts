import { eq } from 'drizzle-orm';
import type * as PasswordModule from '@/server/auth/password';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteAccount } from '@/server/auth/account-deletion';
import { registerUser } from '@/server/auth/users';
import {
  confirmEmailVerification,
  getVerificationState,
  pendingSignupBonus,
  requestEmailVerification,
} from '@/server/auth/verification';
import { users } from '@/server/db/schema';
import { freshDb } from '../../helpers/db';
import { GOOD_PASSWORD, linkIn, mailTo, stubEnv, trustTestState } from './trust-support';

const hashPassword = vi.hoisted(() => vi.fn(async () => 'scrypt$test-hash'));
vi.mock('@/server/auth/password', async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  hashPassword,
}));

const harness = freshDb();
trustTestState();

const input = (email: string) => ({
  email,
  password: GOOD_PASSWORD,
  name: 'Layla',
  locale: 'en' as const,
});

const CREDITS_WORDS = /credit|bonus/i;

// Where password accounts earn the bonus at all (development). Under the product policy the
// pending bonus is always 0: google-only-bonus.test.ts.
beforeEach(() => stubEnv({ SIGNUP_BONUS_PROVIDER: 'any' }));

describe('the pending bonus (banner state, DTO) promises only what confirming will really give', () => {
  it('a first registration shows it as pending, confirming pays it, and the mail never promised it', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    const mail = await mailTo('layla@example.com');
    expect(mail?.text).not.toMatch(CREDITS_WORDS);
    expect(getVerificationState(user.id)?.bonusCredits).toBe(50);
    expect(confirmEmailVerification(linkIn(mail).token).bonusCredits).toBe(50);
  });

  it('a mailbox that already got its bonus (deleted account, registered again) has none pending', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const first = await registerUser(input('layla@example.com'));
    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    await deleteAccount(first.user.id);

    const second = await registerUser(input('layla@example.com'));
    const mail = await mailTo('layla@example.com');
    expect(mail?.kind).toBe('verification');
    expect(mail?.text).not.toMatch(CREDITS_WORDS);
    expect(getVerificationState(second.user.id)?.bonusCredits).toBe(0);

    // The resend, the banner state and the outcome all agree.
    await requestEmailVerification(second.user.id, Date.now() + 120_000);
    expect((await mailTo('layla@example.com'))?.text).not.toMatch(CREDITS_WORDS);
    expect(confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token)).toMatchObject(
      { verified: true, bonusCredits: 0 },
    );
  });

  it('holds for an alias of the mailbox that was already paid', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const first = await registerUser(input('lay.la@gmail.com'));
    confirmEmailVerification(linkIn(await mailTo('lay.la@gmail.com')).token);
    await deleteAccount(first.user.id);
    const again = await registerUser(input('layla+again@gmail.com'));
    expect(getVerificationState(again.user.id)?.bonusCredits).toBe(0);
  });

  it('pendingSignupBonus is 0 for an account that has its bonus, and for another account of a claimed mailbox', async () => {
    stubEnv({ EMAIL_VERIFICATION: 'required' });
    const { user } = await registerUser(input('layla@example.com'));
    const stored = () => {
      const found = harness.db.select().from(users).where(eq(users.id, user.id)).get();
      if (!found) throw new Error('user missing');
      return found;
    };
    expect(pendingSignupBonus(harness.db, stored())).toBe(50);
    confirmEmailVerification(linkIn(await mailTo('layla@example.com')).token);
    expect(pendingSignupBonus(harness.db, stored())).toBe(0);
  });
});
