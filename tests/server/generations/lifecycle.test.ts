import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getBalance } from '@/server/credits';
import { assets, generations, type GenerationRow } from '@/server/db/schema';
import {
  INTERRUPTED_FAILURE,
  claimNextJob,
  completeGeneration,
  extendLease,
  failGeneration,
  markCanceled,
  recordSubmitted,
  releaseJob,
  releaseWorkerJobs,
  requeueStale,
  updateProgress,
} from '@/server/generations/lifecycle';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createDb } from '@/server/db';
import { createTestDb, seedUser } from '../../helpers/db';
import { createGeneration } from '../../helpers/factories';
import { persisted, queue } from './support';

const LEASE = 60_000;
const NOW = 1_700_000_000_000;

function setup(balance = 50) {
  const test = createTestDb();
  const user = seedUser(test.db, { creditBalance: balance });
  const row = (id: string): GenerationRow =>
    test.db.select().from(generations).where(eq(generations.id, id)).get() as GenerationRow;
  return { ...test, user, row };
}

describe('claimNextJob', () => {
  it('returns null when nothing is waiting', () => {
    const { db, close } = setup();
    expect(claimNextJob(db, 'w1', LEASE, NOW)).toBeNull();
    close();
  });

  it('claims the oldest queued job and records who, until when and how often', () => {
    const { db, user, close, row } = setup();
    const newer = queue(db, user, { createdAt: NOW - 10 });
    const older = queue(db, user, { createdAt: NOW - 1000 });

    const claimed = claimNextJob(db, 'w1', LEASE, NOW);
    expect(claimed?.id).toBe(older.id);
    expect(claimed).toMatchObject({
      status: 'processing',
      workerId: 'w1',
      attempts: 1,
      leaseUntil: NOW + LEASE,
      startedAt: NOW,
    });
    expect(row(newer.id).status).toBe('queued');
    close();
  });

  it('breaks createdAt ties by id so the order is stable', () => {
    const { db, user, close } = setup();
    const a = queue(db, user, { createdAt: NOW });
    const b = queue(db, user, { createdAt: NOW });
    const first = claimNextJob(db, 'w1', LEASE, NOW);
    const second = claimNextJob(db, 'w1', LEASE, NOW);
    expect([first?.id, second?.id]).toEqual([a.id, b.id].toSorted());
    close();
  });

  it('never hands the same job to two claimers', () => {
    const { db, user, close } = setup();
    queue(db, user);
    expect(claimNextJob(db, 'w1', LEASE, NOW)).not.toBeNull();
    expect(claimNextJob(db, 'w2', LEASE, NOW)).toBeNull();
    close();
  });

  it('leaves a processing job alone while its lease is alive', () => {
    const { db, user, close } = setup();
    queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(claimNextJob(db, 'w2', LEASE, NOW + LEASE - 1)).toBeNull();
    close();
  });

  it('takes over a processing job once its lease expired, counting another attempt', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    const taken = claimNextJob(db, 'w2', LEASE, NOW + LEASE + 1);
    expect(taken).toMatchObject({
      id: job.id,
      workerId: 'w2',
      attempts: 2,
      startedAt: NOW,
      leaseUntil: NOW + LEASE + 1 + LEASE,
    });
    close();
  });

  it('does not take over an expired job that already used all its attempts', () => {
    const { db, user, close } = setup();
    queue(db, user, { status: 'processing', attempts: 3, workerId: 'w1', leaseUntil: NOW - 1 });
    expect(claimNextJob(db, 'w2', LEASE, NOW, { maxAttempts: 3 })).toBeNull();
    expect(claimNextJob(db, 'w2', LEASE, NOW, { maxAttempts: 4 })).not.toBeNull();
    close();
  });

  it('treats a processing row without any lease as expired', () => {
    const { db, user, close } = setup();
    queue(db, user, { status: 'processing', attempts: 1, workerId: 'gone', leaseUntil: null });
    expect(claimNextJob(db, 'w2', LEASE, NOW)).not.toBeNull();
    close();
  });

  it.each(['succeeded', 'failed', 'canceled'] as const)('ignores %s generations', (status) => {
    const { db, user, close } = setup();
    queue(db, user, { status, leaseUntil: NOW - 1 });
    expect(claimNextJob(db, 'w1', LEASE, NOW)).toBeNull();
    close();
  });

  it('keeps the original startedAt and progress across a takeover', () => {
    const { db, user, close } = setup();
    queue(db, user, {
      status: 'processing',
      attempts: 1,
      workerId: 'w1',
      leaseUntil: NOW - 1,
      startedAt: 42,
      progress: 55,
    });
    const taken = claimNextJob(db, 'w2', LEASE, NOW);
    expect(taken).toMatchObject({ startedAt: 42, progress: 55 });
    close();
  });
});

