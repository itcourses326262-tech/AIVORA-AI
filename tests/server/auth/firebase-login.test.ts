import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/lib/errors';
import { deleteAccount } from '@/server/auth/account-deletion';
import { createApiKey, resolveApiKey } from '@/server/auth/api-keys';
import { signInWithFirebase, type FirebaseSignInResult } from '@/server/auth/firebase-login';
import { verifyPassword } from '@/server/auth/password';
import { resolveSession } from '@/server/auth/sessions';
import { loginUser, registerUser } from '@/server/auth/users';
import { confirmEmailVerification } from '@/server/auth/verification';
import {
  apiKeys,
  authIdentities,
  creditLedger,
  sessions,
  signupBonusClaims,
  users,
} from '@/server/db/schema';
import { getOutbox, lastOutboxMessage } from '@/server/email';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { createSession, createUser } from '../../helpers/factories';
import { firebaseKeyFixture } from './firebase-support';
import { GOOD_PASSWORD, linkIn, mailTo, stubEnv, stubRelay, trustTestState } from './trust-support';
import { beforeEach } from 'vitest';

const harness = freshDb();
trustTestState();
const minter = firebaseKeyFixture();

const FIREBASE_ENV = {
  FIREBASE_API_KEY: 'k'.repeat(30),
  FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
  FIREBASE_PROJECT_ID: 'test-project',
};
beforeEach(() => stubEnv(FIREBASE_ENV));

interface Google {
  sub?: string;
  email?: string;
  name?: string | undefined;
}

/** A sign-in of the Google account `google`, from `meta`'s address. */
async function signIn(
  google: Google = {},
  meta: { ip?: string; userAgent?: string } = { ip: '203.0.113.7' },
  locale: 'ar' | 'en' = 'en',
): Promise<FirebaseSignInResult> {
  const token = await minter.mint({
    sub: google.sub ?? 'uid-layla',
    email: google.email ?? 'layla@example.com',
    ...('name' in google ? { name: google.name } : {}),
  });
  return signInWithFirebase({ idToken: token, locale }, meta);
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const userRow = (email: string) =>
  harness.db.select().from(users).where(eq(users.email, email)).get();
const allUsers = () => harness.db.select().from(users).all();
const identitiesOf = (userId: string) =>
  harness.db.select().from(authIdentities).where(eq(authIdentities.userId, userId)).all();
const sessionsOf = (userId: string) =>
  harness.db.select().from(sessions).where(eq(sessions.userId, userId)).all();
const bonusRows = (userId: string) =>
  harness.db
    .select()
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'signup_bonus')))
    .all();

