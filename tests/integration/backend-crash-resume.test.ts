import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationDTO, LedgerEntryDTO, UserDTO } from '@/lib/api-types';
import { claimNextJob, requeueStale } from '@/server/generations/lifecycle';
import { assets, generations } from '@/server/db/schema';
import { resetEnvForTests } from '@/server/env';
import { mockProvider } from '@/server/providers/mock';
import { expectConsistentLedger, ledgerInOrder } from '../helpers/credits';
import { dataOf } from './helpers/api';
import { freezable } from './helpers/freeze';
import {
  createWorld,
  runToCompletion,
  textToImage,
  textToVideo,
  waitFor,
  type Member,
} from './helpers/world';

// A worker dying mid-job, in a process with real storage and the real Demo provider: the lease
// protects a live job, an expired one is picked up exactly once, the provider job is resumed
// instead of submitted again, and the user is charged once and refunded at most once.

vi.setConfig({ testTimeout: 60_000 });

const world = createWorld();
const LEASE_MS = 60_000;

const rowOf = (id: string) =>
  world.db.select().from(generations).where(eq(generations.id, id)).get();

const reasonsOf = (member: Member) =>
  ledgerInOrder(world.db, member.user.id).map((entry) => entry.reason);

const balanceOf = async (member: Member) =>
  dataOf(await member.get<UserDTO>('/auth/me')).creditBalance;

const outputRows = (id: string) =>
  world.db.select().from(assets).where(eq(assets.generationId, id)).all();

async function queued(member: Member, prompt = 'a lake at dawn'): Promise<GenerationDTO> {
  return dataOf(
    await member.post<GenerationDTO>('/generations', textToImage(prompt, { params: { seed: 5 } })),
    201,
  );
}

describe('a worker that dies after submitting to the provider', () => {
  it('keeps its job safe while the lease lasts, then a new worker resumes it exactly once', async () => {
    const alice = await world.signUp('Alice');
    const submit = vi.spyOn(mockProvider, 'submit');
    const frozen = freezable(world.time);
    const first = world.runner({ sleep: frozen.sleep });
    const second = world.runner();

    const created = await queued(alice);
    const stuck = first.tick(); // claims the job, submits it, then freezes at its first wait
    try {
      const submitted = await waitFor('the first worker to submit the job', () => {
        const row = rowOf(created.id);
        return row?.status === 'processing' && row.providerJobId ? row : undefined;
      });
      expect(submitted.attempts).toBe(1);
      expect(submitted.progress).toBeGreaterThanOrEqual(10); // the first poll may already have moved it
      expect(submitted.workerId).toContain(first.workerId);
      expect(submit).toHaveBeenCalledTimes(1);

      // The first worker is silent but its lease is valid: nobody else touches the job.
      expect(await second.tick()).toBe(0);
      expect(requeueStale(world.db)).toBe(0);
      expect(rowOf(created.id)).toMatchObject({
        status: 'processing',
        workerId: submitted.workerId,
      });
      expect(await balanceOf(alice)).toBe(49);

      // The lease runs out. Recovery hands the job back, keeping what the provider was told.
      world.time.skip(LEASE_MS + 1_000);
      expect(requeueStale(world.db)).toBe(1);
      expect(rowOf(created.id)).toMatchObject({
        status: 'queued',
        workerId: null,
        attempts: 1,
        providerJobId: submitted.providerJobId,
      });
      expect(dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`)).status).toBe(
        'queued',
      );

      // A new worker resumes polling the same provider job and finishes it.
      const done = await runToCompletion(alice, created.id, second);
      expect(done).toMatchObject({ status: 'succeeded', progress: 100 });
      expect(rowOf(created.id)).toMatchObject({
        attempts: 2,
        providerJobId: submitted.providerJobId,
        providerMeta: submitted.providerMeta,
      });
      expect(submit).toHaveBeenCalledTimes(1); // resumed, not submitted again
      expect(outputRows(created.id)).toHaveLength(1);
      expect(world.storedFiles()).toHaveLength(2);
      expect(await balanceOf(alice)).toBe(49);
      expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);

      // The frozen worker comes back to life. It finds the job is no longer its own and leaves
      // everything as it was: no second result, no refund, no deleted files.
      frozen.thaw();
      await stuck;
      expect(dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`))).toEqual(done);
      expect(outputRows(created.id)).toHaveLength(1);
      expect(world.storedFiles()).toHaveLength(2);
      expect((await alice.media(done.outputs[0]?.url ?? '')).status).toBe(200);
      expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);
      expect(submit).toHaveBeenCalledTimes(1);
      expectConsistentLedger(world.db, alice.user.id, 0);
    } finally {
      frozen.thaw();
    }
  });

  it('hands the job back at once when the process exits (abandon), and the next worker finishes it', async () => {
    const alice = await world.signUp('Alice');
    const frozen = freezable(world.time);
    const dying = world.runner({ sleep: frozen.sleep });
    const next = world.runner();
    const created = await queued(alice);
    const stuck = dying.tick();
    try {
      await waitFor('the job to be submitted', () =>
        rowOf(created.id)?.providerJobId ? true : undefined,
      );

      // `process.on('exit')` calls this: no waiting for the lease.
      expect(dying.abandon()).toBe(1);
      expect(rowOf(created.id)).toMatchObject({ status: 'queued', workerId: null });

      const done = await runToCompletion(alice, created.id, next);
      expect(done.status).toBe('succeeded');
      expect(await balanceOf(alice)).toBe(49);
      expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);
    } finally {
      frozen.thaw();
      await stuck;
    }
    expect(outputRows(created.id)).toHaveLength(1);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('after a clean stop() the job is back in the queue with its provider job, and a restart finishes it', async () => {
    const alice = await world.signUp('Alice');
    const submit = vi.spyOn(mockProvider, 'submit');
    const first = world.runner();
    first.start();
    const created = await queued(alice);
    await waitFor('the job to be submitted', () =>
      rowOf(created.id)?.providerJobId ? true : undefined,
    );
    const providerJobId = rowOf(created.id)?.providerJobId;

    await first.stop();
    expect(rowOf(created.id)).toMatchObject({ status: 'queued', attempts: 0, providerJobId });
    expect(await balanceOf(alice)).toBe(49);

    const done = await runToCompletion(alice, created.id, world.runner());
    expect(done.status).toBe('succeeded');
    expect(rowOf(created.id)?.providerJobId).toBe(providerJobId);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);
  });
});

