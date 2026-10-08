import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { markCanceled } from '@/server/generations/lifecycle';
import { createGeneration } from '@/server/generations/service';
import { JobRunner } from '@/server/jobs/runner';
import { wakeWorkers } from '@/server/jobs/wake';
import { createJobRunner } from '@/server/jobs/worker';
import { createLogger } from '@/server/logger';
import { ProviderError } from '@/server/providers/errors';
import { setProviderOverrides } from '@/server/providers/registry';
import { freshDb } from '../../helpers/db';
import { createUser, fakeProvider, fakeStorage, tinyOutput } from '../../helpers/factories';
import {
  createClock,
  createHarness,
  deferred,
  fakePersist,
  settle,
  type Harness,
  type HarnessOptions,
} from './support';

const open: Harness[] = [];
const runners: JobRunner[] = [];

function harness(options?: HarnessOptions): Harness {
  const created = createHarness(options);
  open.push(created);
  runners.push(created.runner);
  return created;
}

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()));
  for (const item of open.splice(0)) item.close();
  setProviderOverrides(null);
});

/** A provider whose submit() blocks until the test lets it go, tracking how many run at once. */
function gatedProvider() {
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  const state = { active: 0, peak: 0 };
  const provider = fakeProvider({
    submit: async (input) => {
      state.active += 1;
      state.peak = Math.max(state.peak, state.active);
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
      state.active -= 1;
      return { mode: 'sync', outputs: [tinyOutput(input.model.kind)] };
    },
  });
  return { provider, gates, state };
}

describe('tick', () => {
  it('claims nothing and reports zero when the queue is empty', async () => {
    const h = harness();
    expect(await h.runner.tick()).toBe(0);
  });

  it('runs the oldest jobs first and reports how many it finished', async () => {
    const h = harness();
    const jobs = [0, 1, 2].map((offset) => h.enqueue({ createdAt: 1_000 + offset }));
    expect(await h.runner.tick()).toBe(2);
    const statuses = jobs.map((job) => h.row(job.id).status);
    expect(statuses).toEqual(['succeeded', 'succeeded', 'queued']);
    expect(await h.runner.tick()).toBe(1);
    expect(h.row(jobs[2]?.id ?? '').status).toBe('succeeded');
  });

  it('never runs more jobs at once than WORKER_CONCURRENCY', async () => {
    const { provider, gates, state } = gatedProvider();
    const h = harness({ provider, env: { WORKER_CONCURRENCY: '3' } });
    for (let index = 0; index < 8; index += 1) h.enqueue();

    const first = h.runner.tick();
    await settle();
    expect(state.active).toBe(3);
    // A second pass has no free slot, so it claims nothing while the first three are busy.
    expect(await h.runner.tick()).toBe(0);
    gates.forEach((gate) => gate.resolve());
    expect(await first).toBe(3);
    expect(state.peak).toBe(3);
  });

  it('reports the failure of a job without throwing and keeps the other jobs going', async () => {
    let calls = 0;
    const h = harness({
      provider: fakeProvider({
        submit: (input) => {
          calls += 1;
          if (calls === 1) throw new ProviderError('invalid_input', 'bad');
          return { mode: 'sync', outputs: [tinyOutput(input.model.kind)] };
        },
      }),
    });
    const [bad, good] = [h.enqueue({ createdAt: 1 }), h.enqueue({ createdAt: 2 })];
    expect(await h.runner.tick()).toBe(2);
    expect(h.row(bad.id).status).toBe('failed');
    expect(h.row(good.id).status).toBe('succeeded');
  });

  it('ignores generations that are canceled or finished', async () => {
    const h = harness();
    const job = h.enqueue();
    markCanceled(h.db, h.user.id, job.id);
    h.enqueue({ status: 'succeeded' });
    expect(await h.runner.tick()).toBe(0);
    expect(h.provider.submit).not.toHaveBeenCalled();
  });
});

const service = freshDb();

