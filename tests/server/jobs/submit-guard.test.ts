import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderError } from '@/server/providers/errors';
import type { ProviderContext, SubmitResult } from '@/server/providers/types';
import { markCanceled } from '@/server/generations/lifecycle';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { TINY_PNG, fakeProvider } from '../../helpers/fakes';
import { createClock, createHarness, settle, type Harness, type HarnessOptions } from './support';

/*
 * fal has no idempotency key. If a worker dies after `provider.submit` reached the provider but
 * before the provider's job id was stored, re-submitting on resume would create a second paid
 * upstream request. The engine marks the row BEFORE it submits; a paid provider's job that is
 * found with the marker and no job id is indeterminate and is failed with `interrupted` and a full
 * refund, never submitted again. The Demo provider costs nothing and may simply run again.
 */

const open: Harness[] = [];
afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

function harness(options?: HarnessOptions): Harness {
  const created = createHarness(options);
  open.push(created);
  return created;
}

const PAID = { provider: 'fal', modelId: 'fal-flux-schnell' } as const;
const FREE = { provider: 'mock', modelId: 'aivore-demo-image' } as const;

const done = {
  status: 'succeeded' as const,
  outputs: [
    { kind: 'image' as const, bytes: TINY_PNG, mimeType: 'image/png', width: 1, height: 1 },
  ],
};
const never = () => new Promise<SubmitResult>(() => undefined);

/**
 * Two runners over one database with clocks of their own, because a crashed worker's clock (and
 * with it its heartbeat) stops while the world moves on: B comes up `lateMs` after A's lease began.
 */
function twoWorkers(h: Harness) {
  const crashed = createClock(h.clock.now());
  const survivor = createClock(h.clock.now());
  return {
    a: h.another({ now: crashed.now, sleep: crashed.sleep }),
    b: h.another({ now: survivor.now, sleep: survivor.sleep }),
    afterLease: () => survivor.advance(61_000),
    crashed,
    survivor,
  };
}

describe('a crash while a paid submit is in flight', () => {
  it('fails the job as interrupted, refunds it in full and never submits a second time', async () => {
    const h = harness({ provider: fakeProvider({ submit: never }) });
    const { a, b, afterLease } = twoWorkers(h);
    const job = h.enqueue({ ...PAID, cost: 3 });
    expect(h.balance()).toBe(47);

    void a.tick(); // claims the job and calls submit, which never answers: the worker "dies" here
    await settle();
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    const inFlight = h.row(job.id);
    expect(inFlight).toMatchObject({ status: 'processing', providerJobId: null });
    expect(inFlight.submitStartedAt).not.toBeNull();

    await afterLease();
    await b.tick();

    expect(h.provider.submit).toHaveBeenCalledTimes(1); // no second, paid, request
    expect(h.row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'interrupted',
      submitStartedAt: null,
    });
    expect(h.row(job.id).errorMessage).toMatch(/interrupted/i);
    expect(h.row(job.id).errorMessage).toMatch(/refunded/i);
    expect(h.balance()).toBe(50); // credits are conserved: the whole price came back
    expectConsistentLedger(h.db, h.user.id, 50);
    expect(ledgerInOrder(h.db, h.user.id).map((entry) => [entry.reason, entry.delta])).toEqual([
      ['generation', -3],
      ['refund', 3],
    ]);
  });

  it('keeps the refund single when the survivor runs again, or a third worker looks', async () => {
    const h = harness({ provider: fakeProvider({ submit: never }) });
    const { a, b, afterLease, survivor } = twoWorkers(h);
    h.enqueue({ ...PAID, cost: 2 });
    void a.tick();
    await settle();
    await afterLease();
    await b.tick();
    await survivor.advance(120_000);
    await b.tick();
    await h.another({ now: survivor.now, sleep: survivor.sleep }).tick();

    expect(h.balance()).toBe(50);
    expect(
      ledgerInOrder(h.db, h.user.id).filter((entry) => entry.reason === 'refund'),
    ).toHaveLength(1);
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
  });

  it('cancels the orphaned upstream request if the zombie worker wakes up later', async () => {
    const accepted = Promise.withResolvers<SubmitResult>();
    const cancel = vi.fn(async (_providerJobId: string) => undefined);
    const h = harness({
      provider: fakeProvider({ submit: () => accepted.promise, cancel }),
    });
    const { a, b, afterLease } = twoWorkers(h);
    const job = h.enqueue({ ...PAID, cost: 2 });
    void a.tick();
    await settle();
    await afterLease();
    await b.tick();
    expect(h.row(job.id).status).toBe('failed');

    // The "dead" worker was only frozen: its submit finally returns a provider job id.
    accepted.resolve({ mode: 'async', providerJobId: 'orphan-1', meta: { v: 1 } });
    await settle(12);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('orphan-1');
    // Nothing else changed: still one failure, one refund, no result stored.
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(h.row(job.id).providerJobId).toBeNull();
    expect(h.balance()).toBe(50);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('treats a synchronous paid provider the same way: the outcome of the call is unknown', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({
          mode: 'sync',
          outputs: [{ kind: 'image', bytes: TINY_PNG, mimeType: 'image/png', width: 1, height: 1 }],
        }),
      }),
    });
    const hang = new Promise<never>(() => undefined);
    const crashed = createClock(h.clock.now());
    const survivor = createClock(h.clock.now());
    // The worker got the picture back from the provider and died while storing it.
    const a = h.another({ now: crashed.now, sleep: crashed.sleep, persistOutput: () => hang });
    const b = h.another({ now: survivor.now, sleep: survivor.sleep });
    const job = h.enqueue({ ...PAID, cost: 2 });
    void a.tick();
    await settle();
    expect(h.provider.submit).toHaveBeenCalledTimes(1);

    await survivor.advance(61_000);
    await b.tick();
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(h.balance()).toBe(50);
  });

  it('fails before the attempt limit would, and without counting an attempt it never made', async () => {
    const h = harness({ provider: fakeProvider({ submit: never }), env: { MAX_ATTEMPTS: '1' } });
    const { a, b, afterLease } = twoWorkers(h);
    const job = h.enqueue({ ...PAID });
    void a.tick();
    await settle();
    await afterLease();
    await b.tick();
    // Attempts were already used up, which would have said "unavailable"; the sharper reason wins.
    expect(h.row(job.id).errorCode).toBe('interrupted');
  });
});

