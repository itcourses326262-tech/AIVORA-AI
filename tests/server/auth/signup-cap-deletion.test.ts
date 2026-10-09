import { eq } from 'drizzle-orm';
import type * as PasswordModule from '@/server/auth/password';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { deleteAccount } from '@/server/auth/account-deletion';
import {
  assertSignupsWithinCap,
  digestSignupAddress,
  expireDeletedSignupAddresses,
  signupAddressAfterDeletion,
} from '@/server/auth/signup-guard';
import { registerUser } from '@/server/auth/users';
import { users } from '@/server/db/schema';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { GOOD_PASSWORD, stubEnv, trustTestState } from './trust-support';

// Registration hashes the password with scrypt (slow on purpose); these tests are about the cap.
const hashPassword = vi.hoisted(() => vi.fn(async () => 'scrypt$test-hash'));
vi.mock('@/server/auth/password', async (importOriginal) => ({
  ...(await importOriginal<typeof PasswordModule>()),
  hashPassword,
}));

const harness = freshDb();
trustTestState();

const DAY_MS = 24 * 60 * 60 * 1000;
const IP = '203.0.113.7';

const input = (email: string) => ({
  email,
  password: GOOD_PASSWORD,
  name: 'Layla',
  locale: 'en' as const,
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const row = (id: string) => harness.db.select().from(users).where(eq(users.id, id)).get();

describe('deleting an account does not free a slot of the per-address sign-up cap', () => {
  it('create, delete, create again from one address: the cap still bites', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '2' });
    const first = await registerUser(input('a@example.com'), { ip: IP });
    await registerUser(input('b@example.com'), { ip: IP });
    expect((await failure(registerUser(input('c@example.com'), { ip: IP }))).code).toBe(
      'signup_limit',
    );

    // The farm cycle: delete one account (spending its bonus does not matter), register anew.
    await deleteAccount(first.user.id);
    const blocked = await failure(registerUser(input('d@example.com'), { ip: IP }));
    expect(blocked).toMatchObject({ code: 'signup_limit', status: 429 });
    expect(harness.db.select().from(users).all()).toHaveLength(2);
  });

  it('counts the deleted account only for its own address', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    const first = await registerUser(input('a@example.com'), { ip: IP });
    await deleteAccount(first.user.id);
    await registerUser(input('b@example.com'), { ip: '198.51.100.9' });
    expect((await failure(registerUser(input('c@example.com'), { ip: IP }))).code).toBe(
      'signup_limit',
    );
  });

  it('works for the shared bucket of an unknown address too', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    const deleted = createUser(harness.db, { signupIp: 'unknown' });
    harness.db
      .update(users)
      .set({ signupIp: signupAddressAfterDeletion({ ...deleted, signupIp: 'unknown' }) })
      .where(eq(users.id, deleted.id))
      .run();
    // 199 more accounts fill the shared day of 200.
    for (let index = 0; index < 199; index += 1) createUser(harness.db, { signupIp: 'unknown' });
    expect(() => assertSignupsWithinCap(harness.db, undefined)).toThrow(/Too many accounts/);
  });

  it('what the tombstone keeps is a keyed digest, never the address', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '5' });
    const { user } = await registerUser(input('a@example.com'), { ip: IP });
    expect(row(user.id)?.signupIp).toBe(IP);
    await deleteAccount(user.id);
    const kept = row(user.id)?.signupIp ?? '';
    expect(kept).toBe(digestSignupAddress(IP));
    expect(kept).toMatch(/^h:[0-9a-f]{64}$/);
    expect(JSON.stringify(row(user.id))).not.toContain(IP);
    // Keyed: another address gives another digest, and the same address the same one.
    expect(digestSignupAddress('198.51.100.9')).not.toBe(kept);
    expect(digestSignupAddress(IP)).toBe(kept);
  });

  it('the slot comes back once the sign-up day is over, and the digest is forgotten', async () => {
    stubEnv({ SIGNUPS_PER_IP_PER_DAY: '1' });
    const { user } = await registerUser(input('a@example.com'), { ip: IP });
    await deleteAccount(user.id);
    const created = row(user.id)?.createdAt ?? 0;

    // Still inside the day: counted, and not yet cleaned up.
    expect(() => assertSignupsWithinCap(harness.db, IP, created + DAY_MS - 1)).toThrow();
    expect(expireDeletedSignupAddresses(harness.db, created + DAY_MS - 1)).toBe(0);
    expect(row(user.id)?.signupIp).not.toBeNull();

    // The day is over: it no longer counts, and the sweep clears the digest.
    expect(() => assertSignupsWithinCap(harness.db, IP, created + DAY_MS + 1)).not.toThrow();
    expect(expireDeletedSignupAddresses(harness.db, created + DAY_MS)).toBe(1);
    expect(row(user.id)?.signupIp).toBeNull();
    expect(expireDeletedSignupAddresses(harness.db, created + 2 * DAY_MS)).toBe(0);
  });

  it('keeps nothing for an account whose sign-up day was already over when it was deleted', async () => {
    const old = createUser(harness.db, {
      signupIp: IP,
      createdAt: Date.now() - 3 * DAY_MS,
    });
    await deleteAccount(old.id);
    expect(row(old.id)?.signupIp).toBeNull();
  });

  it('never touches live accounts', async () => {
    const live = createUser(harness.db, { signupIp: IP, createdAt: Date.now() - 3 * DAY_MS });
    expect(expireDeletedSignupAddresses(harness.db)).toBe(0);
    expect(row(live.id)?.signupIp).toBe(IP);
  });

  it('an account without an address keeps nothing to digest', () => {
    expect(signupAddressAfterDeletion({ signupIp: null, createdAt: Date.now() })).toBeNull();
  });
});
