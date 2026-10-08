import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getBalance } from '@/server/credits';
import { generations, type GenerationRow } from '@/server/db/schema';
import {
  INTERRUPTED_FAILURE,
  SUBMIT_INTERRUPTED_FAILURE,
  claimNextJob,
  clearSubmitStarted,
  completeGeneration,
  failGeneration,
  isIndeterminateSubmit,
  markCanceled,
  markSubmitStarted,
  recordSubmitted,
  releaseJob,
  requeueStale,
} from '@/server/generations/lifecycle';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createTestDb, seedUser } from '../../helpers/db';
import { persisted, queue } from './support';

/*
 * The "submit started" marker (generations.submit_started_at): set in a compare-and-set right
 * before provider.submit, cleared by the statement that stores the provider job id. A paid job that
 * is found with the marker and no job id is indeterminate: failed as `interrupted` with a full
 * refund when it is claimed or requeued, never handed to a worker.
 */

const LEASE = 60_000;
const NOW = 1_700_000_000_000;
const PAID = { provider: 'fal', modelId: 'fal-flux-schnell' } as const;

function setup(balance = 50) {
  const test = createTestDb();
  const user = seedUser(test.db, { creditBalance: balance });
  const row = (id: string): GenerationRow =>
    test.db.select().from(generations).where(eq(generations.id, id)).get() as GenerationRow;
  /** A paid job claimed by `worker` whose submit has started. */
  const submitting = (worker = 'w1', overrides: Parameters<typeof queue>[2] = {}) => {
    const job = queue(test.db, user, { ...PAID, cost: 2, ...overrides });
    claimNextJob(test.db, worker, LEASE, NOW, { excludeIds: [] });
    expect(markSubmitStarted(test.db, job.id, worker, NOW + 5)).toBe(true);
    return job;
  };
  return { ...test, user, row, submitting };
}

describe('markSubmitStarted', () => {
  it('stamps the row for the worker that owns the job', () => {
    const { db, user, row, close } = setup();
    const job = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(row(job.id).submitStartedAt).toBeNull();
    expect(markSubmitStarted(db, job.id, 'w1', NOW + 7)).toBe(true);
    expect(row(job.id).submitStartedAt).toBe(NOW + 7);
    close();
  });

  it('refuses another worker, a queued job, a final job and one that already has a job id', () => {
    const { db, user, row, close } = setup();
    const queued = queue(db, user);
    expect(markSubmitStarted(db, queued.id, 'w1', NOW)).toBe(false); // not claimed yet

    const claimed = queue(db, user);
    claimNextJob(db, 'w1', LEASE, NOW);
    claimNextJob(db, 'w1', LEASE, NOW);
    expect(markSubmitStarted(db, claimed.id, 'someone-else', NOW)).toBe(false);

    expect(recordSubmitted(db, claimed.id, 'w1', 'remote-1', { v: 1 })).toBe(true);
    expect(markSubmitStarted(db, claimed.id, 'w1', NOW)).toBe(false); // already submitted

    markCanceled(db, user.id, queued.id);
    expect(markSubmitStarted(db, queued.id, 'w1', NOW)).toBe(false);
    expect(row(queued.id).submitStartedAt).toBeNull();
    close();
  });
});

describe('where the marker goes away', () => {
  it('recordSubmitted clears it in the same statement that stores the job id', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting();
    expect(row(job.id).submitStartedAt).not.toBeNull();
    expect(recordSubmitted(db, job.id, 'w1', 'remote-1', { v: 1 })).toBe(true);
    expect(row(job.id)).toMatchObject({ providerJobId: 'remote-1', submitStartedAt: null });
    close();
  });

  it('clearSubmitStarted takes it back for the owner only, and not once a job id exists', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting();
    expect(clearSubmitStarted(db, job.id, 'intruder')).toBe(false);
    expect(row(job.id).submitStartedAt).not.toBeNull();
    expect(clearSubmitStarted(db, job.id, 'w1')).toBe(true);
    expect(row(job.id).submitStartedAt).toBeNull();
    close();
  });

  it('completion, failure and cancellation clear it too: a final row carries no marker', () => {
    const { db, user, row, close, submitting } = setup();
    const synced = submitting('w1');
    expect(completeGeneration(db, synced.id, 'w1', [persisted(0)])).toBe(true);

    const failed = submitting('w2');
    expect(failGeneration(db, failed.id, 'w2', { code: 'unavailable', message: 'x' })).toBe(true);

    const canceled = submitting('w3');
    expect(markCanceled(db, user.id, canceled.id)).toBe(true);

    for (const job of [synced, failed, canceled]) {
      expect(row(job.id).submitStartedAt, job.id).toBeNull();
    }
    close();
  });

  it('a released job keeps it: whether the submit got through is still unknown', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting('w1');
    expect(releaseJob(db, job.id, 'w1')).toBe(true);
    expect(row(job.id)).toMatchObject({ status: 'queued', providerJobId: null });
    expect(row(job.id).submitStartedAt).not.toBeNull();
    close();
  });
});

