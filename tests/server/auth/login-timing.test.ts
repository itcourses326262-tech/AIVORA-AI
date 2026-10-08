import type * as CryptoModule from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { AppError } from '@/lib/errors';

const spy = vi.hoisted(() => ({ calls: 0 }));

// The real scrypt, with a call counter.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  const scrypt = ((...args: Parameters<typeof actual.scrypt>) => {
    spy.calls += 1;
    return actual.scrypt(...args);
  }) as typeof actual.scrypt;
  return { ...actual, scrypt };
});

import { hashPassword, verifyAgainstDummy } from '@/server/auth/password';
import { loginUser } from '@/server/auth/users';
import { GOOD_PASSWORD, cleanSecurityState, passwordFixture } from './support';

const harness = freshDb();
const fixture = passwordFixture();
cleanSecurityState();

async function expectUnauthorized(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('unauthorized');
}

describe('login timing equalisation', () => {
  it('runs exactly one scrypt derivation for an unknown email, like a wrong password does', async () => {
    createUser(harness.db, { email: 'member@example.com', passwordHash: fixture.hash });
    await verifyAgainstDummy('warm-up'); // makes the per-process dummy hash once
    spy.calls = 0;

    await expectUnauthorized(loginUser({ email: 'ghost@example.com', password: GOOD_PASSWORD }));
    const unknown = spy.calls;
    spy.calls = 0;
    await expectUnauthorized(loginUser({ email: 'member@example.com', password: 'wrong-wrong-1' }));
    const wrong = spy.calls;
    spy.calls = 0;
    await expectUnauthorized(loginUser({ email: '', password: 'anything-at-all' }));
    const empty = spy.calls;

    expect(unknown).toBe(1);
    expect(wrong).toBe(1);
    expect(empty).toBe(1);
  });

  it('verifies against a hash with the current parameters, so the cost matches a real account', async () => {
    const real = await hashPassword('some-real-password-1');
    const [, n, r, p] = real.split('$');
    spy.calls = 0;
    await verifyAgainstDummy('x');
    expect(spy.calls).toBe(1); // the dummy hash exists already: one derivation, no re-hash
    expect([n, r, p]).toEqual(['32768', '8', '2']);
  });
});