describe('claimNextJob between users', () => {
  const VIDEO = {
    tool: 'text-to-video',
    modelId: 'aivore-demo-video',
    params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
  } as const;

  it('does not let one user take every slot while another user waits', () => {
    const { db, user, close } = setup(100);
    const other = seedUser(db, { creditBalance: 100 });
    const videos = Array.from({ length: 4 }, (_, index) =>
      queue(db, user, { ...VIDEO, createdAt: NOW + index }),
    );
    const image = queue(db, other, { createdAt: NOW + 10 });

    const order = [1, 2, 3, 4, 5].map((n) => claimNextJob(db, `w${n}`, LEASE, NOW + 20)?.id);
    // The first claim is the oldest job. With one video running, the other user has the fewer
    // running jobs and goes next; after that both have one running and age decides again.
    expect(order).toEqual([videos[0]?.id, image.id, videos[1]?.id, videos[2]?.id, videos[3]?.id]);
    close();
  });

  it('still gives a user who is alone every slot', () => {
    const { db, user, close } = setup(100);
    const jobs = Array.from({ length: 3 }, (_, index) =>
      queue(db, user, { createdAt: NOW + index }),
    );
    expect([1, 2, 3].map((n) => claimNextJob(db, `w${n}`, LEASE, NOW + 5)?.id)).toEqual(
      jobs.map((job) => job.id),
    );
    close();
  });

  it('falls back to the oldest job when the users have the same load', () => {
    const { db, user, close } = setup();
    const other = seedUser(db, { creditBalance: 50 });
    const younger = queue(db, user, { createdAt: NOW + 5 });
    const older = queue(db, other, { createdAt: NOW });
    expect(claimNextJob(db, 'w1', LEASE, NOW + 10)?.id).toBe(older.id);
    expect(claimNextJob(db, 'w2', LEASE, NOW + 10)?.id).toBe(younger.id);
    close();
  });

  it('counts only jobs that are really running, not orphans whose lease ran out', () => {
    const { db, user, close } = setup(100);
    const other = seedUser(db, { creditBalance: 100 });
    // The first user has an orphan (expired lease, the oldest job) and a queued job: nothing of
    // theirs is running, so the orphan must not count against them and is taken first.
    const orphan = queue(db, user, {
      status: 'processing',
      attempts: 1,
      workerId: 'gone',
      leaseUntil: NOW - 1,
      createdAt: NOW - 100,
    });
    const queuedOfFirst = queue(db, user, { createdAt: NOW });
    const queuedOfSecond = queue(db, other, { createdAt: NOW + 1 });
    expect(claimNextJob(db, 'w1', LEASE, NOW)?.id).toBe(orphan.id);
    // Now the first user really runs one job, so the second user's job goes before their queued one.
    expect(claimNextJob(db, 'w2', LEASE, NOW)?.id).toBe(queuedOfSecond.id);
    expect(claimNextJob(db, 'w3', LEASE, NOW)?.id).toBe(queuedOfFirst.id);
    close();
  });
});