describe('a first sign-in with Google', () => {
  it('creates a confirmed, password-less account with the sign-up bonus, exactly once', async () => {
    const result = await signIn({ name: 'Layla Hassan' }, { ip: '203.0.113.7', userAgent: 'UA/1' });

    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({
      email: 'layla@example.com',
      name: 'Layla Hassan',
      role: 'user',
      locale: 'en',
      creditBalance: 50,
      emailVerified: true,
      hasPassword: false,
    });
    const row = userRow('layla@example.com');
    expect(row).toMatchObject({
      hasPassword: false,
      emailCanonical: 'layla@example.com',
      signupIp: '203.0.113.7',
    });
    expect(row?.emailVerifiedAt).toEqual(expect.any(Number));
    expect(bonusRows(result.user.id)).toHaveLength(1);
    expectConsistentLedger(harness.db, result.user.id, 0);

    const [identity, ...others] = identitiesOf(result.user.id);
    expect(others).toEqual([]);
    expect(identity).toMatchObject({
      provider: 'google',
      subject: 'uid-layla',
      email: 'layla@example.com',
    });
    // A real session came out, bound to the user, with the client details.
    expect(resolveSession(result.token)?.user.id).toBe(result.user.id);
    expect(sessionsOf(result.user.id)).toMatchObject([{ userAgent: 'UA/1', ip: '203.0.113.7' }]);
  });

  it('stores a password hash that no password can match', async () => {
    const result = await signIn();
    const hash = userRow('layla@example.com')?.passwordHash ?? '';
    expect(hash).not.toBe('');
    for (const guess of ['', hash, 'unusable', GOOD_PASSWORD, 'x'.repeat(40)]) {
      expect(await verifyPassword(guess, hash)).toBe(false);
    }
    // Two such accounts do not share a recognisable value.
    const other = await signIn({ sub: 'uid-2', email: 'second@example.com' });
    expect(userRow('second@example.com')?.passwordHash).not.toBe(hash);
    expect(other.user.id).not.toBe(result.user.id);
  });

  it('lower-cases the address and normalizes the account like a registered one', async () => {
    await signIn({ email: 'Layla.Hassan@Example.COM' });
    expect(userRow('layla.hassan@example.com')).toBeDefined();
  });

  it('is the same account on a replay of the same token or a fresh token: one user, one bonus', async () => {
    const token = await minter.mint({ sub: 'uid-layla' });
    const first = await signInWithFirebase({ idToken: token }, { ip: '203.0.113.7' });
    const replay = await signInWithFirebase({ idToken: token }, { ip: '203.0.113.7' });
    const fresh = await signIn();

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(fresh.created).toBe(false);
    expect(new Set([first.user.id, replay.user.id, fresh.user.id]).size).toBe(1);
    expect(allUsers()).toHaveLength(1);
    expect(bonusRows(first.user.id)).toHaveLength(1);
    expect(identitiesOf(first.user.id)).toHaveLength(1);
    // Every sign-in is its own session.
    expect(sessionsOf(first.user.id)).toHaveLength(3);
    expect(new Set([first.token, replay.token, fresh.token]).size).toBe(3);
  });

  it('uses the language it was given, and Arabic when it was given none or garbage', async () => {
    const a = await signIn({ sub: 'u1', email: 'a@example.com' }, undefined, 'ar');
    expect(a.user.locale).toBe('ar');
    const token = await minter.mint({ sub: 'u2', email: 'b@example.com' });
    const b = await signInWithFirebase({ idToken: token });
    expect(b.user.locale).toBe('ar');
    const c = await signInWithFirebase({
      idToken: await minter.mint({ sub: 'u3', email: 'c@example.com' }),
      locale: 'fr' as never,
    });
    expect(c.user.locale).toBe('ar');
  });

  describe('the name', () => {
    it('is the Google display name', async () => {
      expect((await signIn({ name: 'ليلى حسن' })).user.name).toBe('ليلى حسن');
    });

    it('falls back to the part of the address before the @ when Google sent none', async () => {
      const result = await signIn({ email: 'layla.h@example.com', name: undefined });
      expect(result.user.name).toBe('layla.h');
    });

    it('cuts a very long name to 80 characters', async () => {
      const result = await signIn({ name: 'ش'.repeat(200) });
      expect([...result.user.name]).toHaveLength(80);
    });

    it('does not accept a name made of invisible characters', async () => {
      const result = await signIn({ email: 'visible@example.com', name: '​​ㅤ' });
      expect(result.user.name).toBe('visible');
    });

    it('collapses whitespace like a typed name', async () => {
      expect((await signIn({ name: '  Layla \n  Hassan ' })).user.name).toBe('Layla Hassan');
    });
  });
});

