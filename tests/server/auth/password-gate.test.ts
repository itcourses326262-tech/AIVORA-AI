import type * as CryptoModule from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

type ScryptCallback = (error: Error | null, key: Buffer) => void;

const control = vi.hoisted(() => ({
  pending: [] as Array<() => void>,
  inFlight: 0,
  peak: 0,
  started: 0,
}));

// A scrypt whose completion the test controls, to observe how many run at once.
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof CryptoModule>();
  return {
    ...actual,
    scrypt: (
      _password: unknown,
      _salt: unknown,
      keyLength: number,
      _options: unknown,
      cb: ScryptCallback,
    ) => {
      control.started += 1;
      control.inFlight += 1;
      control.peak = Math.max(control.peak, control.inFlight);
      control.pending.push(() => {
        control.inFlight -= 1;
        cb(null, Buffer.alloc(keyLength, 7));
      });
    },
  };
});

import { hashPassword, verifyAgainstDummy } from '@/server/auth/password';
import { loginUser } from '@/server/auth/users';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';
import { cleanSecurityState } from './support';

const harness = freshDb();
cleanSecurityState();

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

function releaseAll(): void {
  while (control.pending.length > 0) control.pending.shift()?.();
}

describe('hash concurrency gate', () => {
  it('runs at most 3 scrypt derivations at once and queues the rest', async () => {
    const hashes = Array.from({ length: 10 }, () => hashPassword('queued-password-1'));
    await settle();
    expect(control.started).toBe(3);

    // Each completion hands its slot to the next waiter.
    while (control.pending.length > 0) {
      control.pending.shift()?.();
      await settle();
    }
    const results = await Promise.all(hashes);
    expect(results).toHaveLength(10);
    expect(control.started).toBe(10);
    expect(control.peak).toBe(3);
  });

  it('answers "busy" (429 rate_limited) instead of queueing without bound', async () => {
    control.started = 0;
    const accepted = Array.from({ length: 3 + 64 }, () => hashPassword('queued-password-2'));
    await settle();
    const rejected = await hashPassword('one-too-many-1').catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(AppError);
    expect((rejected as AppError).code).toBe('rate_limited');
    expect((rejected as AppError).status).toBe(429);

    while (control.pending.length > 0) {
      releaseAll();
      await settle();
    }
    await expect(Promise.all(accepted)).resolves.toHaveLength(67);
  });
});

/** Runs the pending (mocked) derivations until `promise` settles; the promise never rejects here. */
async function finish<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  while (!done) {
    releaseAll();
    await settle();
  }
  return tracked;
}

/** A well-formed stored hash whose key is not what the mocked scrypt derives (seven bytes). */
function storedHash(): string {
  const salt = Buffer.alloc(16, 1).toString('base64url');
  return ['scrypt', 2 ** 15, 8, 2, salt, Buffer.alloc(64, 9).toString('base64url')].join('$');
}

describe('the dummy hash behind unknown-email logins', () => {
  it('is not poisoned by a first use that the saturated gate refused', async () => {
    createUser(harness.db, { email: 'member@example.com', passwordHash: storedHash() });
    const accepted = Array.from({ length: 3 + 64 }, () => hashPassword('queued-password-3'));
    await settle();

    // During the burst nothing can be hashed, so the very first dummy hash is refused ...
    const during = await verifyAgainstDummy('guess-guess-1').catch((error: unknown) => error);
    expect(during).toBeInstanceOf(AppError);
    expect((during as AppError).code).toBe('rate_limited');
    while (control.pending.length > 0) {
      releaseAll();
      await settle();
    }
    await Promise.all(accepted);

    // ... and once the gate is idle again unknown emails must answer exactly like wrong
    // passwords. A remembered failure made them answer 429 forever: an account-existence oracle.
    for (const email of ['ghost@example.com', 'other-ghost@example.com', 'member@example.com']) {
      const outcome = await finish(
        loginUser({ email, password: 'guess-guess-1' }).catch((error: unknown) => error),
      );
      expect(outcome, email).toBeInstanceOf(AppError);
      expect((outcome as AppError).code, email).toBe('unauthorized');
    }
    await expect(finish(verifyAgainstDummy('guess-guess-1'))).resolves.toBeUndefined();
  });
});
