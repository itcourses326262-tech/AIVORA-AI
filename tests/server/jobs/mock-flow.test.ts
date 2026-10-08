import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateGenerationRequest, GenerationDTO } from '@/lib/api-types';
import { getBalance } from '@/server/credits';
import { generations } from '@/server/db/schema';
import { getEnv, resetEnvForTests } from '@/server/env';
import { cancelGeneration, createGeneration, getGeneration } from '@/server/generations/service';
import { createJobRunner } from '@/server/jobs/worker';
import type { JobRunner } from '@/server/jobs/runner';
import { createLogger } from '@/server/logger';
import { mockProvider } from '@/server/providers/mock';
import { getProvider } from '@/server/providers/registry';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { createAsset, createUser, fakeStorage } from '../../helpers/factories';
import { streamToBytes } from '../../helpers/fakes';

// The real Demo provider, real image processing and real timers: the first-run experience of the
// product, end to end, minus HTTP. Image jobs take 2.5 to 4 seconds in the mock.

const harness = freshDb();
let storage: ReturnType<typeof fakeStorage>;
const runners: JobRunner[] = [];

function startRunner(tuning?: { shutdownGraceMs?: number; idleMs?: number }): JobRunner {
  const runner = createJobRunner({
    storage,
    log: createLogger({ level: 'silent' }),
    tuning: { idleMs: 50, ...tuning },
  });
  runners.push(runner);
  runner.start();
  return runner;
}

beforeEach(() => {
  vi.stubEnv('MAX_ACTIVE_PER_USER', '10');
  vi.stubEnv('WORKER_CONCURRENCY', '6');
  resetEnvForTests();
  storage = fakeStorage();
});

afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.stop()));
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const image = (
  prompt: string,
  extra: Partial<CreateGenerationRequest> = {},
): CreateGenerationRequest => ({
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt,
  ...extra,
});