describe('the sign-up rules apply to Google sign-ups too', () => {
  it('refuses a throwaway-mail domain and creates nothing', async () => {
    const error = await failure(signIn({ email: 'burner@mailinator.com' }));
    expect(error.code).toBe('email_not_allowed');
    expect(allUsers()).toHaveLength(0);
    expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('refuses a new account when registration is closed, and still signs existing people in', async () => {
    await signIn();
    stubEnv({ SIGNUP_ENABLED: 'false' });
    const error = await failure(signIn({ sub: 'uid-new', email: 'new@example.com' }));
    expect(error.code).toBe('signup_disabled');
    expect(userRow('new@example.com')).toBeUndefined();
    await expect(signIn()).resolves.toMatchObject({ created: false });
  });

  it('counts towards the daily cap of the address, and the cap does not stop a returning user', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '2' });
    const ip = { ip: '198.51.100.20' };
    await signIn({ sub: 'u1', email: 'one@example.com' }, ip);
    await signIn({ sub: 'u2', email: 'two@example.com' }, ip);
    const error = await failure(signIn({ sub: 'u3', email: 'three@example.com' }, ip));
    expect(error.code).toBe('signup_limit');
    expect(userRow('three@example.com')).toBeUndefined();
    // Another address is unaffected; a returning user from the capped one is let in.
    await expect(
      signIn({ sub: 'u3', email: 'three@example.com' }, { ip: '198.51.100.21' }),
    ).resolves.toMatchObject({ created: true });
    await expect(signIn({ sub: 'u1', email: 'one@example.com' }, ip)).resolves.toMatchObject({
      created: false,
    });
  });

  it('shares the cap with password registration', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    await registerUser(
      { email: 'pw@example.com', password: GOOD_PASSWORD, name: 'Pw', locale: 'en' },
      { ip: '198.51.100.30' },
    );
    const error = await failure(signIn({}, { ip: '198.51.100.30' }));
    expect(error.code).toBe('signup_limit');
  });

  it('promotes an ADMIN_EMAILS address on creation: Google confirmed the mailbox', async () => {
    stubEnv({ ADMIN_EMAILS: 'boss@example.com' });
    const boss = await signIn({ sub: 'u-boss', email: 'boss@example.com' });
    expect(boss.user.role).toBe('admin');
    const other = await signIn({ sub: 'u-other', email: 'other@example.com' });
    expect(other.user.role).toBe('user');
  });

  it('pays no second bonus to a mailbox that already had one', async () => {
    const first = await signIn();
    await deleteAccount(first.user.id, { force: true });
    const again = await signIn();
    expect(again.created).toBe(true);
    expect(again.user.id).not.toBe(first.user.id);
    expect(again.user.creditBalance).toBe(0);
    expect(bonusRows(again.user.id)).toHaveLength(0);
    expect(harness.db.select().from(signupBonusClaims).all()).toHaveLength(1);
  });

  describe('the admission hook of the route (the shared sign-up budget)', () => {
    const signInWith = async (hook: () => void, google: Google = {}) =>
      signInWithFirebase(
        {
          idToken: await minter.mint({
            sub: google.sub ?? 'uid-layla',
            email: google.email ?? 'layla@example.com',
          }),
        },
        { ip: '203.0.113.7' },
        { admitNewAccount: hook },
      );

    it('is asked once before a new account is made, and a refusal makes nothing at all', async () => {
      const refusal = AppError.of('rate_limited', 'Too many requests', { retryAfterSec: 60 });
      const error = await failure(
        signInWith(() => {
          throw refusal;
        }),
      );
      expect(error).toBe(refusal);
      expect(allUsers()).toHaveLength(0);
      expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
      expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
      expect(harness.db.select().from(sessions).all()).toHaveLength(0);

      let calls = 0;
      await signInWith(() => void (calls += 1));
      expect(calls).toBe(1);
      expect(allUsers()).toHaveLength(1);
    });

    it('is not asked for a returning person, nor for an existing account found by its mailbox', async () => {
      await signIn();
      createUser(harness.db, {
        email: 'owner@example.com',
        emailCanonical: 'owner@example.com',
        emailVerifiedAt: Date.now(),
      });
      const never = () => {
        throw new Error('the hook must not run');
      };
      await expect(signInWith(never)).resolves.toMatchObject({ created: false });
      await expect(
        signInWith(never, { sub: 'uid-owner', email: 'owner@example.com' }),
      ).resolves.toMatchObject({ created: false });
    });

    it('is not asked for a sign-up that is refused for another reason first', async () => {
      stubEnv({ SIGNUP_ENABLED: 'false' });
      let calls = 0;
      await failure(signInWith(() => void (calls += 1)));
      stubEnv({ SIGNUP_ENABLED: 'true' });
      await failure(signInWith(() => void (calls += 1), { email: 'burner@mailinator.com' }));
      expect(calls).toBe(0);
    });
  });

  it('sends the welcome mail for a new account only where mail is configured', async () => {
    await signIn({ sub: 'u1', email: 'quiet@example.com' });
    expect(await mailTo('quiet@example.com')).toBeUndefined();

    stubEnv({
      SMTP_URL: 'smtp://mail.example.com',
      EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
    });
    stubRelay();
    await signIn({ sub: 'u2', email: 'loud@example.com' });
    const mail = await mailTo('loud@example.com');
    expect(mail?.to).toBe('loud@example.com');
    // Returning users get nothing.
    await signIn({ sub: 'u2', email: 'loud@example.com' });
    await mailTo('loud@example.com');
    expect(lastOutboxMessage('loud@example.com')).toBe(mail);
  });
});

