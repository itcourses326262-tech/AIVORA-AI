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
  const actual = await importOriginal<typeof import('node:crypto')>();
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

import { hashPassword } from '@/server/auth/password';

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