describe('isIndeterminateSubmit', () => {
  const base = { provider: 'fal', submitStartedAt: NOW, providerJobId: null } as const;

  it.each([
    ['a paid provider, marker set, no job id', base, true],
    ['the Demo provider may simply run again', { ...base, provider: 'mock' }, false],
    ['no marker: the submit never started', { ...base, submitStartedAt: null }, false],
    ['a job id is on record: resume by polling', { ...base, providerJobId: 'remote-1' }, false],
    ['openai counts as paid', { ...base, provider: 'openai' }, true],
    ['replicate counts as paid', { ...base, provider: 'replicate' }, true],
  ] as const)('%s', (_name, row, expected) => {
    expect(isIndeterminateSubmit(row)).toBe(expected);
  });
});

describe('claimNextJob and an indeterminate job', () => {
  it('fails a queued one (released at shutdown) with a full refund instead of handing it out', () => {
    const { db, user, row, close, submitting } = setup();
    const job = submitting('w1');
    releaseJob(db, job.id, 'w1');
    expect(getBalance(db, user.id)).toBe(48);

    expect(claimNextJob(db, 'w2', LEASE, NOW + 1_000)).toBeNull();
    expect(row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: SUBMIT_INTERRUPTED_FAILURE.code,
      errorMessage: SUBMIT_INTERRUPTED_FAILURE.message,
      workerId: null,
      attempts: 0, // releasing it handed the attempt back, and the failing claim added none
    });
    expect(getBalance(db, user.id)).toBe(50);
    expectConsistentLedger(db, user.id, 50);
    close();
  });

  it('also catches an expired processing job when a worker claims without requeueing first', () => {
    const { db, user, row, close, submitting } = setup();
    const job = submitting('w1'); // lease runs out at NOW + LEASE
    expect(claimNextJob(db, 'w2', LEASE, NOW + LEASE + 1)).toBeNull();
    expect(row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(getBalance(db, user.id)).toBe(50);
    close();
  });

  it('then goes on to the next job in the same call', () => {
    const { db, user, row, close, submitting } = setup();
    const doomed = submitting('w1');
    releaseJob(db, doomed.id, 'w1');
    const healthy = queue(db, user, { createdAt: NOW + 10 });

    const claimed = claimNextJob(db, 'w2', LEASE, NOW + 1_000);
    expect(claimed?.id).toBe(healthy.id);
    expect(row(doomed.id).status).toBe('failed');
    close();
  });

  it('leaves the Demo provider alone: it is claimed and may submit again', () => {
    const { db, user, close } = setup();
    const job = queue(db, user, { provider: 'mock' });
    claimNextJob(db, 'w1', LEASE, NOW);
    markSubmitStarted(db, job.id, 'w1', NOW);
    releaseJob(db, job.id, 'w1');
    expect(claimNextJob(db, 'w2', LEASE, NOW + 1_000)?.id).toBe(job.id);
    close();
  });

  it('does not touch a paid job whose job id is on record', () => {
    const { db, user, close, submitting } = setup();
    const job = submitting('w1');
    recordSubmitted(db, job.id, 'w1', 'remote-1', { v: 1 });
    releaseJob(db, job.id, 'w1');
    expect(claimNextJob(db, 'w2', LEASE, NOW + 1_000)?.id).toBe(job.id);
    expect(getBalance(db, user.id)).toBe(48);
    close();
  });
});

describe('requeueStale and an indeterminate job', () => {
  it('fails the expired paid job and refunds it, instead of putting it back in the queue', () => {
    const { db, user, row, close, submitting } = setup();
    const job = submitting('w1');
    expect(requeueStale(db, NOW + LEASE + 1)).toBe(1);
    expect(row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(ledgerInOrder(db, user.id).map((entry) => [entry.reason, entry.delta])).toEqual([
      ['generation', -2],
      ['refund', 2],
    ]);
    expectConsistentLedger(db, user.id, 50);
    close();
  });

  it('beats the attempt limit: the reason is the sharper one', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting('w1');
    db.update(generations).set({ attempts: 3 }).where(eq(generations.id, job.id)).run();
    requeueStale(db, NOW + LEASE + 1, { maxAttempts: 3 });
    expect(row(job.id).errorCode).toBe('interrupted');
    expect(row(job.id).errorCode).not.toBe(INTERRUPTED_FAILURE.code);
    close();
  });

  it('requeues everything else as before, and counts only what it touched', () => {
    const { db, user, row, close, submitting } = setup();
    const doomed = submitting('w1');
    const plain = queue(db, user, PAID);
    claimNextJob(db, 'w2', LEASE, NOW); // claims `plain`, no submit started
    const submitted = queue(db, user, PAID);
    claimNextJob(db, 'w3', LEASE, NOW);
    recordSubmitted(db, submitted.id, 'w3', 'remote-9', { v: 1 });

    expect(requeueStale(db, NOW + LEASE + 1)).toBe(3);
    expect(row(doomed.id).status).toBe('failed');
    expect(row(plain.id)).toMatchObject({ status: 'queued', workerId: null });
    expect(row(submitted.id)).toMatchObject({ status: 'queued', providerJobId: 'remote-9' });
    close();
  });

  it('spares the jobs the caller is still running itself (excludeIds)', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting('w1');
    expect(requeueStale(db, NOW + LEASE + 1, { excludeIds: [job.id] })).toBe(0);
    expect(row(job.id).status).toBe('processing');
    close();
  });

  it('does nothing before the lease has expired', () => {
    const { db, row, close, submitting } = setup();
    const job = submitting('w1');
    expect(requeueStale(db, NOW + LEASE - 1)).toBe(0);
    expect(row(job.id).status).toBe('processing');
    close();
  });
});