describe('an account that owns the mailbox already', () => {
  const SMTP = {
    SMTP_URL: 'smtp://mail.example.com',
    EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
  };

  async function confirmedAccountWithPassword() {
    const hash = await (await import('@/server/auth/password')).hashPassword(GOOD_PASSWORD);
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      name: 'Layla',
      locale: 'en',
      passwordHash: hash,
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now() - 1000,
      creditBalance: 12,
    });
    return { user, hash };
  }

  describe('a confirmed account that still has a password', () => {
    it('is linked, keeps its data, and loses the password, every session and every API key', async () => {
      const { user, hash } = await confirmedAccountWithPassword();
      const oldSession = createSession(harness.db, user.id);
      const otherDevice = createSession(harness.db, user.id);
      const key = await createApiKey(user.id, 'planted');
      expect(resolveApiKey(key.key)).not.toBeNull();
      const confirmedAt = userRow('layla@example.com')?.emailVerifiedAt;

      const result = await signIn({ name: 'Somebody Else' });

      expect(result.created).toBe(false);
      expect(result.user.id).toBe(user.id);
      // The same account, with its own data: name, credits, confirmation date, no second bonus.
      expect(result.user).toMatchObject({ name: 'Layla', creditBalance: 12, hasPassword: false });
      expect(userRow('layla@example.com')?.emailVerifiedAt).toBe(confirmedAt);
      expect(bonusRows(user.id)).toHaveLength(0);
      expect(identitiesOf(user.id)).toHaveLength(1);
      // Whoever knew the password, held a session or an API key is out.
      const row = userRow('layla@example.com');
      expect(row?.hasPassword).toBe(false);
      expect(row?.passwordHash).not.toBe(hash);
      expect(await verifyPassword(GOOD_PASSWORD, row?.passwordHash ?? '')).toBe(false);
      expect(
        (await failure(loginUser({ email: 'layla@example.com', password: GOOD_PASSWORD }))).code,
      ).toBe('unauthorized');
      expect(resolveSession(oldSession.token)).toBeNull();
      expect(resolveSession(otherDevice.token)).toBeNull();
      expect(resolveApiKey(key.key)).toBeNull();
      // Only the session of this sign-in exists.
      expect(sessionsOf(user.id)).toHaveLength(1);
      expect(resolveSession(result.token)?.user.id).toBe(user.id);
    });

    it('is the case of a squatter whose account the owner confirmed through the emailed link', async () => {
      stubEnv(SMTP);
      stubRelay();
      const squatter = await registerUser(
        { email: 'victim@example.com', password: GOOD_PASSWORD, name: 'Squatter', locale: 'en' },
        { ip: '192.0.2.66' },
      );
      // The owner finds the mail, opens the link: the address is confirmed, the squatter's
      // password and sessions are not touched by that.
      confirmEmailVerification(linkIn(await mailTo('victim@example.com')).token);
      expect(userRow('victim@example.com')?.emailVerifiedAt).toEqual(expect.any(Number));
      const planted = await createApiKey(squatter.user.id, 'planted');
      expect(resolveSession(squatter.token)).not.toBeNull();
      expect(resolveApiKey(planted.key)).not.toBeNull();
      await expect(
        loginUser({ email: 'victim@example.com', password: GOOD_PASSWORD }),
      ).resolves.toBeDefined();

      const result = await signIn({ email: 'victim@example.com', name: 'Victim' });

      expect(result.user.id).toBe(squatter.user.id);
      expect(resolveSession(squatter.token)).toBeNull();
      expect(resolveApiKey(planted.key)).toBeNull();
      expect(
        (await failure(loginUser({ email: 'victim@example.com', password: GOOD_PASSWORD }))).code,
      ).toBe('unauthorized');
      expect(userRow('victim@example.com')?.hasPassword).toBe(false);
      // The confirmation already paid the bonus: Google does not pay it again.
      expect(bonusRows(squatter.user.id)).toHaveLength(1);
    });

    it('mails the address on file where mail is configured, naming the revoked API keys', async () => {
      stubEnv(SMTP);
      stubRelay();
      const { user } = await confirmedAccountWithPassword();
      await createApiKey(user.id, 'one');

      await signIn({ email: 'layla@example.com' });

      const mail = await mailTo('layla@example.com');
      expect(mail?.to).toBe('layla@example.com');
      expect(mail?.subject).toMatch(/password was changed/);
      expect(mail?.text).toMatch(/API keys were revoked/);
      expect(mail?.text).toMatch(/If this wasn't you, reset your password/);
    });

    it('mails the address on file, not the address Google reported', async () => {
      stubEnv(SMTP);
      stubRelay();
      createUser(harness.db, {
        email: 'first.last@gmail.com',
        emailCanonical: 'firstlast@gmail.com',
        emailVerifiedAt: Date.now(),
        locale: 'en',
      });
      await signIn({ email: 'firstlast+promo@gmail.com' });
      expect((await mailTo('first.last@gmail.com'))?.subject).toMatch(/password was changed/);
      expect(await mailTo('firstlast+promo@gmail.com')).toBeUndefined();
    });

    it('does not mention API keys when there were none', async () => {
      stubEnv(SMTP);
      stubRelay();
      await confirmedAccountWithPassword();
      await signIn({ email: 'layla@example.com' });
      const mail = await mailTo('layla@example.com');
      expect(mail?.subject).toMatch(/password was changed/);
      expect(mail?.text).not.toMatch(/API keys/);
    });

    it('sends no mail where mail is not configured, like the welcome mail', async () => {
      await confirmedAccountWithPassword();
      await signIn({ email: 'layla@example.com' });
      expect(await mailTo('layla@example.com')).toBeUndefined();
    });

    it('does not mail again on the next sign-in', async () => {
      stubEnv(SMTP);
      stubRelay();
      await confirmedAccountWithPassword();
      await signIn({ email: 'layla@example.com' });
      const first = await mailTo('layla@example.com');
      expect(first).toBeDefined();
      await signIn({ email: 'layla@example.com' });
      expect(await mailTo('layla@example.com')).toBe(first);
    });
  });

  it('a confirmed account without a password (Google only) is linked and nothing about it changes', async () => {
    stubEnv(SMTP);
    stubRelay();
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now() - 1000,
      hasPassword: false,
      passwordHash: 'unusable$kept',
      creditBalance: 12,
    });
    const oldSession = createSession(harness.db, user.id);
    const key = await createApiKey(user.id, 'mine');

    const result = await signIn();

    expect(result.user.id).toBe(user.id);
    expect(userRow('layla@example.com')?.passwordHash).toBe('unusable$kept');
    expect(resolveSession(oldSession.token)?.user.id).toBe(user.id);
    expect(resolveApiKey(key.key)).not.toBeNull();
    expect(identitiesOf(user.id)).toHaveLength(1);
    expect(await mailTo('layla@example.com')).toBeUndefined();
  });

  it('a confirmed account in ADMIN_EMAILS is not promoted by linking', async () => {
    stubEnv({ ADMIN_EMAILS: 'layla@example.com' });
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now(),
    });
    await signIn();
    expect(userRow('layla@example.com')?.role).toBe('user');
    expect(user.role).toBe('user');
  });

  it('matches Gmail aliases on the canonical mailbox, in both directions', async () => {
    const dotted = createUser(harness.db, {
      email: 'first.last@gmail.com',
      emailCanonical: 'firstlast@gmail.com',
      emailVerifiedAt: Date.now(),
    });
    const viaAlias = await signIn({ sub: 'g1', email: 'firstlast+promo@gmail.com' });
    expect(viaAlias.user.id).toBe(dotted.id);
    const plain = createUser(harness.db, {
      email: 'second.person@gmail.com',
      emailCanonical: 'secondperson@gmail.com',
      emailVerifiedAt: Date.now(),
    });
    const viaGoogleMail = await signIn({ sub: 'g2', email: 'second.person@googlemail.com' });
    expect(viaGoogleMail.user.id).toBe(plain.id);
    expect(allUsers()).toHaveLength(2);
    expect(identitiesOf(dotted.id)).toHaveLength(1);
    expect(identitiesOf(plain.id)).toHaveLength(1);
    // The address on the account stays what its owner typed.
    expect(userRow('first.last@gmail.com')).toBeDefined();
  });

  it('matches rows from before the canonical column existed', async () => {
    const legacy = createUser(harness.db, {
      email: 'legacy@example.com',
      emailCanonical: null,
      emailVerifiedAt: Date.now(),
    });
    const result = await signIn({ email: 'legacy@example.com' });
    expect(result.user.id).toBe(legacy.id);
    expect(allUsers()).toHaveLength(1);
  });

  describe('an unconfirmed registration is claimed', () => {
    async function squatter() {
      const registered = await registerUser(
        { email: 'victim@example.com', password: GOOD_PASSWORD, name: 'Squatter', locale: 'ar' },
        { ip: '192.0.2.66' },
      );
      // Keys are refused while confirmation is required and missing; the claim must still cope.
      const key = await createApiKey(registered.user.id, 'planted').catch(() => undefined);
      return { registered, key };
    }

    it('neutralizes the password, ends every session and API key, and confirms the address', async () => {
      const { registered, key } = await squatter();
      const second = createSession(harness.db, registered.user.id);
      expect(userRow('victim@example.com')?.emailVerifiedAt).toBeNull();
      expect(resolveSession(registered.token)).not.toBeNull();
      expect(key).toBeDefined();
      expect(resolveApiKey(key?.key ?? '')).not.toBeNull();

      const result = await signIn({ email: 'victim@example.com', name: 'Victim' });

      expect(result.created).toBe(false);
      expect(result.user.id).toBe(registered.user.id);
      const row = userRow('victim@example.com');
      expect(row?.hasPassword).toBe(false);
      expect(row?.emailVerifiedAt).toEqual(expect.any(Number));
      // The squatter's password no longer works, and answers like any wrong password.
      expect(await verifyPassword(GOOD_PASSWORD, row?.passwordHash ?? '')).toBe(false);
      const login = await failure(
        loginUser({ email: 'victim@example.com', password: GOOD_PASSWORD }),
      );
      expect(login.code).toBe('unauthorized');
      // Every session and key the squatter held is gone; only the new session exists.
      expect(resolveSession(registered.token)).toBeNull();
      expect(resolveSession(second.token)).toBeNull();
      expect(resolveApiKey(key?.key ?? '')).toBeNull();
      expect(
        harness.db.select().from(apiKeys).where(eq(apiKeys.userId, registered.user.id)).all(),
      ).toMatchObject([{ revokedAt: expect.any(Number) }]);
      expect(sessionsOf(registered.user.id).map((session) => session.id)).toHaveLength(1);
      expect(resolveSession(result.token)?.user.id).toBe(registered.user.id);
      // The account is the same one: the bonus it got at registration is not paid again.
      expect(bonusRows(registered.user.id)).toHaveLength(1);
      expect(identitiesOf(registered.user.id)).toHaveLength(1);
    });

    it('sends no notice where mail is not configured', async () => {
      await squatter();
      await signIn({ email: 'victim@example.com' });
      expect(await mailTo('victim@example.com')).toBeUndefined();
    });

    it('mails the address on file that the password and the API keys ended, where mail is configured', async () => {
      // No confirmation is asked for, so a squatter can plant a key before the owner shows up.
      stubEnv({ ...SMTP, EMAIL_VERIFICATION: 'off' });
      stubRelay();
      const { key } = await squatter();
      expect(key).toBeDefined();
      expect(resolveApiKey(key?.key ?? '')).not.toBeNull();

      await signIn({ email: 'victim@example.com' });

      await mailTo('victim@example.com');
      const notice = getOutbox().find(
        (message) =>
          message.to === 'victim@example.com' && /تم تغيير كلمة المرور/.test(message.subject),
      );
      expect(
        notice,
        'a password-changed notice in the (Arabic) language of the account',
      ).toBeDefined();
      expect(notice?.text).toMatch(/مفاتيح/);
      expect(resolveApiKey(key?.key ?? '')).toBeNull();
    });

    it('pays the bonus now when confirming was required and the squatter never could', async () => {
      stubEnv({
        SMTP_URL: 'smtp://mail.example.com',
        EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
      });
      stubRelay();
      const { registered } = await squatter();
      expect(registered.user.creditBalance).toBe(0);

      const result = await signIn({ email: 'victim@example.com' });

      expect(result.user.creditBalance).toBe(50);
      expect(bonusRows(registered.user.id)).toHaveLength(1);
      expectConsistentLedger(harness.db, registered.user.id, 0);
      expect((await mailTo('victim@example.com'))?.to).toBe('victim@example.com');
      // A second sign-in pays nothing more.
      await signIn({ email: 'victim@example.com' });
      expect(bonusRows(registered.user.id)).toHaveLength(1);
    });

    it('promotes an ADMIN_EMAILS address, since its holder is now the mailbox owner', async () => {
      stubEnv({ ADMIN_EMAILS: 'victim@example.com' });
      await squatter();
      const result = await signIn({ email: 'victim@example.com' });
      expect(result.user.role).toBe('admin');
    });

    it('lets the owner set a real password afterwards through the reset flow', async () => {
      const { registered } = await squatter();
      await signIn({ email: 'victim@example.com' });
      const { requestPasswordReset, resetPassword } = await import('@/server/auth/password-reset');
      expect(requestPasswordReset('victim@example.com')).toBe(true);
      const mail = await mailTo('victim@example.com');
      const secret = /token=([\w-]+)/.exec(mail?.text ?? '')?.[1];
      expect(secret).toBeDefined();
      await resetPassword(secret ?? '', 'a-brand-new-passphrase-2026');
      const row = userRow('victim@example.com');
      expect(row?.hasPassword).toBe(true);
      await expect(
        loginUser({ email: 'victim@example.com', password: 'a-brand-new-passphrase-2026' }),
      ).resolves.toMatchObject({ user: { id: registered.user.id } });
    });
  });
});