describe('a crash while the Demo provider is submitting', () => {
  it('simply submits again: the Demo provider costs nothing upstream', async () => {
    let calls = 0;
    const h = harness({
      provider: fakeProvider({
        submit: () => {
          calls += 1;
          return calls === 1 ? never() : { mode: 'sync', outputs: done.outputs };
        },
      }),
    });
    const { a, b, afterLease } = twoWorkers(h);
    const job = h.enqueue({ ...FREE, cost: 1 });
    void a.tick();
    await settle();
    expect(h.row(job.id).submitStartedAt).not.toBeNull();

    await afterLease();
    await b.tick();

    expect(h.provider.submit).toHaveBeenCalledTimes(2);
    expect(h.row(job.id)).toMatchObject({ status: 'succeeded', submitStartedAt: null });
    expect(h.balance()).toBe(49); // one debit, no refund
    expect(ledgerInOrder(h.db, h.user.id).map((entry) => entry.reason)).toEqual(['generation']);
  });
});

describe('a graceful shutdown while a paid submit is in flight', () => {
  it('hands the job back, and the next worker fails it instead of submitting again', async () => {
    const h = harness({ provider: fakeProvider({ submit: never }) });
    const job = h.enqueue({ ...PAID, cost: 2 });
    void h.runner.tick();
    await settle();
    expect(h.row(job.id).submitStartedAt).not.toBeNull();

    // The grace period runs out: running jobs are aborted and released to the queue.
    const stopping = h.runner.stop();
    await h.clock.runUntil(stopping);
    expect(h.row(job.id)).toMatchObject({ status: 'queued', workerId: null });
    expect(h.row(job.id).submitStartedAt).not.toBeNull();

    await h.another().tick();

    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(h.balance()).toBe(50);
  });

  it('lets the Demo provider run again from the queue', async () => {
    const calls = { n: 0 };
    const h = harness({
      provider: fakeProvider({
        submit: () => {
          calls.n += 1;
          return calls.n === 1 ? never() : { mode: 'sync', outputs: done.outputs };
        },
      }),
    });
    const job = h.enqueue({ ...FREE });
    void h.runner.tick();
    await settle();
    await h.clock.runUntil(h.runner.stop());
    await h.another().tick();
    expect(h.provider.submit).toHaveBeenCalledTimes(2);
    expect(h.row(job.id).status).toBe('succeeded');
  });
});

