import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getBalance } from '@/server/credits';
import { assets, generations } from '@/server/db/schema';
import { claimNextJob } from '@/server/generations/lifecycle';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';
import { queue } from './support';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');
const WORKER = 'tests/server/generations/race-worker.ts';

/**
 * better-sqlite3 is synchronous, so one process can never interleave two transactions: real races
 * need real processes. Each child has its own connection to the same file and starts at a shared
 * timestamp, like tests/server/credits/race.test.ts.
 */
async function race<T>(path: string, jobs: string[][]): Promise<T[]> {
  const startAt = Date.now() + 2500;
  const outputs = await Promise.all(
    jobs.map(([mode, ...rest], index) =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          WORKER,
          mode ?? '',
          path,
          String(startAt),
          `p${index}`,
          ...rest,
        ],
        { cwd: ROOT, timeout: 90_000 },
      ),
    ),
  );
  return outputs.map(({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as T);
}

let test: TestDb;

beforeEach(() => {
  test = createTestDb({ file: true });
});

afterEach(() => {
  test.close();
});

describe('claiming from several processes', () => {
  it('hands every queued job to exactly one worker', async () => {
    const user = seedUser(test.db, { creditBalance: 500 });
    const ids = Array.from({ length: 40 }, () => queue(test.db, user).id);

    const results = await race<{ claimed: string[] }>(
      test.path,
      Array.from({ length: 4 }, () => ['claim']),
    );

    const all = results.flatMap((result) => result.claimed);
    expect(all).toHaveLength(ids.length);
    expect(new Set(all).size).toBe(ids.length);
    expect(new Set(all)).toEqual(new Set(ids));
    // Several workers really did share the work (this would fail if one process won every time).
    expect(results.filter((result) => result.claimed.length > 0).length).toBeGreaterThan(1);

    const rows = test.db.select().from(generations).all();
    expect(rows.every((row) => row.status === 'processing' && row.attempts === 1)).toBe(true);
  }, 120_000);
});

describe('cancel against complete', () => {
  it('lets exactly one of them win and keeps the money right whichever it is', async () => {
    const user = seedUser(test.db, { creditBalance: 100 });
    const generationIds: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      const job = queue(test.db, user, { cost: 3 });
      claimNextJob(test.db, 'worker-a', 60_000, Date.now());
      generationIds.push(job.id);
    }

    const results = await race<{ won: boolean }>(
      test.path,
      generationIds.flatMap((id) => [
        ['complete', id, 'worker-a'],
        ['cancel', id, user.id],
      ]),
    );

    let succeeded = 0;
    let canceled = 0;
    generationIds.forEach((id, index) => {
      const completeWon = results[index * 2]?.won === true;
      const cancelWon = results[index * 2 + 1]?.won === true;
      expect(completeWon !== cancelWon, `exactly one winner for ${id}`).toBe(true);
      const row = test.db.select().from(generations).where(eq(generations.id, id)).get();
      const outputRows = test.db.select().from(assets).where(eq(assets.generationId, id)).all();
      if (completeWon) {
        succeeded += 1;
        expect(row?.status).toBe('succeeded');
        expect(outputRows).toHaveLength(1);
      } else {
        canceled += 1;
        expect(row?.status).toBe('canceled');
        expect(outputRows).toHaveLength(0);
      }
    });
    // A canceled job is refunded in full; a succeeded one is never refunded.
    expect(getBalance(test.db, user.id)).toBe(100 - succeeded * 3);
    expect(succeeded + canceled).toBe(generationIds.length);
    expectConsistentLedger(test.db, user.id, 100);
  }, 120_000);
});

describe('failing from several processes', () => {
  it('fails a job once and refunds it once, however many try', async () => {
    const user = seedUser(test.db, { creditBalance: 40 });
    const job = queue(test.db, user, { cost: 9 });
    claimNextJob(test.db, 'worker-a', 60_000, Date.now());

    const results = await race<{ won: boolean }>(test.path, [
      ['fail', job.id, 'worker-a'],
      ['fail', job.id, 'worker-a'],
      ['fail', job.id, '-'],
      ['cancel', job.id, user.id],
    ]);

    expect(results.filter((result) => result.won)).toHaveLength(1);
    expect(getBalance(test.db, user.id)).toBe(40);
    expect(ledgerInOrder(test.db, user.id).map((entry) => entry.reason)).toEqual([
      'generation',
      'refund',
    ]);
    expectConsistentLedger(test.db, user.id, 40);
  }, 120_000);
});

describe('requeueStale from several processes', () => {
  it('recovers each expired job once', async () => {
    const user = seedUser(test.db, { creditBalance: 100 });
    for (let index = 0; index < 10; index += 1) {
      queue(test.db, user, {
        status: 'processing',
        attempts: 1,
        workerId: 'dead',
        leaseUntil: 1,
      });
    }
    const results = await race<{ touched: number }>(
      test.path,
      Array.from({ length: 3 }, () => ['requeue', String(Date.now())]),
    );
    expect(results.reduce((total, result) => total + result.touched, 0)).toBe(10);
    const rows = test.db.select().from(generations).all();
    expect(rows.every((row) => row.status === 'queued' && row.workerId === null)).toBe(true);
  }, 120_000);
});