describe('an identity that is known already', () => {
  it('signs in the linked account even when the Google address changed since', async () => {
    const first = await signIn({ sub: 'stable-uid', email: 'old@example.com' });
    const later = await signIn({ sub: 'stable-uid', email: 'new@example.com' });

    expect(later.user.id).toBe(first.user.id);
    expect(later.created).toBe(false);
    expect(allUsers()).toHaveLength(1);
    // The account keeps its own address; the identity remembers what Google said last.
    expect(userRow('old@example.com')).toBeDefined();
    expect(userRow('new@example.com')).toBeUndefined();
    expect(identitiesOf(first.user.id)).toMatchObject([{ email: 'new@example.com' }]);
  });

  it('prefers the identity over a different account that owns the new address', async () => {
    const mine = await signIn({ sub: 'stable-uid', email: 'mine@example.com' });
    const theirs = createUser(harness.db, {
      email: 'theirs@example.com',
      emailCanonical: 'theirs@example.com',
      emailVerifiedAt: Date.now(),
    });
    const result = await signIn({ sub: 'stable-uid', email: 'theirs@example.com' });
    expect(result.user.id).toBe(mine.user.id);
    expect(result.user.id).not.toBe(theirs.id);
    expect(identitiesOf(theirs.id)).toHaveLength(0);
  });

  it('refuses a disabled account with 403 and opens no session', async () => {
    const first = await signIn();
    harness.db
      .update(users)
      .set({ disabledAt: Date.now() })
      .where(eq(users.id, first.user.id))
      .run();
    const before = sessionsOf(first.user.id).length;
    const error = await failure(signIn());
    expect(error.code).toBe('forbidden');
    expect(error.status).toBe(403);
    expect(sessionsOf(first.user.id)).toHaveLength(before);
  });

  it('refuses a disabled account found by its mailbox, and links nothing', async () => {
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: Date.now(),
      disabledAt: Date.now(),
    });
    const error = await failure(signIn());
    expect(error.code).toBe('forbidden');
    expect(identitiesOf(user.id)).toHaveLength(0);
    expect(sessionsOf(user.id)).toHaveLength(0);
  });

  it('refuses an unconfirmed disabled account without touching its password', async () => {
    const hash = 'kept-as-is';
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      passwordHash: hash,
      disabledAt: Date.now(),
    });
    await failure(signIn());
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row).toMatchObject({ passwordHash: hash, hasPassword: true, emailVerifiedAt: null });
  });

  it('does not wake a deleted account: the Google identity goes with it and a sign-in starts anew', async () => {
    const first = await signIn();
    await deleteAccount(first.user.id, { force: true });
    expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
    const tombstone = harness.db.select().from(users).where(eq(users.id, first.user.id)).get();
    expect(tombstone?.email).toMatch(/@deleted\.invalid$/);

    const again = await signIn();
    expect(again.created).toBe(true);
    expect(again.user.id).not.toBe(first.user.id);
    expect(allUsers()).toHaveLength(2);
  });

  it('refuses an identity row that points at a deleted user', async () => {
    const first = await signIn();
    harness.db
      .update(users)
      .set({ deletedAt: Date.now() })
      .where(eq(users.id, first.user.id))
      .run();
    const error = await failure(signIn());
    expect(error.code).toBe('unauthorized');
  });
});

