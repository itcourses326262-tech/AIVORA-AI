import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const WORKER = 'tests/server/generations/service-race-worker.ts';

type Tally = Record<string, number>;

/**
 * The real `createGeneration` in several processes at once, each with its own connection to the
 * same database file: the only way to exercise the transaction's locking for real.
 */
async function race(
  test: TestDb,
  userId: string,
  workers: Array<{ attempts: number; keys: 'same' | 'distinct' }>,
  env: Record<string, string> = {},
): Promise<Tally[]> {
  const startAt = Date.now() + 3000;
  const outputs = await Promise.all(
    workers.map((worker, index) =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          WORKER,
          String(startAt),
          userId,
          String(worker.attempts),
          worker.keys,
          `p${index}`,
        ],
        {
          cwd: ROOT,
          timeout: 90_000,
          env: {
            ...process.env,
            DATABASE_PATH: test.path,
            LOG_LEVEL: 'silent',
            MAX_ACTIVE_PER_USER: '100',
            WORKER_MODE: 'off',
            ...env,
          },
        },
      ),
    ),
  );
  return outputs.map(({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Tally);
}

const total = (tallies: Tally[], key: string) =>
  tallies.reduce((sum, tally) => sum + (tally[key] ?? 0), 0);

let test: TestDb;

beforeEach(() => {
  test = createTestDb({ file: true });
});

afterEach(() => {
  test.close();
});

describe('createGeneration across processes', () => {
  it('creates one generation when many processes send the same idempotency key', async () => {
    const user = seedUser(test.db, { creditBalance: 50 });
    const tallies = await race(
      test,
      user.id,
      Array.from({ length: 4 }, () => ({ attempts: 5, keys: 'same' as const })),
    );
    expect(total(tallies, 'created')).toBe(1);
    expect(total(tallies, 'replayed')).toBe(19);
    expect(total(tallies, 'other')).toBe(0);
    expect(test.db.select().from(generations).all()).toHaveLength(1);
    expect(getBalance(test.db, user.id)).toBe(49);
    expectConsistentLedger(test.db, user.id, 50);
  }, 120_000);

  it('never lets a user exceed the active-generation limit, however many requests race', async () => {
    const user = seedUser(test.db, { creditBalance: 50 });
    const tallies = await race(
      test,
      user.id,
      Array.from({ length: 4 }, () => ({ attempts: 6, keys: 'distinct' as const })),
      { MAX_ACTIVE_PER_USER: '3' },
    );
    expect(total(tallies, 'created')).toBe(3);
    expect(total(tallies, 'too_many_active')).toBe(21);
    expect(total(tallies, 'other')).toBe(0);
    expect(test.db.select().from(generations).all()).toHaveLength(3);
    expect(getBalance(test.db, user.id)).toBe(47);
    expectConsistentLedger(test.db, user.id, 50);
  }, 120_000);

  it('never spends more credits than the user has', async () => {
    const user = seedUser(test.db, { creditBalance: 7 });
    const tallies = await race(
      test,
      user.id,
      Array.from({ length: 3 }, () => ({ attempts: 5, keys: 'distinct' as const })),
    );
    expect(total(tallies, 'created')).toBe(7);
    expect(total(tallies, 'insufficient_credits')).toBe(8);
    expect(total(tallies, 'other')).toBe(0);
    expect(getBalance(test.db, user.id)).toBe(0);
    expect(test.db.select().from(generations).all()).toHaveLength(7);
    expectConsistentLedger(test.db, user.id, 7);
  }, 120_000);
});