describe('a worker that dies before it submitted anything', () => {
  it('is recovered by the next worker’s own claim pass, with one charge and one result', async () => {
    const alice = await world.signUp('Alice');
    const created = await queued(alice);

    // A worker claims the job and is gone: nothing was sent to the provider.
    const claimed = claimNextJob(world.db, 'worker-dead/1', LEASE_MS);
    expect(claimed).toMatchObject({ id: created.id, status: 'processing', attempts: 1 });
    expect(claimed?.providerJobId).toBeNull();

    const next = world.runner();
    expect(await next.tick()).toBe(0); // still leased
    world.time.skip(LEASE_MS + 1_000);

    const done = await runToCompletion(alice, created.id, next);
    expect(done.status).toBe('succeeded');
    expect(rowOf(created.id)?.attempts).toBe(2);
    expect(outputRows(created.id)).toHaveLength(1);
    expect(await balanceOf(alice)).toBe(49);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation']);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('is failed and refunded exactly once when it keeps losing its worker', async () => {
    const alice = await world.signUp('Alice');
    const created = await queued(alice);

    for (const attempt of [1, 2, 3]) {
      expect(claimNextJob(world.db, `worker-dead/${attempt}`, LEASE_MS)).toMatchObject({
        attempts: attempt,
      });
      world.time.skip(LEASE_MS + 1_000);
      expect(requeueStale(world.db)).toBe(1);
    }

    const failed = dataOf(await alice.get<GenerationDTO>(`/generations/${created.id}`));
    expect(failed).toMatchObject({
      status: 'failed',
      error: {
        code: 'unavailable',
        message: 'The generation was interrupted and could not be completed.',
      },
    });
    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);

    // Nothing more can happen to it, and nothing is refunded twice.
    expect(requeueStale(world.db)).toBe(0);
    expect(await world.runner().tick()).toBe(0);
    expect(requeueStale(world.db, Date.now() + 10 * LEASE_MS)).toBe(0);
    expect(await balanceOf(alice)).toBe(50);
    expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });
});

