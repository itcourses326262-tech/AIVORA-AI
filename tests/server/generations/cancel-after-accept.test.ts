import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { committedUpstreamCredits, recordUpstreamSpend } from '@/server/generations/budget';
import {
  ACCEPTED_CANCEL_NOTE,
  MAX_REFUNDED_ACCEPTED_CANCELS_PER_DAY,
  markCanceled,
} from '@/server/generations/lifecycle';
import { expectConsistentLedger } from '../../helpers/credits';
import { createTestDb, seedUser } from '../../helpers/db';
import { queue } from './support';

/*
 * Cancelling a job the paid provider already holds must not be free: the provider may bill it, so a
 * create -> wait for the provider -> cancel loop would be unlimited free upstream work at the
 * platform's expense. A job the provider never saw is refunded and releases its budget booking as
 * before; one it accepted keeps the booking, and its refund is rationed per account and day.
 */

function setup() {
  const test = createTestDb();
  const user = seedUser(test.db, { creditBalance: 500 });
  const paid = (providerJobId: string | null, submitStartedAt: number | null = null) => {
    const job = queue(test.db, user, {
      provider: 'fal',
      cost: 10,
      status: 'processing',
      providerJobId,
      submitStartedAt,
    });
    recordUpstreamSpend(test.db, {
      generationId: job.id,
      provider: 'fal',
      cost: 10,
      now: Date.now(),
    });
    return job;
  };
  // What the daily upstream budget currently counts as committed (released bookings do not count).
  const committed = () => committedUpstreamCredits(test.db);
  return { ...test, user, paid, committed };
}

describe('markCanceled after the provider accepted the job', () => {
  it('refunds in full and releases the booking when the provider never saw the job', () => {
    const { db, user, paid, committed, close } = setup();
    const job = paid(null);
    expect(getBalance(db, user.id)).toBe(490);
    expect(committed()).toBe(10);

    expect(markCanceled(db, user.id, job.id)).toBe(true);

    expect(getBalance(db, user.id)).toBe(500);
    expect(committed()).toBe(0);
    expectConsistentLedger(db, user.id, 500);
    close();
  });

  it.each([
    ['has a provider job id', () => ['job_123', null] as const],
    ['was being submitted when it was canceled', () => [null, Date.now()] as const],
  ])('keeps the budget booking when the job %s', (_label, ids) => {
    const { db, user, paid, committed, close } = setup();
    const [providerJobId, submitStartedAt] = ids();
    const job = paid(providerJobId, submitStartedAt);

    expect(markCanceled(db, user.id, job.id)).toBe(true);

    expect(committed()).toBe(10);
    expect(db.select().from(generations).where(eq(generations.id, job.id)).get()?.status).toBe(
      'canceled',
    );
    expectConsistentLedger(db, user.id, 500);
    close();
  });

  it('still refunds an occasional cancel, but rations refunds so a loop is not free', () => {
    const { db, user, paid, close } = setup();
    const allowed = MAX_REFUNDED_ACCEPTED_CANCELS_PER_DAY;

    for (let i = 0; i < allowed; i++) {
      expect(markCanceled(db, user.id, paid(`job_${i}`).id)).toBe(true);
    }
    expect(getBalance(db, user.id)).toBe(500);

    const unrefunded = paid('job_over');
    expect(getBalance(db, user.id)).toBe(490);
    expect(markCanceled(db, user.id, unrefunded.id)).toBe(true);
    // The sixth cancel inside the same day is charged: 10 credits stay spent.
    expect(getBalance(db, user.id)).toBe(490);
    expectConsistentLedger(db, user.id, 500);
    expect(ACCEPTED_CANCEL_NOTE).toMatch(/provider accepted/);
    close();
  });

  it('does not touch a job that is already final', () => {
    const { db, user, paid, close } = setup();
    const job = paid('job_done');
    expect(markCanceled(db, user.id, job.id)).toBe(true);
    const balance = getBalance(db, user.id);
    expect(markCanceled(db, user.id, job.id)).toBe(false);
    expect(getBalance(db, user.id)).toBe(balance);
    close();
  });
});