describe('jobs the caller says it is running itself', () => {
  it('claimNextJob never takes an excluded job, queued or with a lease that only looks expired', () => {
    const { db, user, close, row } = setup();
    const mine = queue(db, user, { createdAt: NOW });
    const next = queue(db, user, { createdAt: NOW + 1 });
    claimNextJob(db, 'w1', LEASE, NOW);
    // The lease lapsed (a stall): without the exclusion the same worker would claim it again.
    expect(claimNextJob(db, 'w1', LEASE, NOW + LEASE + 1, { excludeIds: [mine.id] })?.id).toBe(
      next.id,
    );
    expect(row(mine.id)).toMatchObject({ status: 'processing', attempts: 1 });
    expect(claimNextJob(db, 'w1', LEASE, NOW + LEASE + 1, { excludeIds: [mine.id] })).toBeNull();
    // Not excluded, it would be an ordinary takeover.
    expect(claimNextJob(db, 'w1', LEASE, NOW + LEASE + 1)?.id).toBe(mine.id);
    close();
  });

  it('claimNextJob does not claim an excluded job that was requeued meanwhile', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    expect(claimNextJob(db, 'w1', LEASE, NOW, { excludeIds: [job.id] })).toBeNull();
    expect(claimNextJob(db, 'w1', LEASE, NOW, { excludeIds: [] })?.id).toBe(job.id);
    close();
  });

  it('requeueStale leaves an excluded job in place and still recovers the others', () => {
    const { db, user, close, row } = setup();
    const alive = queue(db, user);
    const orphan = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3, excludeIds: [alive.id] })).toBe(1);
    expect(row(alive.id)).toMatchObject({ status: 'processing', workerId: 'w1' });
    expect(row(orphan.id)).toMatchObject({ status: 'queued', workerId: null });
    close();
  });

  it('requeueStale does not fail an excluded job even when its attempts are used up', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user, {
      status: 'processing',
      attempts: 3,
      workerId: 'w1',
      leaseUntil: 1,
    });
    expect(requeueStale(db, NOW, { maxAttempts: 3, excludeIds: [job.id] })).toBe(0);
    expect(row(job.id).status).toBe('processing');
    expect(getBalance(db, user.id)).toBe(49);
    expect(requeueStale(db, NOW, { maxAttempts: 3 })).toBe(1);
    expect(row(job.id).status).toBe('failed');
    close();
  });
});

describe('extendLease', () => {
  it('moves the lease of the owner', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(extendLease(db, job.id, 'w1', LEASE, NOW + 5000)).toBe(true);
    expect(row(job.id).leaseUntil).toBe(NOW + 5000 + LEASE);
    close();
  });

  it('refuses another worker, a queued job and a finished one', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    expect(extendLease(db, job.id, 'w1', LEASE, NOW)).toBe(false);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(extendLease(db, job.id, 'w2', LEASE, NOW)).toBe(false);
    failGeneration(db, job.id, 'w1', { code: 'internal', message: 'x' });
    expect(extendLease(db, job.id, 'w1', LEASE, NOW)).toBe(false);
    close();
  });
});

describe('recordSubmitted', () => {
  it('stores the provider job id and its metadata for a resume', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    const meta = { v: 1, startedAt: NOW, nested: { seed: 7 } };
    expect(recordSubmitted(db, job.id, 'w1', 'prov_1', meta)).toBe(true);
    expect(row(job.id)).toMatchObject({ providerJobId: 'prov_1', providerMeta: meta });
    close();
  });

  it('stores no metadata as null and refuses non-owners', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(recordSubmitted(db, job.id, 'w2', 'prov_x')).toBe(false);
    expect(row(job.id).providerJobId).toBeNull();
    expect(recordSubmitted(db, job.id, 'w1', 'prov_1')).toBe(true);
    expect(row(job.id).providerMeta).toBeNull();
    close();
  });

  it('refuses a canceled job', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    markCanceled(db, user.id, job.id);
    expect(recordSubmitted(db, job.id, 'w1', 'prov_1')).toBe(false);
    close();
  });
});

