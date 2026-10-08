import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { GenerationDTO, UserDTO } from '@/lib/api-types';
import { assets, generations } from '@/server/db/schema';
import { expectConsistentLedger, ledgerInOrder } from '../helpers/credits';
import { dataOf } from './helpers/api';
import { externalWorkers } from './helpers/external-worker';
import { createWorld, textToImage, waitFor } from './helpers/world';

// WORKER_MODE=external as deployed: the web app (here: its route handlers) and `scripts/worker.ts`
// are separate operating-system processes that share one SQLite file and one media directory.
// Real clock, real processes, real signals; only the Demo provider stands in for a paid one.

vi.setConfig({ testTimeout: 120_000 });

const world = createWorld({ warp: 1 });
const workers = externalWorkers(() => world.storageDir);

const rowOf = (id: string) =>
  world.db.select().from(generations).where(eq(generations.id, id)).get();

describe('the web app and a separate worker process', () => {
  it('queues work while no worker runs, then a worker started later finishes it and stops cleanly', async () => {
    const alice = await world.signUp('Alice');
    const queued = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('queued before any worker')),
      201,
    );
    expect(rowOf(queued.id)?.status).toBe('queued');
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);

    const worker = workers.spawn();
    const done = await waitFor(
      'the worker to finish the job',
      async () => {
        const current = dataOf(await alice.get<GenerationDTO>(`/generations/${queued.id}`));
        return current.status === 'succeeded' ? current : undefined;
      },
      60_000,
    );
    expect(done.outputs).toHaveLength(1);

    // What the other process stored is served by this one.
    const served = await alice.media(done.outputs[0]?.url ?? '');
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.bytes.byteLength).toBe(done.outputs[0]?.bytes);

    // A job created while the worker runs is found by its idle poll (the wake-up cannot cross
    // processes), and the worker leaves cleanly on SIGTERM.
    const later = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('created while it runs')),
      201,
    );
    await waitFor(
      'the running worker to find the new job',
      () => (rowOf(later.id)?.status === 'succeeded' ? true : undefined),
      60_000,
    );
    worker.kill('SIGTERM');
    expect((await worker.exited).code).toBe(0);
    expect(worker.output()).toContain('Job runner stopped');

    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(48);
    expectConsistentLedger(world.db, alice.user.id, 0);
  });

  it('a worker killed with SIGKILL mid-job: the next worker resumes the same provider job once the lease is gone', async () => {
    const alice = await world.signUp('Alice');
    const queued = dataOf(
      await alice.post<GenerationDTO>('/generations', textToImage('interrupted by a crash')),
      201,
    );

    const doomed = workers.spawn();
    const submitted = await waitFor(
      'the worker to submit the job',
      () => {
        const row = rowOf(queued.id);
        return row?.status === 'processing' && row.providerJobId ? row : undefined;
      },
      60_000,
    );
    doomed.kill('SIGKILL');
    expect((await doomed.exited).signal).toBe('SIGKILL');
    // A kill gives no chance to hand the job back: it stays "processing" until its lease expires.
    expect(rowOf(queued.id)).toMatchObject({ status: 'processing', workerId: submitted.workerId });
    // Instead of waiting out the 60 s lease, make it expire now.
    world.db
      .update(generations)
      .set({ leaseUntil: Date.now() - 1_000 })
      .where(eq(generations.id, queued.id))
      .run();

    const replacement = workers.spawn();
    const done = await waitFor(
      'the replacement worker to finish the job',
      async () => {
        const current = dataOf(await alice.get<GenerationDTO>(`/generations/${queued.id}`));
        return current.status === 'succeeded' ? current : undefined;
      },
      60_000,
    );
    expect(done.outputs).toHaveLength(1);
    expect(rowOf(queued.id)).toMatchObject({
      attempts: 2,
      providerJobId: submitted.providerJobId,
    });
    expect(world.db.select().from(assets).all()).toHaveLength(1);
    expect(world.storedFiles()).toHaveLength(2);
    expect(dataOf(await alice.get<UserDTO>('/auth/me')).creditBalance).toBe(49);
    expect(ledgerInOrder(world.db, alice.user.id).map((entry) => entry.reason)).toEqual([
      'signup_bonus',
      'generation',
    ]);
    expectConsistentLedger(world.db, alice.user.id, 0);

    replacement.kill('SIGTERM');
    expect((await replacement.exited).code).toBe(0);
  });
});