describe('a mailbox whose account is linked to another Google account', () => {
  it('refuses a second Google subject with the generic 401 and links nothing', async () => {
    const original = await signIn({ sub: 'uid-original-owner', email: 'bob@lapsed.example' });
    const sessionsBefore = sessionsOf(original.user.id).length;

    // The domain lapsed and was registered again: the same address, a different Google account.
    const error = await failure(
      signIn({ sub: 'uid-new-domain-owner', email: 'bob@lapsed.example' }),
    );

    expect(error.code).toBe('unauthorized');
    expect(error.status).toBe(401);
    expect(identitiesOf(original.user.id)).toMatchObject([{ subject: 'uid-original-owner' }]);
    expect(sessionsOf(original.user.id)).toHaveLength(sessionsBefore);
    expect(allUsers()).toHaveLength(1);
    // The binding to the first Google account is what keeps working.
    await expect(
      signIn({ sub: 'uid-original-owner', email: 'bob@lapsed.example' }),
    ).resolves.toMatchObject({ created: false, user: { id: original.user.id } });
  });

  it('refuses it for a Gmail alias of the linked mailbox too', async () => {
    const original = await signIn({ sub: 'uid-a', email: 'first.last@gmail.com' });
    const error = await failure(signIn({ sub: 'uid-b', email: 'firstlast+x@gmail.com' }));
    expect(error.code).toBe('unauthorized');
    expect(identitiesOf(original.user.id)).toHaveLength(1);
    expect(allUsers()).toHaveLength(1);
  });

  it('is decided before anything else about the account changes', async () => {
    const hash = 'kept-as-is';
    const original = await signIn({ sub: 'uid-a', email: 'bob@lapsed.example' });
    harness.db
      .update(users)
      .set({ passwordHash: hash, hasPassword: true })
      .where(eq(users.id, original.user.id))
      .run();
    await failure(signIn({ sub: 'uid-b', email: 'bob@lapsed.example' }));
    expect(
      harness.db.select().from(users).where(eq(users.id, original.user.id)).get(),
    ).toMatchObject({ passwordHash: hash, hasPassword: true });
  });
});