describe('updateProgress', () => {
  it('only ever moves forward and stays within 0-100', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    const seen: number[] = [];
    for (const value of [10, 5, 40, 40, 39, 250, 70, -3, Number.NaN, 12.6]) {
      updateProgress(db, job.id, 'w1', value);
      seen.push(row(job.id).progress);
    }
    expect(seen).toEqual([10, 10, 40, 40, 40, 100, 100, 100, 100, 100]);
    close();
  });

  it('rounds to whole numbers', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    updateProgress(db, job.id, 'w1', 33.6);
    expect(row(job.id).progress).toBe(34);
    close();
  });

  it('is a no-op for another worker and after the job ended', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    updateProgress(db, job.id, 'w2', 80);
    expect(row(job.id).progress).toBe(0);
    markCanceled(db, user.id, job.id);
    updateProgress(db, job.id, 'w1', 80);
    expect(row(job.id).progress).toBe(0);
    close();
  });
});

describe('completeGeneration', () => {
  it('succeeds the job and inserts the output assets in one step', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    const out = persisted(0, { durationMs: 5000, kind: 'image' });
    expect(completeGeneration(db, job.id, 'w1', [out])).toBe(true);

    expect(row(job.id)).toMatchObject({
      status: 'succeeded',
      progress: 100,
      leaseUntil: null,
      errorCode: null,
    });
    expect(row(job.id).finishedAt).toBeGreaterThan(0);
    const stored = db.select().from(assets).where(eq(assets.generationId, job.id)).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: out.assetId,
      userId: user.id,
      role: 'output',
      kind: 'image',
      index: 0,
      storageKey: out.storageKey,
      thumbKey: out.thumbKey,
      mimeType: 'image/png',
      bytes: out.bytes,
      width: 64,
      height: 64,
      durationMs: 5000,
      sha256: out.sha256,
    });
    close();
  });

  it('stores optional fields as null and keeps the output order', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    claimNextJob(db, 'w1', LEASE, NOW);
    const bare = {
      ...persisted(1),
      thumbKey: undefined,
      width: undefined,
      height: undefined,
      sha256: undefined,
    };
    completeGeneration(db, job.id, 'w1', [persisted(0), bare]);
    const stored = db
      .select()
      .from(assets)
      .where(eq(assets.generationId, job.id))
      .orderBy(assets.index)
      .all();
    expect(stored.map((asset) => asset.index)).toEqual([0, 1]);
    expect(stored[1]).toMatchObject({ thumbKey: null, width: null, height: null, sha256: null });
    close();
  });

  it('does not refund when everything that was paid for arrived', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    claimNextJob(db, 'w1', LEASE, NOW);
    completeGeneration(db, job.id, 'w1', [persisted(0), persisted(1)]);
    expect(getBalance(db, user.id)).toBe(48);
    expect(ledgerInOrder(db, user.id).map((entry) => entry.reason)).toEqual(['generation']);
    close();
  });

  it.each([
    { count: 4, cost: 4, delivered: 3, refund: 1 },
    { count: 4, cost: 4, delivered: 2, refund: 2 },
    { count: 4, cost: 4, delivered: 1, refund: 3 },
    { count: 3, cost: 5, delivered: 2, refund: 1 },
    { count: 3, cost: 5, delivered: 1, refund: 3 },
    { count: 2, cost: 1, delivered: 1, refund: 0 },
  ])(
    'refunds the missing share of $count images costing $cost when $delivered arrive ($refund back)',
    ({ count, cost, delivered, refund }) => {
      const { db, user, close } = setup();
      const job = queue(db, user, { params: { aspectRatio: '1:1', count }, cost });
      claimNextJob(db, 'w1', LEASE, NOW);
      const outputs = Array.from({ length: delivered }, (_, index) => persisted(index));
      expect(completeGeneration(db, job.id, 'w1', outputs)).toBe(true);
      expect(getBalance(db, user.id)).toBe(50 - cost + refund);
      expectConsistentLedger(db, user.id, 50);
      close();
    },
  );

  it('never refunds more than was paid, in total, across a partial result', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { params: { aspectRatio: '1:1', count: 4 }, cost: 4 });
    claimNextJob(db, 'w1', LEASE, NOW);
    completeGeneration(db, job.id, 'w1', [persisted(0)]);
    // A succeeded job is never refunded again, whatever calls follow.
    expect(failGeneration(db, job.id, null, { code: 'x', message: 'y' })).toBe(false);
    expect(markCanceled(db, user.id, job.id)).toBe(false);
    expect(getBalance(db, user.id)).toBe(50 - 4 + 3);
    close();
  });

  it('is a compare-and-set: a second completion changes nothing', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(completeGeneration(db, job.id, 'w1', [persisted(0)])).toBe(true);
    expect(completeGeneration(db, job.id, 'w1', [persisted(0)])).toBe(false);
    expect(db.select().from(assets).where(eq(assets.generationId, job.id)).all()).toHaveLength(1);
    close();
  });

  it('refuses a worker that does not own the job, and a queued job', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    expect(completeGeneration(db, job.id, 'w1', [persisted()])).toBe(false);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(completeGeneration(db, job.id, 'w2', [persisted()])).toBe(false);
    expect(row(job.id).status).toBe('processing');
    expect(db.select().from(assets).all()).toHaveLength(0);
    close();
  });

  it('cannot resurrect a canceled job and leaves no asset rows behind', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    markCanceled(db, user.id, job.id);
    expect(completeGeneration(db, job.id, 'w1', [persisted()])).toBe(false);
    expect(row(job.id).status).toBe('canceled');
    expect(db.select().from(assets).all()).toHaveLength(0);
    expect(getBalance(db, user.id)).toBe(50);
    close();
  });

  it('rejects an empty result instead of succeeding without anything', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(() => completeGeneration(db, job.id, 'w1', [])).toThrow(RangeError);
    expect(row(job.id).status).toBe('processing');
    close();
  });

  it('is atomic: a failing asset insert rolls the success and the refund back', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user, { params: { aspectRatio: '1:1', count: 3 }, cost: 3 });
    claimNextJob(db, 'w1', LEASE, NOW);
    const duplicate = persisted(0);
    expect(() =>
      completeGeneration(db, job.id, 'w1', [duplicate, { ...duplicate, index: 1 }]),
    ).toThrow();
    expect(row(job.id).status).toBe('processing');
    expect(db.select().from(assets).all()).toHaveLength(0);
    expect(getBalance(db, user.id)).toBe(47);
    expectConsistentLedger(db, user.id, 50);
    close();
  });
});

