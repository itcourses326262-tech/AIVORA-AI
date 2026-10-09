import type * as CryptoModule from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { freshDb } from '../../helpers/db';
import { createSession } from '../../helpers/factories';

const spy = vi.hoisted(() => ({ calls: 0 }));

// The real scrypt, with a call counter: a password-less account must cost a login the same work as
// a wrong password does.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  const scrypt = ((...args: Parameters<typeof actual.scrypt>) => {
    spy.calls += 1;
    return actual.scrypt(...args);
  }) as typeof actual.scrypt;
  return { ...actual, scrypt };
});

import { deleteAccountWithPassword } from '@/server/auth/account-deletion';
import { exportAccountChunks } from '@/server/auth/account-export';
import { signInWithFirebase } from '@/server/auth/firebase-login';
import { verifyAgainstDummy, hashPassword } from '@/server/auth/password';
import { requestPasswordReset, resetPassword } from '@/server/auth/password-reset';
import { changePassword, loginUser } from '@/server/auth/users';
import { toUserDTO } from '@/server/auth/dto';
import { users } from '@/server/db/schema';
import { firebaseKeyFixture } from './firebase-support';
import { GOOD_PASSWORD, mailTo, stubEnv, stubRelay, trustTestState } from './trust-support';

const harness = freshDb();
trustTestState();
const minter = firebaseKeyFixture();

beforeEach(() => {
  stubEnv({
    FIREBASE_API_KEY: 'k'.repeat(30),
    FIREBASE_AUTH_DOMAIN: 'test-project.firebaseapp.com',
    FIREBASE_PROJECT_ID: 'test-project',
  });
});

async function googleUser() {
  const result = await signInWithFirebase({ idToken: await minter.mint(), locale: 'en' });
  return result.user;
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('password login of an account that has no password', () => {
  it('fails exactly like a wrong password, with the same work: one scrypt derivation', async () => {
    const user = await googleUser();
    await hashPassword('creates-the-per-process-dummy-hash');
    await verifyAgainstDummy('warm-up');

    const counts: number[] = [];
    const errors: AppError[] = [];
    for (const email of [user.email, 'ghost@example.com']) {
      spy.calls = 0;
      errors.push(await failure(loginUser({ email, password: GOOD_PASSWORD })));
      counts.push(spy.calls);
    }
    // The empty string and the stored value itself must not get in either.
    for (const password of ['x', 'unusable', 'scrypt$x']) {
      spy.calls = 0;
      errors.push(await failure(loginUser({ email: user.email, password })));
      counts.push(spy.calls);
    }

    expect(counts).toEqual([1, 1, 1, 1, 1]);
    for (const error of errors) {
      expect(error.code).toBe('unauthorized');
      expect(error.status).toBe(401);
      expect(error.message).toBe('Invalid email or password');
      expect(error.details).toBeUndefined();
    }
  });

  it('is the same error as an unknown email, so the response does not show that the account exists', async () => {
    const user = await googleUser();
    const known = await failure(loginUser({ email: user.email, password: GOOD_PASSWORD }));
    const unknown = await failure(
      loginUser({ email: 'nobody@example.com', password: GOOD_PASSWORD }),
    );
    expect({ code: known.code, status: known.status, message: known.message }).toEqual({
      code: unknown.code,
      status: unknown.status,
      message: unknown.message,
    });
  });

  it('opens no session', async () => {
    const user = await googleUser();
    const before = harness.db.$client.prepare('select count(*) as n from sessions').get() as {
      n: number;
    };
    await failure(loginUser({ email: user.email, password: GOOD_PASSWORD }));
    const after = harness.db.$client.prepare('select count(*) as n from sessions').get() as {
      n: number;
    };
    expect(after.n).toBe(before.n);
  });
});

describe('changing or confirming with a password that does not exist', () => {
  it('changePassword answers password_not_set (409) and changes nothing', async () => {
    const user = await googleUser();
    const before = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    const error = await failure(
      changePassword(user.id, GOOD_PASSWORD, 'a-much-longer-passphrase-2026'),
    );
    expect(error.code).toBe('password_not_set');
    expect(error.status).toBe(409);
    expect(harness.db.select().from(users).where(eq(users.id, user.id)).get()).toEqual(before);
  });

  it('account deletion answers password_not_set and deletes nothing', async () => {
    const user = await googleUser();
    const error = await failure(deleteAccountWithPassword(user.id, GOOD_PASSWORD));
    expect(error.code).toBe('password_not_set');
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row).toMatchObject({ deletedAt: null, disabledAt: null });
    expect(row?.email).toBe(user.email);
  });

  it('account deletion still works for an account that has a password', async () => {
    const user = await googleUser();
    // The way to a password: the reset email.
    stubEnv({
      SMTP_URL: 'smtp://mail.example.com',
      EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
    });
    stubRelay();
    expect(requestPasswordReset(user.email)).toBe(true);
    const secret = /token=([\w-]+)/.exec((await mailTo(user.email))?.text ?? '')?.[1] ?? '';
    await resetPassword(secret, 'a-much-longer-passphrase-2026');
    const result = await deleteAccountWithPassword(user.id, 'a-much-longer-passphrase-2026', {
      purge: 'wait',
    });
    expect(result.alreadyDeleted).toBe(false);
  });
});