describe('simultaneous first sign-ins', () => {
  it('of one Google account give one user, one bonus and one session each', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => signIn({ name: 'Layla' }, { ip: '203.0.113.9' })),
    );
    expect(allUsers()).toHaveLength(1);
    expect(new Set(results.map((result) => result.user.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const userId = results[0]?.user.id ?? '';
    expect(bonusRows(userId)).toHaveLength(1);
    expect(identitiesOf(userId)).toHaveLength(1);
    expect(sessionsOf(userId)).toHaveLength(6);
    expectConsistentLedger(harness.db, userId, 0);
  });

  it('of two Google accounts with the same mailbox give one user and one identity: the second is refused', async () => {
    const outcomes = await Promise.allSettled([
      signIn({ sub: 'project-a-uid', email: 'layla@example.com' }),
      signIn({ sub: 'project-b-uid', email: 'layla@example.com' }),
    ]);
    expect(allUsers()).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refused?.status === 'rejected' && (refused.reason as AppError).code).toBe(
      'unauthorized',
    );
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(1);
    expect(identitiesOf(allUsers()[0]?.id ?? '')).toHaveLength(1);
  });

  it('of one Google account and a password registration of that address give one user', async () => {
    const outcomes = await Promise.allSettled([
      signIn({}, { ip: '203.0.113.10' }),
      registerUser(
        { email: 'layla@example.com', password: GOOD_PASSWORD, name: 'Layla', locale: 'en' },
        { ip: '203.0.113.11' },
      ),
    ]);
    expect(allUsers()).toHaveLength(1);
    expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true);
    expect(bonusRows(allUsers()[0]?.id ?? '')).toHaveLength(1);
  });
});