describe('the claim loop', () => {
  it('picks up work that is already waiting when it starts', async () => {
    const h = harness();
    const job = h.enqueue();
    h.runner.start();
    await h.clock.advance(100);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('wake() finds new work at once instead of waiting for the idle interval', async () => {
    const h = harness();
    h.runner.start();
    await settle();
    const job = h.enqueue();
    // The loop is asleep for the idle interval; only wake() can get to the job before it ends.
    expect(h.clock.pending()).toContain(1000);
    h.runner.wake();
    await settle(12);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('finds new work after the idle interval even if nobody wakes it (external workers)', async () => {
    const h = harness();
    h.runner.start();
    await settle();
    const job = h.enqueue();
    expect(h.row(job.id).status).toBe('queued');
    await h.clock.advance(1000);
    await settle(12);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('is woken by the generation service through the shared wake registry', async () => {
    const clock = createClock();
    const provider = fakeProvider();
    const runner = new JobRunner({
      db: getDb(),
      storage: fakeStorage(),
      providers: { getProvider: () => provider },
      env: getEnv(),
      log: createLogger({ level: 'silent' }),
      now: clock.now,
      sleep: clock.sleep,
      persistOutput: fakePersist(),
    });
    runners.push(runner);
    const user = createUser(service.db);
    runner.start();
    await settle();
    const { generation } = await createGeneration(user.id, {
      tool: 'text-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'a calm sea',
    });
    await settle(15);
    expect(
      service.db.$client.prepare('select status from generations where id = ?').get(generation.id),
    ).toEqual({
      status: 'succeeded',
    });
    await runner.stop();
    wakeWorkers();
  });

  it('start() twice does not run two loops', async () => {
    const h = harness();
    h.runner.start();
    h.runner.start();
    await settle();
    expect(h.clock.pending().filter((ms) => ms === 1000)).toHaveLength(1);
  });

  it('keeps going after a failed claim and logs it', async () => {
    const h = harness();
    const job = h.enqueue();
    vi.spyOn(h.db, 'transaction').mockImplementationOnce(() => {
      throw new Error('database is locked');
    });
    h.runner.start();
    await settle();
    expect(
      h.logs.lines.some((line) => line.level === 'error' && line.msg === 'Could not claim jobs'),
    ).toBe(true);
    await h.clock.advance(1000);
    await settle(12);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('refills a slot as soon as a job ends', async () => {
    const { provider, gates } = gatedProvider();
    const h = harness({ provider, env: { WORKER_CONCURRENCY: '1' } });
    const [a, b] = [h.enqueue({ createdAt: 1 }), h.enqueue({ createdAt: 2 })];
    h.runner.start();
    await settle();
    expect(h.row(a.id).status).toBe('processing');
    expect(h.row(b.id).status).toBe('queued');
    gates[0]?.resolve();
    await settle(15);
    expect(h.row(a.id).status).toBe('succeeded');
    expect(h.row(b.id).status).toBe('processing');
    gates[1]?.resolve();
    await settle(15);
    expect(h.row(b.id).status).toBe('succeeded');
  });

  it('gives every runner its own worker id', () => {
    const h = harness();
    const other = h.another();
    expect(h.runner.workerId).toMatch(/^worker-\d+-[0-9a-f]{8}$/);
    expect(other.workerId).not.toBe(h.runner.workerId);
  });

  it('runs two runners over one database without running a job twice', async () => {
    const h = harness();
    const second = h.another();
    runners.push(second);
    for (let index = 0; index < 6; index += 1) h.enqueue({ createdAt: index });
    const [a, b] = await Promise.all([h.runner.tick(), second.tick()]);
    expect(a + b).toBe(4);
    expect(h.provider.submit).toHaveBeenCalledTimes(4);
    const [c, d] = await Promise.all([h.runner.tick(), second.tick()]);
    expect(c + d).toBe(2);
    expect(h.provider.submit).toHaveBeenCalledTimes(6);
  });
});

describe('abandon', () => {
  it('hands every running job back at once, for a process that is exiting', async () => {
    const { provider, gates } = gatedProvider();
    const h = harness({ provider });
    const [a, b] = [h.enqueue({ createdAt: 1 }), h.enqueue({ createdAt: 2 })];
    h.enqueue({ createdAt: 3, status: 'succeeded' });
    void h.runner.tick();
    await settle();
    expect([a, b].map((job) => h.row(job.id).status)).toEqual(['processing', 'processing']);

    expect(h.runner.abandon()).toBe(2);
    for (const job of [a, b]) {
      expect(h.row(job.id)).toMatchObject({ status: 'queued', workerId: null, attempts: 0 });
    }
    expect(h.runner.abandon()).toBe(0);
    // The next worker picks them straight up.
    const next = h.another({ providers: { getProvider: () => fakeProvider() } });
    expect(await next.tick()).toBe(2);
    expect([a, b].map((job) => h.row(job.id).status)).toEqual(['succeeded', 'succeeded']);

    // What the first runner was doing when it was abandoned changes nothing any more.
    gates.forEach((gate) => gate.resolve());
    await settle();
    expect([a, b].map((job) => h.row(job.id).status)).toEqual(['succeeded', 'succeeded']);
    // Two paid jobs ran, and the finished third one was paid for earlier: three credits spent.
    expect(h.balance()).toBe(47);
  });
});

describe('stop', () => {
  it('resolves at once when idle and can be called repeatedly', async () => {
    const h = harness();
    h.runner.start();
    await settle();
    await h.runner.stop();
    await h.runner.stop();
    expect(h.clock.pending()).toEqual([]);
  });

  it('is fine to stop a runner that never started', async () => {
    const h = harness();
    await expect(h.runner.stop()).resolves.toBeUndefined();
  });

  it('claims nothing any more once stopped, even through wake()', async () => {
    const h = harness();
    h.runner.start();
    await settle();
    await h.runner.stop();
    const job = h.enqueue();
    h.runner.wake();
    await settle(12);
    expect(h.row(job.id).status).toBe('queued');
  });

  it('lets a running job finish when it takes less than the grace period', async () => {
    const { provider, gates } = gatedProvider();
    const h = harness({ provider });
    const job = h.enqueue();
    h.runner.start();
    await settle();
    expect(h.row(job.id).status).toBe('processing');

    const stopped = h.runner.stop();
    await h.clock.advance(2000);
    gates[0]?.resolve();
    await h.clock.runUntil(stopped);
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('hands a job back to the queue when it outlasts the grace period, and another runner resumes it', async () => {
    let polls = 0;
    const provider = fakeProvider({
      submit: () => ({ mode: 'async', providerJobId: 'remote-7', meta: { v: 1 } }),
      poll: () => {
        polls += 1;
        return polls < 3
          ? { status: 'running', progress: 20 }
          : { status: 'succeeded', outputs: [tinyOutput('image')] };
      },
    });
    const h = harness({
      provider,
      tuning: { shutdownGraceMs: 4000 },
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '600' },
    });
    const stuck = fakeProvider({
      submit: () => ({ mode: 'async', providerJobId: 'remote-7', meta: { v: 1 } }),
      poll: () => ({ status: 'running' }),
    });
    const first = h.another({ providers: { getProvider: () => stuck } });
    runners.push(first);
    const job = h.enqueue({ cost: 2 });
    first.start();
    await h.clock.advance(500);
    expect(h.row(job.id)).toMatchObject({ status: 'processing', providerJobId: 'remote-7' });

    const stopped = first.stop();
    await h.clock.runUntil(stopped);
    expect(h.row(job.id)).toMatchObject({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      providerJobId: 'remote-7',
      attempts: 0,
    });
    expect(h.balance()).toBe(48);
    expect(stuck.cancel).toBeUndefined();

    // The next worker takes over exactly where the first one stopped.
    await h.clock.runUntil(h.runner.tick());
    expect(h.row(job.id)).toMatchObject({ status: 'succeeded', attempts: 1 });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(48);
  });

  it('can be started again after stopping', async () => {
    const h = harness();
    h.runner.start();
    await settle();
    await h.runner.stop();
    h.runner.start();
    await settle();
    const job = h.enqueue();
    h.runner.wake();
    await settle(12);
    expect(h.row(job.id).status).toBe('succeeded');
  });
});

describe('createJobRunner', () => {
  it('wires the process-wide services and lets tests override any of them', () => {
    const runner = createJobRunner({ log: createLogger({ level: 'silent' }) });
    expect(runner.deps.db).toBe(getDb());
    expect(runner.deps.providers.getProvider).toBeTypeOf('function');
    const custom = fakeProvider();
    const overridden = createJobRunner({ providers: { getProvider: () => custom } });
    expect(overridden.deps.providers.getProvider('mock')).toBe(custom);
  });
});
