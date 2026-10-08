import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/lib/id';
import { debitCredits, getBalance } from '@/server/credits';
import { createDb, withTx } from '@/server/db';
import { creditLedger } from '@/server/db/schema';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');

interface Tally {
  succeeded: number;
  rejected: number;
  other: number;
}

/**
 * Real concurrency needs real parallelism: better-sqlite3 is synchronous, so one process can never
 * interleave two transactions. Each child is a separate OS process with its own connection to the
 * same database file, started together at a shared timestamp.
 */
async function race(
  path: string,
  workers: Array<{
    mode: 'debit' | 'refund';
    userId: string;
    attempts: number;
    generationId?: string;
  }>,
): Promise<Tally[]> {
  const startAt = Date.now() + 2500;
  const outputs = await Promise.all(
    workers.map((worker, index) =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          'tests/helpers/credits-race-worker.ts',
          worker.mode,
          path,
          worker.userId,
          String(worker.attempts),
          String(startAt),
          `w${index}`,
          ...(worker.generationId ? [worker.generationId] : []),
        ],
        { cwd: ROOT, timeout: 90_000 },
      ),
    ),
  );
  return outputs.map(({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Tally);
}

const sum = (tallies: Tally[], key: keyof Tally) =>
  tallies.reduce((total, tally) => total + tally[key], 0);

let test: TestDb;

beforeEach(() => {
  test = createTestDb({ file: true });
});

afterEach(() => {
  test.close();
});

describe('concurrent debits from separate connections', () => {
  it('cannot overdraw: exactly `balance` debits succeed and the rest are rejected', async () => {
    const user = seedUser(test.db, { creditBalance: 250 });
    const tallies = await race(
      test.path,
      Array.from({ length: 4 }, () => ({ mode: 'debit' as const, userId: user.id, attempts: 150 })),
    );

    expect(sum(tallies, 'other')).toBe(0);
    expect(sum(tallies, 'succeeded')).toBe(250);
    expect(sum(tallies, 'rejected')).toBe(350);

    expect(getBalance(test.db, user.id)).toBe(0);
    expect(ledgerInOrder(test.db, user.id)).toHaveLength(250);
    expectConsistentLedger(test.db, user.id, 250);
  }, 120_000);

  it('does not overdraw with an odd balance and uneven workers', async () => {
    const user = seedUser(test.db, { creditBalance: 37 });
    const tallies = await race(test.path, [
      { mode: 'debit', userId: user.id, attempts: 40 },
      { mode: 'debit', userId: user.id, attempts: 25 },
      { mode: 'debit', userId: user.id, attempts: 10 },
    ]);
    expect(sum(tallies, 'succeeded')).toBe(37);
    expect(sum(tallies, 'rejected')).toBe(38);
    expect(sum(tallies, 'other')).toBe(0);
    expect(getBalance(test.db, user.id)).toBe(0);
    expectConsistentLedger(test.db, user.id, 37);
  }, 120_000);

  it('keeps separate users independent while they all hit the database at once', async () => {
    const [a, b] = [
      seedUser(test.db, { creditBalance: 60 }),
      seedUser(test.db, { creditBalance: 90 }),
    ];
    const tallies = await race(test.path, [
      { mode: 'debit', userId: a.id, attempts: 100 },
      { mode: 'debit', userId: b.id, attempts: 100 },
      { mode: 'debit', userId: a.id, attempts: 100 },
      { mode: 'debit', userId: b.id, attempts: 100 },
    ]);
    expect(sum(tallies, 'other')).toBe(0);
    expect(getBalance(test.db, a.id)).toBe(0);
    expect(getBalance(test.db, b.id)).toBe(0);
    expect((tallies[0]?.succeeded ?? 0) + (tallies[2]?.succeeded ?? 0)).toBe(60);
    expect((tallies[1]?.succeeded ?? 0) + (tallies[3]?.succeeded ?? 0)).toBe(90);
    expectConsistentLedger(test.db, a.id, 60);
    expectConsistentLedger(test.db, b.id, 90);
  }, 120_000);

  it('refunds a generation exactly once even when several processes try at the same time', async () => {
    const user = seedUser(test.db, { creditBalance: 30 });
    const generationId = newId('gen');
    debitCredits(test.db, { userId: user.id, amount: 12, generationId });

    const tallies = await race(
      test.path,
      Array.from({ length: 3 }, () => ({
        mode: 'refund' as const,
        userId: user.id,
        attempts: 40,
        generationId,
      })),
    );

    expect(sum(tallies, 'succeeded')).toBe(1);
    expect(sum(tallies, 'other')).toBe(0);
    expect(getBalance(test.db, user.id)).toBe(30);
    expect(ledgerInOrder(test.db, user.id).map((row) => row.reason)).toEqual([
      'generation',
      'refund',
    ]);
    expectConsistentLedger(test.db, user.id, 30);
  }, 120_000);
});

describe('two connections in one process', () => {
  it('the second writer waits for the first to commit instead of reading a stale balance', () => {
    const user = seedUser(test.db, { creditBalance: 5 });
    const other = createDb(test.path);
    try {
      // Connection A holds the write lock mid-transaction; B, with a short busy timeout, is refused
      // instead of racing ahead on the pre-debit balance.
      other.$client.pragma('busy_timeout = 0');
      let blocked: unknown;
      withTx(test.db, (tx) => {
        debitCredits(tx, { userId: user.id, amount: 5, generationId: 'gen_a' });
        try {
          debitCredits(other, { userId: user.id, amount: 5, generationId: 'gen_b' });
        } catch (error) {
          blocked = error;
        }
      });
      expect((blocked as { code?: string } | undefined)?.code).toBe('SQLITE_BUSY');

      // After A commits, B sees the real balance and is refused by the credits rule instead.
      other.$client.pragma('busy_timeout = 5000');
      expect(() =>
        debitCredits(other, { userId: user.id, amount: 5, generationId: 'gen_b' }),
      ).toThrow(/Insufficient credits/);
      expect(getBalance(test.db, user.id)).toBe(0);
      expect(
        test.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all(),
      ).toHaveLength(1);
    } finally {
      other.$client.close();
    }
  });
});