describe('failGeneration', () => {
  it('fails a processing job and refunds it in full', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user, { cost: 7 });
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(failGeneration(db, job.id, 'w1', { code: 'unavailable', message: 'Try again' })).toBe(
      true,
    );
    expect(row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'unavailable',
      errorMessage: 'Try again',
      leaseUntil: null,
    });
    expect(row(job.id).finishedAt).toBeGreaterThan(0);
    expect(getBalance(db, user.id)).toBe(50);
    expect(ledgerInOrder(db, user.id).map((entry) => [entry.reason, entry.delta])).toEqual([
      ['generation', -7],
      ['refund', 7],
    ]);
    close();
  });

  it('is idempotent: failing twice refunds once', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { cost: 5 });
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(failGeneration(db, job.id, 'w1', { code: 'a', message: 'b' })).toBe(true);
    expect(failGeneration(db, job.id, 'w1', { code: 'a', message: 'b' })).toBe(false);
    expect(failGeneration(db, job.id, null, { code: 'a', message: 'b' })).toBe(false);
    expect(getBalance(db, user.id)).toBe(50);
    expectConsistentLedger(db, user.id, 50);
    close();
  });

  it('lets a caller without a worker id fail queued and processing jobs', () => {
    const { db, user, close } = setup();
    const queued = queue(db, user);
    const running = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW - 1000);
    const claimed = [queued, running].map((job) => job.id);
    for (const id of claimed) {
      expect(failGeneration(db, id, null, { code: 'internal', message: 'stopped' })).toBe(true);
    }
    expect(getBalance(db, user.id)).toBe(50);
    close();
  });

  it('with a worker id only matches the job that worker still owns', () => {
    const { db, user, close, row } = setup();
    const queued = queue(db, user);
    expect(failGeneration(db, queued.id, 'w1', { code: 'a', message: 'b' })).toBe(false);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(failGeneration(db, queued.id, 'w2', { code: 'a', message: 'b' })).toBe(false);
    expect(row(queued.id).status).toBe('processing');
    expect(getBalance(db, user.id)).toBe(49);
    close();
  });

  it('keeps the stored text bounded', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    failGeneration(db, job.id, 'w1', { code: 'c'.repeat(300), message: 'm'.repeat(5000) });
    expect(row(job.id).errorCode).toHaveLength(64);
    expect(row(job.id).errorMessage).toHaveLength(500);
    close();
  });

  it('refunds the user who paid, not anybody else', () => {
    const { db, user, close } = setup();
    const other = seedUser(db, { creditBalance: 9 });
    const job = queue(db, user, { cost: 3 });
    claimNextJob(db, 'w1', LEASE, NOW);
    failGeneration(db, job.id, 'w1', { code: 'a', message: 'b' });
    expect(getBalance(db, user.id)).toBe(50);
    expect(getBalance(db, other.id)).toBe(9);
    close();
  });
});