describe('the marker around a healthy submit', () => {
  it('is set before the provider is called and gone once the job id is stored', async () => {
    const seen: Array<number | null> = [];
    let jobId = '';
    const h = harness({
      provider: fakeProvider({
        submit: () => {
          seen.push(h.row(jobId).submitStartedAt);
          return { mode: 'async', providerJobId: 'job-1', meta: { v: 1 } };
        },
        poll: () => {
          seen.push(h.row(jobId).submitStartedAt);
          return done;
        },
      }),
    });
    jobId = h.enqueue({ ...PAID }).id;

    await h.runner.tick();
    expect(seen[0]).toBeGreaterThan(0); // set before submit ran
    expect(seen[1]).toBeNull(); // cleared by recordSubmitted: the job is resumable now
    expect(h.row(jobId).status).toBe('succeeded');
  });

  it('is taken back after a retryable error, so a shutdown during the back-off is harmless', async () => {
    const results: Array<SubmitResult | ProviderError> = [
      new ProviderError('unavailable', 'upstream 503', { retryable: true, httpStatus: 503 }),
      { mode: 'async', providerJobId: 'job-2', meta: { v: 1 } },
    ];
    const h = harness({
      provider: fakeProvider({
        submit: () => {
          const next = results.shift();
          if (next instanceof ProviderError) throw next;
          return next as SubmitResult;
        },
        poll: () => done,
      }),
    });
    const job = h.enqueue({ ...PAID });
    const ticking = h.runner.tick();
    await settle();
    const marker = h.row(job.id).submitStartedAt; // while the engine waits to retry
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    await h.clock.runUntil(ticking);

    expect(marker).toBeNull();
    expect(h.provider.submit).toHaveBeenCalledTimes(2);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('does not stop a job that already has a provider job id from resuming', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'async', providerJobId: 'job-3', meta: { v: 1 } }),
        poll: () => ({ status: 'running' }),
      }),
    });
    const { a, b, afterLease } = twoWorkers(h);
    const job = h.enqueue({ ...PAID, cost: 2 });
    void a.tick();
    await settle();
    expect(h.row(job.id)).toMatchObject({ providerJobId: 'job-3', submitStartedAt: null });

    await afterLease();
    h.provider.poll.mockImplementation(async () => done);
    await b.tick();

    expect(h.provider.submit).toHaveBeenCalledTimes(1); // resumed by polling, not re-submitted
    expect(h.row(job.id).status).toBe('succeeded');
    expect(h.balance()).toBe(48);
  });
});

/*
 * The provider's answer to `submit` can arrive AFTER the run was given up on, and then the order in
 * which the timers and the socket fire decides what the run knows. Node runs expired timers before
 * I/O callbacks, so a frozen worker (VM pause, long GC) or a slow request wakes up with the
 * heartbeat first: it sees that the row is no longer its own and abandons the run while the request
 * is still in flight (no provider job id is known yet, so there is nothing to cancel), and only then
 * does the response arrive. The paid upstream job that response names must still be canceled.
 */