/** Polls the API-level view of a generation until it reaches a final state. */
async function settled(userId: string, id: string, timeoutMs = 20_000): Promise<GenerationDTO> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const dto = await getGeneration(userId, id);
    if (['succeeded', 'failed', 'canceled'].includes(dto.status)) return dto;
    if (Date.now() > deadline) throw new Error(`generation ${id} still ${dto.status}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

describe('the Demo provider through the real engine', () => {
  // Real image and GIF encoding: slow when the whole suite runs in parallel.
  vi.setConfig({ testTimeout: 40_000 });

  it('uses the real mock provider, so the stubs-free path is what is tested', () => {
    expect(getProvider('mock')).toBe(mockProvider);
    expect(getEnv().ENABLE_MOCK_PROVIDER).toBe(true);
  });

  it('runs a synchronous Demo image from the request to a stored, probed WebP', async () => {
    const user = createUser(harness.db);
    startRunner();
    const { generation } = await createGeneration(
      user.id,
      image('a lighthouse __sync__', { params: { aspectRatio: '16:9' } }),
    );
    const done = await settled(user.id, generation.id);

    expect(done).toMatchObject({ status: 'succeeded', progress: 100 });
    expect(done.outputs).toHaveLength(1);
    expect(done.outputs[0]).toMatchObject({
      kind: 'image',
      mimeType: 'image/webp',
      width: 1280,
      height: 720,
    });
    expect(done.outputs[0]?.thumbUrl).toBeTruthy();
    expect(getBalance(harness.db, user.id)).toBe(49);

    const row = harness.db
      .select()
      .from(generations)
      .where(eq(generations.id, generation.id))
      .get();
    const stored = await storage.get(
      (harness.db.$client.prepare('select storage_key as k from assets').get() as { k: string }).k,
    );
    const meta = await sharp(await streamToBytes(stored.stream)).metadata();
    expect(meta).toMatchObject({ format: 'webp', width: 1280, height: 720 });
    expect(row?.workerId).toBeTruthy();
  });

  it('delivers a Demo video as an animated GIF asset', async () => {
    const user = createUser(harness.db);
    startRunner();
    const { generation } = await createGeneration(user.id, {
      tool: 'text-to-video',
      modelId: 'aivore-demo-video',
      prompt: 'waves __sync__',
      params: { durationSec: 3, resolution: '480p' },
    });
    const done = await settled(user.id, generation.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]).toMatchObject({
      kind: 'video',
      mimeType: 'image/gif',
      durationMs: 3000,
    });
    expect(getBalance(harness.db, user.id)).toBe(44);
  });

  it('runs success, provider failure, content refusal and a cancel side by side, with exact accounting', async () => {
    const user = createUser(harness.db);
    startRunner();
    const [ok, broken, refused, canceled] = await Promise.all([
      createGeneration(user.id, image('a calm lake')),
      createGeneration(user.id, image('__fail__ something')),
      createGeneration(user.id, image('__content__ something')),
      createGeneration(user.id, image('a long wait')),
    ]);
    expect(getBalance(harness.db, user.id)).toBe(46);

    // Progress is visible while the async mock job runs.
    const progressSeen: number[] = [];
    const watcher = (async () => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const dto = await getGeneration(user.id, ok.generation.id);
        progressSeen.push(dto.progress);
        if (dto.status !== 'queued' && dto.status !== 'processing') return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await cancelGeneration(user.id, canceled.generation.id);

    const [okDone, brokenDone, refusedDone, canceledDone] = await Promise.all([
      settled(user.id, ok.generation.id),
      settled(user.id, broken.generation.id),
      settled(user.id, refused.generation.id),
      settled(user.id, canceled.generation.id),
    ]);
    await watcher;

    expect(okDone).toMatchObject({ status: 'succeeded', progress: 100 });
    expect(okDone.outputs).toHaveLength(1);
    expect(brokenDone).toMatchObject({
      status: 'failed',
      error: {
        code: 'unavailable',
        message: expect.stringContaining('simulated a failure'),
      },
    });
    expect(refusedDone).toMatchObject({
      status: 'failed',
      error: { code: 'content_policy' },
    });
    expect(canceledDone).toMatchObject({ status: 'canceled', outputs: [] });

    // The progress bar only ever went forward, and showed something in between.
    expect(progressSeen).toEqual([...progressSeen].toSorted((a, b) => a - b));
    expect(progressSeen.some((value) => value > 0 && value < 100)).toBe(true);

    // 4 credits spent, 3 given back (failure, refusal, cancel): only the success is paid for.
    expect(getBalance(harness.db, user.id)).toBe(49);
    expectConsistentLedger(harness.db, user.id, 50);
    // Nothing from the failed or canceled jobs is left in storage.
    expect(storage.objects.size).toBe(2); // the one image and its thumbnail
  }, 40_000);

  it('resumes an image-to-image job on a new worker after a restart, with the input and metadata', async () => {
    const user = createUser(harness.db);
    const png = await sharp({
      create: { width: 96, height: 64, channels: 3, background: '#3366cc' },
    })
      .png()
      .toBuffer();
    const input = createAsset(harness.db, { userId: user.id, width: 96, height: 64 });
    await storage.put(input.storageKey, new Uint8Array(png), { mimeType: 'image/png' });

    const first = startRunner({ shutdownGraceMs: 50 });
    const { generation } = await createGeneration(user.id, {
      tool: 'image-to-image',
      modelId: 'aivore-demo-image',
      prompt: 'make it warmer',
      params: { strength: 0.7 },
      inputAssetId: input.id,
    });
    // Wait until the worker has submitted the job to the provider...
    const deadline = Date.now() + 10_000;
    while (
      !harness.db.select().from(generations).where(eq(generations.id, generation.id)).get()
        ?.providerJobId
    ) {
      if (Date.now() > deadline) throw new Error('job was never submitted');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // ...then the process goes away (graceful: the lease is handed back at once).
    await first.stop();
    const parked = harness.db
      .select()
      .from(generations)
      .where(eq(generations.id, generation.id))
      .get();
    expect(parked).toMatchObject({ status: 'queued', attempts: 0 });
    expect(parked?.providerMeta).toMatchObject({ v: 1 });

    startRunner();
    const done = await settled(user.id, generation.id);
    expect(done.status).toBe('succeeded');
    expect(done.outputs[0]).toMatchObject({ kind: 'image', width: 96, height: 64 });
    expect(done.input?.id).toBe(input.id);
    expect(getBalance(harness.db, user.id)).toBe(49);
  }, 40_000);
});