describe('markCanceled', () => {
  it('cancels a queued job and refunds it', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user, { cost: 4 });
    expect(markCanceled(db, user.id, job.id)).toBe(true);
    expect(row(job.id)).toMatchObject({ status: 'canceled', leaseUntil: null });
    expect(row(job.id).finishedAt).toBeGreaterThan(0);
    expect(getBalance(db, user.id)).toBe(50);
    close();
  });

  it('cancels a processing job and refunds it; the worker then loses every race', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { cost: 4 });
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(markCanceled(db, user.id, job.id)).toBe(true);
    expect(extendLease(db, job.id, 'w1', LEASE, NOW)).toBe(false);
    expect(completeGeneration(db, job.id, 'w1', [persisted()])).toBe(false);
    expect(failGeneration(db, job.id, 'w1', { code: 'a', message: 'b' })).toBe(false);
    expect(getBalance(db, user.id)).toBe(50);
    expectConsistentLedger(db, user.id, 50);
    close();
  });

  it("only cancels the owner's generation", () => {
    const { db, user, close, row } = setup();
    const other = seedUser(db);
    const job = queue(db, user);
    expect(markCanceled(db, other.id, job.id)).toBe(false);
    expect(row(job.id).status).toBe('queued');
    expect(getBalance(db, user.id)).toBe(49);
    close();
  });

  it('is final and refunds once', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    expect(markCanceled(db, user.id, job.id)).toBe(true);
    expect(markCanceled(db, user.id, job.id)).toBe(false);
    expect(getBalance(db, user.id)).toBe(50);
    close();
  });
});