describe('a token that cannot be trusted', () => {
  it('creates nothing: no user, identity, bonus or session', async () => {
    const bad = await minter.mint({ email_verified: false });
    const error = await failure(signInWithFirebase({ idToken: bad }, { ip: '203.0.113.7' }));
    expect(error.code).toBe('unauthorized');
    expect(allUsers()).toHaveLength(0);
    expect(harness.db.select().from(authIdentities).all()).toHaveLength(0);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('does not let a password-provider token claim an existing account by its address', async () => {
    const user = createUser(harness.db, {
      email: 'layla@example.com',
      emailCanonical: 'layla@example.com',
      emailVerifiedAt: null,
      passwordHash: 'untouched',
    });
    const token = await minter.mint({ firebase: { sign_in_provider: 'password' } });
    await failure(signInWithFirebase({ idToken: token }));
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row).toMatchObject({ passwordHash: 'untouched', hasPassword: true });
    expect(identitiesOf(user.id)).toHaveLength(0);
  });

  it('answers 404 when Google sign-in is switched off, even for a good token', async () => {
    const token = await minter.mint();
    stubEnv({ FIREBASE_AUTH: 'off' });
    expect((await failure(signInWithFirebase({ idToken: token }))).code).toBe('not_found');
    stubEnv({
      FIREBASE_AUTH: 'auto',
      FIREBASE_API_KEY: '',
      FIREBASE_AUTH_DOMAIN: '',
      FIREBASE_PROJECT_ID: '',
    });
    expect((await failure(signInWithFirebase({ idToken: token }))).code).toBe('not_found');
    expect(allUsers()).toHaveLength(0);
  });

  it('rejects an address that is not a plain ASCII mailbox with a validation error', async () => {
    const error = await failure(signIn({ email: 'ليلى@example.com' }));
    expect(error.code).toBe('validation_failed');
    expect(allUsers()).toHaveLength(0);
  });
});