describe('getting a first password through the reset flow', () => {
  it('sets a real hash, flips hasPassword and lets the password sign in', async () => {
    const user = await googleUser();
    expect(user.hasPassword).toBe(false);
    stubEnv({
      SMTP_URL: 'smtp://mail.example.com',
      EMAIL_FROM: 'AIVORE <no-reply@aivore.example>',
    });
    stubRelay();
    expect(requestPasswordReset(user.email)).toBe(true);
    const secret = /token=([\w-]+)/.exec((await mailTo(user.email))?.text ?? '')?.[1] ?? '';

    await resetPassword(secret, 'a-much-longer-passphrase-2026');

    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row?.hasPassword).toBe(true);
    expect(row?.passwordHash.startsWith('scrypt$')).toBe(true);
    await expect(
      loginUser({ email: user.email, password: 'a-much-longer-passphrase-2026' }),
    ).resolves.toMatchObject({ user: { id: user.id } });
    // And changing it works like for any account.
    await expect(
      changePassword(user.id, 'a-much-longer-passphrase-2026', 'another-long-passphrase-2026'),
    ).resolves.toBeUndefined();
  });
});

describe('how the account describes itself', () => {
  it('reports hasPassword in the user DTO, false for Google accounts and true for the others', async () => {
    const user = await googleUser();
    const row = harness.db.select().from(users).where(eq(users.id, user.id)).get();
    expect(row && toUserDTO(row).hasPassword).toBe(false);
    const registered = harness.db
      .update(users)
      .set({ hasPassword: true })
      .where(eq(users.id, user.id))
      .returning()
      .get();
    expect(toUserDTO(registered).hasPassword).toBe(true);
  });

  it('exports the linked providers and the address Google reported, never the provider id', async () => {
    const user = await googleUser();
    createSession(harness.db, user.id);
    let text = '';
    for await (const chunk of exportAccountChunks(user.id)) text += chunk;
    const data = JSON.parse(text) as {
      profile: { hasPassword: boolean };
      linkedAccounts: Array<Record<string, unknown>>;
    };
    expect(data.profile.hasPassword).toBe(false);
    expect(data.linkedAccounts).toEqual([
      {
        provider: 'google',
        email: 'layla@example.com',
        linkedAt: expect.any(Number),
        lastLoginAt: expect.any(Number),
      },
    ]);
    expect(text).not.toContain('firebase-uid-1');
    expect(text).not.toMatch(/passwordHash|unusable/);
  });
});