describe('a provider answer that arrives after the run was given up', () => {
  const orphan: SubmitResult = { mode: 'async', providerJobId: 'orphan-1', meta: { v: 1 } };
  const HEARTBEAT_MS = 15_000;

  function pending() {
    const answer = Promise.withResolvers<SubmitResult>();
    const cancel = vi.fn(async (_providerJobId: string, _ctx: ProviderContext) => undefined);
    return { answer, cancel, provider: fakeProvider({ submit: () => answer.promise, cancel }) };
  }

  it('cancels the upstream job when the heartbeat saw the lost lease first', async () => {
    const { answer, cancel, provider } = pending();
    const h = harness({ provider });
    const { a, b, afterLease, crashed } = twoWorkers(h);
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = a.tick();
    await settle();
    await afterLease();
    await b.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });

    await crashed.advance(HEARTBEAT_MS + 1); // the thawed worker's heartbeat fires first ...
    await running; // ... and the run is over, with no provider job id to cancel
    expect(cancel).not.toHaveBeenCalled();
    answer.resolve(orphan); // ... then the socket delivers the answer
    await settle(12);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('orphan-1');
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'interrupted' });
    expect(h.row(job.id).providerJobId).toBeNull();
    expect(h.balance()).toBe(50);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('cancels it when the user canceled while the request was in flight', async () => {
    const { answer, cancel, provider } = pending();
    const h = harness({ provider });
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = h.runner.tick();
    await settle();
    expect(markCanceled(h.db, h.user.id, job.id)).toBe(true); // refunded in full

    await h.clock.advance(HEARTBEAT_MS + 1); // the heartbeat notices the cancel
    expect(cancel).not.toHaveBeenCalled();
    answer.resolve(orphan);
    await running;
    await settle(12);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('orphan-1');
    expect(h.row(job.id)).toMatchObject({ status: 'canceled', providerJobId: null });
    expect(h.balance()).toBe(50);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('cancels it when the deadline passed while the request was in flight', async () => {
    const { answer, cancel, provider } = pending();
    const h = harness({ provider, env: { GENERATION_TIMEOUT_SEC_IMAGE: '30' } });
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = h.runner.tick();
    await settle();
    await h.clock.advance(31_000);
    await running;
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(cancel).not.toHaveBeenCalled();

    answer.resolve(orphan);
    await settle(12);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel.mock.calls[0]?.[0]).toBe('orphan-1');
    expect(h.balance()).toBe(50);
  });

  it('cancels it after a graceful shutdown too, without waiting for the shutdown signal', async () => {
    const answer = Promise.withResolvers<SubmitResult>();
    const abortedWhenCalled: boolean[] = [];
    const cancel = vi.fn(async (_providerJobId: string, ctx: ProviderContext) => {
      abortedWhenCalled.push(ctx.signal.aborted);
    });
    const h = harness({ provider: fakeProvider({ submit: () => answer.promise, cancel }) });
    const job = h.enqueue({ ...PAID, cost: 2 });
    void h.runner.tick();
    await settle();
    await h.clock.runUntil(h.runner.stop());
    expect(h.row(job.id)).toMatchObject({ status: 'queued', workerId: null });

    answer.resolve(orphan);
    await settle(12);

    expect(cancel).toHaveBeenCalledTimes(1);
    // The runner is long stopped; the request to the provider must still get a live signal.
    expect(abortedWhenCalled).toEqual([false]);
  });

  it('has nothing to cancel when the late answer already holds the pictures', async () => {
    const answer = Promise.withResolvers<SubmitResult>();
    const cancel = vi.fn(async (_providerJobId: string) => undefined);
    const h = harness({ provider: fakeProvider({ submit: () => answer.promise, cancel }) });
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = h.runner.tick();
    await settle();
    markCanceled(h.db, h.user.id, job.id);
    await h.clock.advance(HEARTBEAT_MS + 1);

    answer.resolve({ mode: 'sync', outputs: done.outputs });
    await running;
    await settle(12);

    expect(cancel).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled(); // the pictures are dropped, not stored
    expect(h.row(job.id).status).toBe('canceled');
  });

  it('stops waiting for a cancel that never answers, and a failing one is only logged', async () => {
    const answer = Promise.withResolvers<SubmitResult>();
    const hang = vi.fn(() => new Promise<void>(() => undefined));
    const h = harness({ provider: fakeProvider({ submit: () => answer.promise, cancel: hang }) });
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = h.runner.tick();
    await settle();
    markCanceled(h.db, h.user.id, job.id);
    await h.clock.advance(HEARTBEAT_MS + 1);
    answer.resolve(orphan);
    await running;
    await settle();
    expect(hang).toHaveBeenCalledTimes(1);

    await h.clock.advance(10_001); // the time limit of an upstream cancel
    await settle();

    const warning = h.logs.lines.find((line) => line.msg === 'Could not cancel the upstream job');
    expect(warning?.level).toBe('warn');

    const failing = Promise.withResolvers<SubmitResult>();
    const fails = vi.fn(async () => {
      throw new ProviderError('unavailable', 'upstream 500', { retryable: true, httpStatus: 500 });
    });
    const g = harness({ provider: fakeProvider({ submit: () => failing.promise, cancel: fails }) });
    const second = g.enqueue({ ...PAID });
    const ticking = g.runner.tick();
    await settle();
    markCanceled(g.db, g.user.id, second.id);
    await g.clock.advance(HEARTBEAT_MS + 1);
    failing.resolve(orphan);
    await ticking;
    await settle(12);
    expect(fails).toHaveBeenCalledTimes(1);
    expect(
      g.logs.lines.filter((line) => line.msg === 'Could not cancel the upstream job'),
    ).toHaveLength(1);
  });

  it('says so when the provider cannot cancel: the job will run unseen, and nothing breaks', async () => {
    const answer = Promise.withResolvers<SubmitResult>();
    const h = harness({ provider: fakeProvider({ submit: () => answer.promise }) });
    const job = h.enqueue({ ...PAID, cost: 2 });
    const running = h.runner.tick();
    await settle();
    markCanceled(h.db, h.user.id, job.id);
    await h.clock.advance(HEARTBEAT_MS + 1);
    answer.resolve(orphan);
    await running;
    await settle(12);

    const warning = h.logs.lines.find((line) => line.msg.includes('cannot cancel it'));
    expect(warning).toMatchObject({ level: 'warn', fields: { reason: 'canceled' } });
    expect(h.row(job.id)).toMatchObject({ status: 'canceled', providerJobId: null });
    expect(h.balance()).toBe(50);
  });

  it('keeps working when the answer comes first: the normal ordering still stores the job id', async () => {
    const cancel = vi.fn(async (_providerJobId: string) => undefined);
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'async', providerJobId: 'job-9', meta: { v: 1 } }),
        poll: () => done,
        cancel,
      }),
    });
    const job = h.enqueue({ ...PAID, cost: 2 });
    await h.runner.tick();
    expect(cancel).not.toHaveBeenCalled();
    expect(h.row(job.id)).toMatchObject({ status: 'succeeded', providerJobId: 'job-9' });
  });
});