describe('terminal states are final', () => {
  it.each(['succeeded', 'failed', 'canceled'] as const)(
    'no transition leaves %s or touches the ledger',
    (status) => {
      const { db, user, close, row } = setup();
      const job = createGeneration(db, {
        userId: user.id,
        status,
        workerId: 'w1',
        leaseUntil: NOW + LEASE,
      });
      const before = ledgerInOrder(db, user.id);
      expect(claimNextJob(db, 'w2', LEASE, NOW + 10 * LEASE)).toBeNull();
      expect(extendLease(db, job.id, 'w1', LEASE, NOW)).toBe(false);
      expect(recordSubmitted(db, job.id, 'w1', 'p')).toBe(false);
      expect(completeGeneration(db, job.id, 'w1', [persisted()])).toBe(false);
      expect(failGeneration(db, job.id, 'w1', { code: 'a', message: 'b' })).toBe(false);
      expect(failGeneration(db, job.id, null, { code: 'a', message: 'b' })).toBe(false);
      expect(markCanceled(db, user.id, job.id)).toBe(false);
      expect(releaseJob(db, job.id, 'w1')).toBe(false);
      expect(requeueStale(db, NOW + 10 * LEASE)).toBe(0);
      updateProgress(db, job.id, 'w1', 90);
      expect(row(job.id)).toMatchObject({ status, progress: 0 });
      expect(ledgerInOrder(db, user.id)).toEqual(before);
      close();
    },
  );
});

describe('releaseJob', () => {
  it('returns the job to the queue without burning an attempt and keeps the provider job', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    recordSubmitted(db, job.id, 'w1', 'prov_9', { v: 1 });
    expect(releaseJob(db, job.id, 'w1')).toBe(true);
    expect(row(job.id)).toMatchObject({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      attempts: 0,
      providerJobId: 'prov_9',
      providerMeta: { v: 1 },
    });
    expect(claimNextJob(db, 'w2', LEASE, NOW)).toMatchObject({ id: job.id, attempts: 1 });
    close();
  });

  it('only releases a job its worker still owns', () => {
    const { db, user, close } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(releaseJob(db, job.id, 'w2')).toBe(false);
    close();
  });
});

describe('requeueStale', () => {
  it('puts a job with an expired lease back in the queue and clears its worker', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    recordSubmitted(db, job.id, 'w1', 'prov_1', { k: 1 });
    updateProgress(db, job.id, 'w1', 45);

    expect(requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3 })).toBe(1);
    expect(row(job.id)).toMatchObject({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      providerJobId: 'prov_1',
      providerMeta: { k: 1 },
      progress: 45,
      attempts: 1,
    });
    expect(getBalance(db, user.id)).toBe(49);
    close();
  });

  it('leaves live leases, queued jobs and finished jobs alone', () => {
    const { db, user, close, row } = setup();
    const live = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    const waiting = queue(db, user);
    expect(requeueStale(db, NOW + LEASE - 1, { maxAttempts: 3 })).toBe(0);
    expect(row(live.id).status).toBe('processing');
    expect(row(waiting.id).status).toBe('queued');
    close();
  });

  it('fails a job that keeps losing its worker once the attempts are used up, with a refund', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user, { cost: 6 });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const at = NOW + attempt * 10 * LEASE;
      expect(claimNextJob(db, `w${attempt}`, LEASE, at, { maxAttempts: 3 })).not.toBeNull();
      requeueStale(db, at + LEASE + 1, { maxAttempts: 3 });
    }
    expect(row(job.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      errorCode: INTERRUPTED_FAILURE.code,
      errorMessage: INTERRUPTED_FAILURE.message,
    });
    expect(getBalance(db, user.id)).toBe(50);
    expectConsistentLedger(db, user.id, 50);
    close();
  });

  it('handles many stale jobs in one pass and reports how many it touched', () => {
    const { db, user, close } = setup();
    for (let index = 0; index < 5; index += 1) queue(db, user);
    for (let index = 0; index < 5; index += 1) claimNextJob(db, 'w1', LEASE, NOW);
    expect(requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3 })).toBe(5);
    expect(requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3 })).toBe(0);
    close();
  });
});