describe('cancel and crash together', () => {
  it('a job canceled while its worker is dead is refunded once and never resurrected', async () => {
    const alice = await world.signUp('Alice');
    const frozen = freezable(world.time);
    const dying = world.runner({ sleep: frozen.sleep });
    const next = world.runner();
    const created = await queued(alice);
    const stuck = dying.tick();
    try {
      await waitFor('the job to be submitted', () =>
        rowOf(created.id)?.providerJobId ? true : undefined,
      );

      const canceled = await alice.post<GenerationDTO>(`/generations/${created.id}/cancel`);
      expect(dataOf(canceled).status).toBe('canceled');
      expect(await balanceOf(alice)).toBe(50);

      // The lease expires, recovery runs, the dead worker wakes up: nothing changes anymore.
      world.time.skip(LEASE_MS + 1_000);
      expect(requeueStale(world.db)).toBe(0);
      expect(await next.tick()).toBe(0);
      frozen.thaw();
      await stuck;

      expect(rowOf(created.id)).toMatchObject({ status: 'canceled' });
      expect(outputRows(created.id)).toHaveLength(0);
      expect(world.storedFiles()).toEqual([]);
      expect(await balanceOf(alice)).toBe(50);
      expect(reasonsOf(alice)).toEqual(['signup_bonus', 'generation', 'refund']);
      expectConsistentLedger(world.db, alice.user.id, 0);
    } finally {
      frozen.thaw();
    }
  });
});

describe('fairness between users', () => {
  it('one user’s backlog does not hold every worker slot while another user waits', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', '2');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const clip = textToVideo('a long backlog', { params: { durationSec: 3 } });
    const backlog = [];
    for (let index = 0; index < 4; index += 1) {
      backlog.push(dataOf(await alice.post<GenerationDTO>('/generations', clip), 201));
    }
    const bobs = await queued(bob, 'bob wants a picture too');

    // Two slots, five jobs: Alice's oldest job takes one, and the other goes to Bob, who has
    // nothing running, rather than to Alice's second job.
    const runner = world.runner();
    const running = runner.tick();
    const status = (id: string) => rowOf(id)?.status;
    expect(status(backlog[0]?.id ?? '')).toBe('processing');
    expect(status(bobs.id)).toBe('processing');
    expect(backlog.slice(1).map((job) => status(job.id))).toEqual(['queued', 'queued', 'queued']);

    for (const job of [...backlog, bobs]) {
      await (job === bobs ? bob : alice).post(`/generations/${job.id}/cancel`);
    }
    await running;
    expect(await balanceOf(alice)).toBe(50);
    expect(await balanceOf(bob)).toBe(50);
  });
});

describe('several workers on one queue', () => {
  it('never run a job twice: six jobs, two runners, six provider submits, six charges, no refunds', async () => {
    vi.stubEnv('MAX_ACTIVE_PER_USER', '10');
    vi.stubEnv('WORKER_CONCURRENCY', '3');
    resetEnvForTests();
    const alice = await world.signUp('Alice');
    const bob = await world.signUp('Bob');
    const submit = vi.spyOn(mockProvider, 'submit');

    const jobs: Array<[Member, GenerationDTO]> = [];
    for (let index = 0; index < 3; index += 1) {
      jobs.push([alice, await queued(alice, `alice lake ${index}`)]);
      jobs.push([bob, await queued(bob, `bob lake ${index}`)]);
    }
    const [first, second] = [world.runner(), world.runner()];

    const results = await Promise.all(
      jobs.map(([owner, job], index) =>
        runToCompletion(owner, job.id, index % 2 === 0 ? first : second),
      ),
    );
    expect(results.map((job) => job.status)).toEqual(Array(6).fill('succeeded'));
    expect(submit).toHaveBeenCalledTimes(6);
    for (const [, job] of jobs) {
      expect(rowOf(job.id)?.attempts).toBe(1);
      expect(outputRows(job.id)).toHaveLength(1);
    }
    expect(world.storedFiles()).toHaveLength(12);
    for (const member of [alice, bob]) {
      expect(await balanceOf(member)).toBe(47);
      expect(reasonsOf(member)).toEqual(['signup_bonus', 'generation', 'generation', 'generation']);
      expectConsistentLedger(world.db, member.user.id, 0);
    }
    const ledger = dataOf(await alice.get<LedgerEntryDTO[]>('/account/ledger'));
    expect(ledger.filter((entry) => entry.reason === 'refund')).toEqual([]);
  });
});