describe('credit accounting across a whole life', () => {
  it('keeps the ledger consistent through success, failure, cancel and a crash', () => {
    const { db, user, close } = setup(100);
    const ok = queue(db, user, { cost: 3 });
    const bad = queue(db, user, { cost: 5 });
    const gone = queue(db, user, { cost: 7 });
    const crashed = queue(db, user, { cost: 11 });

    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w1', LEASE, NOW);
    completeGeneration(db, ok.id, 'w1', [persisted()]);
    failGeneration(db, bad.id, 'w1', { code: 'unavailable', message: 'x' });
    markCanceled(db, user.id, gone.id);
    expect(getBalance(db, user.id)).toBe(100 - 3 - 11);

    requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3 });
    expect(claimNextJob(db, 'w2', LEASE, NOW + LEASE + 2)?.id).toBe(crashed.id);
    completeGeneration(db, crashed.id, 'w2', [persisted()]);
    expect(getBalance(db, user.id)).toBe(100 - 3 - 11);
    expectConsistentLedger(db, user.id, 100);
    close();
  });
});

describe('releaseWorkerJobs', () => {
  it('hands back everything one worker owns and nothing else', () => {
    const { db, user, close, row } = setup();
    const mine = [queue(db, user), queue(db, user)];
    const theirs = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w2', LEASE, NOW);
    recordSubmitted(db, mine[0]?.id ?? '', 'w1', 'prov_1', { v: 1 });
    const queued = queue(db, user);

    expect(releaseWorkerJobs(db, 'w1')).toBe(2);
    for (const job of mine) {
      expect(row(job.id)).toMatchObject({
        status: 'queued',
        workerId: null,
        leaseUntil: null,
        attempts: 0,
      });
    }
    expect(row(mine[0]?.id ?? '').providerJobId).toBe('prov_1');
    expect(row(theirs.id)).toMatchObject({ status: 'processing', workerId: 'w2' });
    expect(row(queued.id).status).toBe('queued');
    expect(releaseWorkerJobs(db, 'w1')).toBe(0);
    close();
  });

  it('leaves finished jobs alone', () => {
    const { db, user, close, row } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    completeGeneration(db, job.id, 'w1', [persisted()]);
    expect(releaseWorkerJobs(db, 'w1')).toBe(0);
    expect(row(job.id).status).toBe('succeeded');
    close();
  });

  it('takes several worker ids at once (a runner has one per claim), and none is fine', () => {
    const { db, user, close, row } = setup();
    const [a, b, c] = [queue(db, user), queue(db, user), queue(db, user)];
    claimNextJob(db, 'w1/1', LEASE, NOW);
    claimNextJob(db, 'w1/2', LEASE, NOW);
    claimNextJob(db, 'w2/1', LEASE, NOW);
    expect(releaseWorkerJobs(db, [])).toBe(0);
    expect(releaseWorkerJobs(db, ['w1/1', 'w1/2', 'never-used'])).toBe(2);
    expect([a, b].map((job) => row(job.id).status)).toEqual(['queued', 'queued']);
    expect(row(c.id)).toMatchObject({ status: 'processing', workerId: 'w2/1' });
    close();
  });
});

describe('an idle poll does not take the write lock', () => {
  it('claimNextJob and requeueStale answer "nothing to do" while another connection holds the lock', () => {
    const test = createTestDb({ file: true });
    const other = createDb(test.path);
    try {
      test.db.$client.pragma('busy_timeout = 0');
      other.$client.exec('BEGIN IMMEDIATE');
      // A write transaction would fail at once with SQLITE_BUSY here.
      expect(claimNextJob(test.db, 'w1', LEASE, NOW)).toBeNull();
      expect(requeueStale(test.db, NOW)).toBe(0);
    } finally {
      other.$client.exec('ROLLBACK');
      other.$client.close();
      test.close();
    }
  });

  it('still takes the lock, and waits for it, when there is work', () => {
    const test = createTestDb({ file: true });
    const user = seedUser(test.db);
    queue(test.db, user);
    const other = createDb(test.path);
    try {
      test.db.$client.pragma('busy_timeout = 0');
      other.$client.exec('BEGIN IMMEDIATE');
      expect(() => claimNextJob(test.db, 'w1', LEASE, NOW)).toThrow(/database is locked/);
    } finally {
      other.$client.exec('ROLLBACK');
      other.$client.close();
      test.close();
    }
  });
});
