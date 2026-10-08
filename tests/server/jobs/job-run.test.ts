import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assets, generations } from '@/server/db/schema';
import {
  claimNextJob,
  markCanceled,
  recordSubmitted,
  requeueStale,
} from '@/server/generations/lifecycle';
import { ProviderError } from '@/server/providers/errors';
import type { PollResult, ProviderInput, SubmitResult } from '@/server/providers/types';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { createAsset } from '../../helpers/factories';
import { TINY_PNG, fakeProvider, tinyOutput } from '../../helpers/fakes';
import { createHarness, deferred, type Harness, type HarnessOptions } from './support';

const open: Harness[] = [];

function harness(options?: HarnessOptions): Harness {
  const created = createHarness(options);
  open.push(created);
  return created;
}

afterEach(() => {
  for (const item of open.splice(0)) item.close();
});

const asyncSubmit = (
  providerJobId = 'job-1',
  meta: Record<string, unknown> = { v: 1 },
): SubmitResult => ({
  mode: 'async',
  providerJobId,
  meta,
});

/** A provider whose poll() walks through `steps` (the last one repeats). */
function pollingProvider(
  steps: Array<PollResult | (() => PollResult)>,
  options: { cancel?: boolean } = {},
) {
  let call = 0;
  return fakeProvider({
    submit: () => asyncSubmit(),
    poll: () => {
      const step = steps[Math.min(call, steps.length - 1)];
      call += 1;
      return typeof step === 'function' ? step() : (step as PollResult);
    },
    ...(options.cancel ? { cancel: () => undefined } : {}),
  });
}

const running = (progress?: number): PollResult => ({
  status: 'running',
  ...(progress === undefined ? {} : { progress }),
});
const done = (kind: 'image' | 'video' = 'image'): PollResult => ({
  status: 'succeeded',
  outputs: [tinyOutput(kind)],
});
const failed = (error: ProviderError): PollResult => ({ status: 'failed', error });

/** Runs one tick through virtual time and returns the finished row. */
async function runOne(h: Harness, id: string) {
  await h.clock.runUntil(h.runner.tick());
  return h.row(id);
}

describe('synchronous providers', () => {
  it('stores the output with real image processing and completes the job', async () => {
    const h = harness({ realPersist: true });
    const job = h.enqueue();
    await h.runner.tick();

    const row = h.row(job.id);
    expect(row).toMatchObject({ status: 'succeeded', progress: 100, errorCode: null, attempts: 1 });
    const [asset] = h.test.db.select().from(assets).where(eq(assets.generationId, job.id)).all();
    expect(asset).toMatchObject({
      role: 'output',
      kind: 'image',
      index: 0,
      mimeType: 'image/png',
      width: 1,
      height: 1,
      userId: h.user.id,
    });
    expect(asset?.thumbKey).toBeTruthy();
    expect(h.storage.objects.has(asset?.storageKey ?? '')).toBe(true);
    expect(h.storage.objects.has(asset?.thumbKey ?? '')).toBe(true);
    expect(h.balance()).toBe(49);
  });

  it('hands the provider everything it needs and a signal it can abort on', async () => {
    const h = harness();
    const job = h.enqueue({
      prompt: 'a fox',
      negativePrompt: 'blur',
      params: { aspectRatio: '16:9', count: 1, seed: 7 },
    });
    await h.runner.tick();

    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    const [input, ctx] = h.provider.submit.mock.calls[0] ?? [];
    expect(input).toMatchObject({
      generationId: job.id,
      tool: 'text-to-image',
      prompt: 'a fox',
      negativePrompt: 'blur',
      params: { aspectRatio: '16:9', count: 1, seed: 7 },
      model: { id: 'aivore-demo-image' },
    });
    expect(input).not.toHaveProperty('inputImage');
    expect(ctx?.signal).toBeInstanceOf(AbortSignal);
    expect(ctx?.env).toBe(h.env);
    expect(typeof ctx?.fetch).toBe('function');
  });

  it('stores every requested output in order', async () => {
    const h = harness();
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 3 }, cost: 3 });
    await h.runner.tick();
    const stored = h.test.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, job.id))
      .orderBy(assets.index)
      .all();
    expect(stored.map((asset) => asset.index)).toEqual([0, 1, 2]);
    expect(h.row(job.id).status).toBe('succeeded');
    expect(h.balance()).toBe(47);
  });

  it('keeps only as many outputs as were paid for', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({
          mode: 'sync',
          outputs: [tinyOutput('image'), tinyOutput('image'), tinyOutput('image')],
        }),
      }),
    });
    const job = h.enqueue();
    await h.runner.tick();
    expect(h.persist).toHaveBeenCalledTimes(1);
    expect(
      h.test.db.select().from(assets).where(eq(assets.generationId, job.id)).all(),
    ).toHaveLength(1);
  });

  it('refunds the missing share when fewer outputs arrive than were paid for', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'sync', outputs: [tinyOutput('image'), tinyOutput('image')] }),
      }),
    });
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 4 }, cost: 4 });
    await h.runner.tick();
    expect(h.row(job.id).status).toBe('succeeded');
    expect(
      h.test.db.select().from(assets).where(eq(assets.generationId, job.id)).all(),
    ).toHaveLength(2);
    expect(h.balance()).toBe(48);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('fails and refunds in full when the provider returns nothing', async () => {
    const h = harness({
      provider: fakeProvider({ submit: () => ({ mode: 'sync', outputs: [] }) }),
    });
    const job = h.enqueue({ cost: 3 });
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.balance()).toBe(50);
  });

  it('skips an output that has neither bytes nor a url', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'sync', outputs: [{ kind: 'image' }, tinyOutput('image')] }),
      }),
    });
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    await h.runner.tick();
    expect(h.row(job.id).status).toBe('succeeded');
    expect(
      h.test.db.select().from(assets).where(eq(assets.generationId, job.id)).all(),
    ).toHaveLength(1);
    expect(h.balance()).toBe(49);
  });

  it('delivers a video as one asset with its duration', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'sync', outputs: [{ ...tinyOutput('video'), durationMs: 5000 }] }),
      }),
    });
    const job = h.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 5, resolution: '480p' },
      cost: 10,
    });
    await h.runner.tick();
    const [asset] = h.test.db.select().from(assets).where(eq(assets.generationId, job.id)).all();
    expect(asset).toMatchObject({ kind: 'video', mimeType: 'image/gif', durationMs: 5000 });
    expect(h.row(job.id).status).toBe('succeeded');
  });
});

describe('output files', () => {
  it('skips one unusable output and still delivers the rest', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({
          mode: 'sync',
          outputs: [tinyOutput('image'), tinyOutput('image'), tinyOutput('image')],
        }),
      }),
    });
    let calls = 0;
    const original = h.persist.getMockImplementation();
    h.persist.mockImplementation(async (storage, input) => {
      calls += 1;
      if (calls === 2) {
        const { AppError } = await import('@/lib/errors');
        throw AppError.of('bad_request', 'The provider returned an unsupported file');
      }
      return (original as NonNullable<typeof original>)(storage, input);
    });
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 3 }, cost: 3 });
    await h.runner.tick();

    const stored = h.test.db
      .select()
      .from(assets)
      .where(eq(assets.generationId, job.id))
      .orderBy(assets.index)
      .all();
    expect(h.row(job.id).status).toBe('succeeded');
    expect(stored.map((asset) => asset.index)).toEqual([0, 1]);
    expect(h.balance()).toBe(48);
  });

  it('fails with a refund when no output is usable', async () => {
    const h = harness({
      realPersist: true,
      provider: fakeProvider({
        submit: () => ({
          mode: 'sync',
          outputs: [{ kind: 'image', bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
        }),
      }),
    });
    const job = h.enqueue();
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.balance()).toBe(50);
    expect(h.storage.objects.size).toBe(0);
  });

  it('removes files already written when storage breaks half way, and refunds', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => ({ mode: 'sync', outputs: [tinyOutput('image'), tinyOutput('image')] }),
      }),
    });
    const original = h.persist.getMockImplementation();
    let calls = 0;
    h.persist.mockImplementation(async (storage, input) => {
      calls += 1;
      if (calls === 2) throw new Error('disk full: /var/secret/path');
      return (original as NonNullable<typeof original>)(storage, input);
    });
    const job = h.enqueue({ params: { aspectRatio: '1:1', count: 2 }, cost: 2 });
    await h.runner.tick();

    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'internal' });
    expect(h.row(job.id).errorMessage).not.toContain('secret');
    expect(h.storage.objects.size).toBe(0);
    expect(h.balance()).toBe(50);
  });

  it('removes the files of a result that arrives after the user canceled', async () => {
    const h = harness();
    const job = h.enqueue({ cost: 2 });
    h.persist.mockImplementationOnce(async (storage, input) => {
      // The user presses cancel while the file is being written.
      markCanceled(h.db, h.user.id, job.id);
      const key = `u/${input.userId}/${input.generationId}/ast_x.png`;
      await storage.put(key, TINY_PNG, { mimeType: 'image/png' });
      return {
        assetId: 'ast_x',
        index: 0,
        kind: 'image',
        storageKey: key,
        mimeType: 'image/png',
        bytes: 1,
      };
    });
    await h.runner.tick();

    expect(h.row(job.id).status).toBe('canceled');
    expect(h.test.db.select().from(assets).all()).toHaveLength(0);
    expect(h.storage.objects.size).toBe(0);
    expect(h.balance()).toBe(50);
    expect(ledgerInOrder(h.db, h.user.id).map((entry) => entry.reason)).toEqual([
      'generation',
      'refund',
    ]);
  });
});

describe('asynchronous providers', () => {
  it('polls with the image backoff and completes', async () => {
    const h = harness({ provider: pollingProvider([running(), running(), running(), done()]) });
    const job = h.enqueue();
    const row = await runOne(h, job.id);

    expect(row.status).toBe('succeeded');
    expect(h.provider.poll).toHaveBeenCalledTimes(4);
    expect(h.clock.sleeps.filter((ms) => ms < 10_000)).toEqual([1000, 1500, 2250]);
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
  });

  it('caps the image wait at 3 s and the video wait at 10 s', async () => {
    const image = harness({ provider: pollingProvider([...Array(6).fill(running()), done()]) });
    await runOne(image, image.enqueue().id);
    expect(image.clock.sleeps.filter((ms) => ms < 10_000)).toEqual([
      1000, 1500, 2250, 3000, 3000, 3000,
    ]);

    const video = harness({
      provider: pollingProvider([...Array(6).fill(running()), done('video')]),
    });
    const job = video.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p' },
      cost: 6,
    });
    await runOne(video, job.id);
    expect(video.clock.sleeps.filter((ms) => ms <= 10_000)).toEqual([
      3000, 4500, 6750, 10_000, 10_000, 10_000,
    ]);
  });

  it('jitters every wait by at most 20 percent', async () => {
    for (const random of [0, 0.999999]) {
      const h = harness({
        provider: pollingProvider([...Array(5).fill(running()), done()]),
        random: () => random,
      });
      await runOne(h, h.enqueue().id);
      const waits = h.clock.sleeps.filter((ms) => ms < 10_000);
      const base = [1000, 1500, 2250, 3000, 3000];
      waits.forEach((ms, index) => {
        expect(ms).toBeGreaterThanOrEqual(Math.round((base[index] ?? 0) * 0.8));
        expect(ms).toBeLessThanOrEqual(Math.round((base[index] ?? 0) * 1.2));
      });
      expect(waits[0]).toBe(random === 0 ? 800 : 1200);
    }
  });

  it('stores the provider job id and metadata as soon as it is known, so a restart can resume', async () => {
    let seenInDb: { providerJobId: string | null; providerMeta: unknown } | undefined;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit('remote-42', { v: 2, deep: { k: 'v' } }),
        poll: () => {
          seenInDb ??= (() => {
            const row = h.test.db.select().from(generations).get();
            return { providerJobId: row?.providerJobId ?? null, providerMeta: row?.providerMeta };
          })();
          return done();
        },
      }),
    });
    await runOne(h, h.enqueue().id);
    expect(seenInDb).toEqual({
      providerJobId: 'remote-42',
      providerMeta: { v: 2, deep: { k: 'v' } },
    });
  });

  it('polls with the stored job id, the same input and the metadata', async () => {
    const h = harness({ provider: pollingProvider([running(), done()]) });
    const job = h.enqueue({ prompt: 'hello' });
    await runOne(h, job.id);
    const [jobId, input, ctx, meta] = h.provider.poll.mock.calls[0] ?? [];
    expect(jobId).toBe('job-1');
    expect(input).toMatchObject({ generationId: job.id, prompt: 'hello' });
    expect(ctx?.signal).toBeInstanceOf(AbortSignal);
    expect(meta).toEqual({ v: 1 });
  });

  it('maps provider progress into the job and never lets it go backwards', async () => {
    const seen: number[] = [];
    const h = harness({
      provider: pollingProvider([
        running(0),
        running(50),
        running(20),
        running(undefined),
        running(100),
        done(),
      ]),
    });
    h.provider.poll.mockImplementation(async (_id, _input, _ctx, _meta) => {
      const row = h.test.db.select().from(generations).get();
      seen.push(row?.progress ?? -1);
      const call = h.provider.poll.mock.calls.length;
      return [running(0), running(50), running(20), running(), running(100), done()][
        call - 1
      ] as PollResult;
    });
    const job = h.enqueue();
    await runOne(h, job.id);

    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] ?? 0);
    }
    expect(seen.at(-1)).toBeGreaterThan(80);
    expect(Math.max(...seen)).toBeLessThan(100);
    expect(h.row(job.id).progress).toBe(100);
  });

  it('creeps forward when the provider reports no progress at all', async () => {
    const seen: number[] = [];
    const h = harness({ provider: pollingProvider([running(), running(), running(), done()]) });
    h.provider.poll.mockImplementation(async () => {
      seen.push(h.test.db.select().from(generations).get()?.progress ?? -1);
      return seen.length < 4 ? running() : done();
    });
    await runOne(h, h.enqueue().id);
    expect(seen.slice(1)).toEqual([...seen.slice(1)].toSorted((a, b) => a - b));
    expect(new Set(seen).size).toBeGreaterThan(2);
  });

  it("fails the job with the provider's message when the provider reports failure", async () => {
    const h = harness({
      provider: pollingProvider([
        running(),
        failed(new ProviderError('content_policy', 'upstream said: flagged by classifier xyz')),
      ]),
    });
    const job = h.enqueue({ cost: 4 });
    const row = await runOne(h, job.id);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'content_policy' });
    expect(row.errorMessage).toBe(
      "The prompt or image was rejected by the generation service's content rules.",
    );
    expect(row.errorMessage).not.toContain('classifier');
    expect(h.balance()).toBe(50);
  });

  it.each([
    ['rate_limited', 'rate_limited'],
    ['unavailable', 'unavailable'],
    ['timeout', 'timeout'],
    ['auth', 'unavailable'],
    ['unknown', 'internal'],
    ['invalid_input', 'invalid_input'],
  ] as const)(
    'stores provider error %s as %s and hides credential problems',
    async (code, stored) => {
      const h = harness({
        provider: pollingProvider([
          failed(new ProviderError(code, 'API key sk-live-123 rejected', { retryable: false })),
        ]),
      });
      const job = h.enqueue();
      const row = await runOne(h, job.id);
      expect(row).toMatchObject({ status: 'failed', errorCode: stored });
      expect(JSON.stringify(row)).not.toContain('sk-live-123');
      expect(h.balance()).toBe(50);
    },
  );
});

describe('resuming after a restart', () => {
  it('continues polling a submitted job without submitting it again', async () => {
    const h = harness({ provider: pollingProvider([running(), done()]) });
    const job = h.enqueue();
    // The previous worker submitted, recorded it, and then died.
    claimNextJob(h.db, 'dead-worker', 60_000, h.clock.now());
    recordSubmitted(h.db, job.id, 'dead-worker', 'remote-9', { v: 1, startedAt: 5 });
    await h.clock.advance(61_000);

    const row = await runOne(h, job.id);
    expect(h.provider.submit).not.toHaveBeenCalled();
    const [jobId, , , meta] = h.provider.poll.mock.calls[0] ?? [];
    expect(jobId).toBe('remote-9');
    expect(meta).toEqual({ v: 1, startedAt: 5 });
    expect(row).toMatchObject({ status: 'succeeded', attempts: 2 });
    expect(h.balance()).toBe(49);
  });

  it('submits again when the crash happened before the submit was recorded', async () => {
    const h = harness();
    const job = h.enqueue();
    claimNextJob(h.db, 'dead-worker', 60_000, h.clock.now());
    await h.clock.advance(61_000);
    const row = await runOne(h, job.id);
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('gives up on a job that keeps crashing workers and refunds it', async () => {
    const h = harness();
    const job = h.enqueue({ cost: 6 });
    for (const attempt of [1, 2, 3]) {
      claimNextJob(h.db, `dead-${attempt}`, 60_000, h.clock.now());
      await h.clock.advance(61_000);
      // The first two crashes are recovered by a later pass; the third one is the last straw.
      if (attempt < 3) requeueStale(h.db, h.clock.now(), { maxAttempts: 3 });
    }
    expect(await h.runner.tick()).toBe(0);
    expect(h.row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'unavailable',
      errorMessage: 'The generation was interrupted and could not be completed.',
      attempts: 3,
    });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
    expectConsistentLedger(h.db, h.user.id, 50);
  });

  it('does not take a job away from a worker whose lease is still alive', async () => {
    const h = harness();
    const job = h.enqueue();
    claimNextJob(h.db, 'busy-worker', 60_000, h.clock.now());
    await h.clock.advance(30_000);
    expect(await h.runner.tick()).toBe(0);
    expect(h.row(job.id)).toMatchObject({
      status: 'processing',
      workerId: 'busy-worker',
      attempts: 1,
    });
    expect(h.provider.submit).not.toHaveBeenCalled();
  });
});

describe('timeouts', () => {
  it('stops an image job that runs past its deadline, cancels it upstream and refunds it', async () => {
    const h = harness({
      provider: pollingProvider([running(10)], { cancel: true }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const job = h.enqueue({ cost: 3 });
    const row = await runOne(h, job.id);

    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'timeout',
      errorMessage: 'The generation took too long and was stopped.',
    });
    expect(h.provider.cancel).toHaveBeenCalledTimes(1);
    expect(h.provider.cancel).toHaveBeenCalledWith('job-1', expect.anything(), { v: 1 });
    expect(h.balance()).toBe(50);
    expect(h.clock.pending()).toEqual([]);
  });

  it('uses the longer video deadline for videos', async () => {
    const h = harness({
      provider: pollingProvider([running(10)]),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10', GENERATION_TIMEOUT_SEC_VIDEO: '40' },
    });
    const job = h.enqueue({
      tool: 'text-to-video',
      params: { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p' },
      cost: 6,
    });
    const finished = h.runner.tick();
    await h.clock.advance(25_000);
    expect(h.row(job.id).status).toBe('processing');
    await h.clock.runUntil(finished);
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  });

  it('aborts a provider call that hangs past the deadline', async () => {
    let aborted = false;
    const h = harness({
      provider: fakeProvider({
        submit: (_input, ctx) =>
          new Promise((_resolve, reject) => {
            ctx.signal.addEventListener('abort', () => {
              aborted = true;
              reject(ctx.signal.reason);
            });
          }),
      }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const job = h.enqueue();
    const row = await runOne(h, job.id);
    expect(aborted).toBe(true);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(h.balance()).toBe(50);
  });

  it('does not time out a job that finishes in time', async () => {
    const h = harness({
      provider: pollingProvider([running(), running(), running(), running(), done()]),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const row = await runOne(h, h.enqueue().id);
    expect(row.status).toBe('succeeded');
  });

  it('does not let a provider that ignores the abort and never answers hold the worker', async () => {
    const h = harness({
      provider: fakeProvider({ submit: () => new Promise(() => undefined) }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const job = h.enqueue({ cost: 2 });
    const row = await runOne(h, job.id);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(h.balance()).toBe(50);
    expect(h.clock.pending()).toEqual([]);
    // The slot is free again for the next job.
    h.provider.submit.mockImplementation(async (input) => ({
      mode: 'sync',
      outputs: [tinyOutput(input.model.kind)],
    }));
    const next = h.enqueue();
    await h.runner.tick();
    expect(h.row(next.id).status).toBe('succeeded');
  });

  it('does not let a storage write that hangs hold the worker either', async () => {
    const h = harness({ env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' } });
    h.persist.mockImplementation(() => new Promise(() => undefined));
    const job = h.enqueue();
    const row = await runOne(h, job.id);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(h.balance()).toBe(50);
  });

  it('fails and refunds a timed-out job BEFORE asking the provider to cancel, and does not wait for a cancel that never answers', async () => {
    const statusWhenCancelStarted: string[] = [];
    let cancelSignal: AbortSignal | undefined;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => running(10),
        cancel: (_id, ctx) => {
          cancelSignal = ctx.signal;
          statusWhenCancelStarted.push(h.row(job.id).status);
          return new Promise<void>(() => undefined); // ignores its signal, never answers
        },
      }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const job = h.enqueue({ cost: 3 });
    const startedAt = h.clock.now();
    await h.clock.runUntil(h.runner.tick());

    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(h.balance()).toBe(50);
    expectConsistentLedger(h.db, h.user.id, 50);
    // The outcome was recorded before the provider was bothered...
    expect(statusWhenCancelStarted).toEqual(['failed']);
    // ...and the run stopped waiting for it after the 10 s limit (deadline 10 s + cancel 10 s).
    expect(h.clock.now() - startedAt).toBe(20_000);
    expect(cancelSignal?.aborted).toBe(true);
    expect(h.clock.pending()).toEqual([]);
    expect(h.logs.lines.some((line) => line.msg === 'Could not cancel the upstream job')).toBe(
      true,
    );
  });

  it('tolerates a provider that ignores the abort and answers late', async () => {
    const release = deferred<SubmitResult>();
    const h = harness({
      provider: fakeProvider({ submit: () => release.promise }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '10' },
    });
    const job = h.enqueue();
    const finished = h.runner.tick();
    await h.clock.advance(11_000);
    release.resolve({ mode: 'sync', outputs: [tinyOutput('image')] });
    await finished;
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
    expect(h.test.db.select().from(assets).all()).toHaveLength(0);
    expect(h.persist).not.toHaveBeenCalled();
  });
});

describe('retrying the provider', () => {
  const flaky = (failures: number, error: () => ProviderError) => {
    let calls = 0;
    return fakeProvider({
      submit: (input): SubmitResult => {
        calls += 1;
        if (calls <= failures) throw error();
        return { mode: 'sync', outputs: [tinyOutput(input.model.kind)] };
      },
    });
  };

  it('retries a retryable submit error with growing waits and then succeeds', async () => {
    const h = harness({ provider: flaky(2, () => new ProviderError('unavailable', 'blip')) });
    const job = h.enqueue();
    const row = await runOne(h, job.id);
    expect(row.status).toBe('succeeded');
    expect(h.provider.submit).toHaveBeenCalledTimes(3);
    expect(h.clock.sleeps.filter((ms) => ms < 10_000)).toEqual([2000, 4000]);
    expect(h.balance()).toBe(49);
  });

  it("gives up after MAX_ATTEMPTS submits and shows the provider's message", async () => {
    const h = harness({ provider: flaky(99, () => new ProviderError('unavailable', 'down hard')) });
    const job = h.enqueue({ cost: 2 });
    const row = await runOne(h, job.id);
    expect(h.provider.submit).toHaveBeenCalledTimes(3);
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'unavailable',
      errorMessage: 'The generation service is temporarily unavailable. Please try again.',
    });
    expect(h.balance()).toBe(50);
  });

  it('honours MAX_ATTEMPTS from the environment', async () => {
    const h = harness({
      provider: flaky(99, () => new ProviderError('rate_limited', 'slow down')),
      env: { MAX_ATTEMPTS: '5' },
    });
    await runOne(h, h.enqueue().id);
    expect(h.provider.submit).toHaveBeenCalledTimes(5);
  });

  it('waits at least as long as the provider asks (Retry-After)', async () => {
    const h = harness({
      provider: flaky(1, () => new ProviderError('rate_limited', 'busy', { retryAfterMs: 20_000 })),
    });
    await runOne(h, h.enqueue().id);
    expect(h.clock.sleeps).toContain(20_000);
  });

  it('does not retry an error that cannot succeed', async () => {
    const h = harness({
      provider: flaky(99, () => new ProviderError('invalid_input', 'bad size')),
    });
    const job = h.enqueue();
    const row = await runOne(h, job.id);
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'invalid_input' });
    expect(h.balance()).toBe(50);
  });

  it('reports a content-policy refusal as such, without retrying', async () => {
    const h = harness({ provider: flaky(99, () => new ProviderError('content_policy', 'nope')) });
    const row = await runOne(h, h.enqueue().id);
    expect(h.provider.submit).toHaveBeenCalledTimes(1);
    expect(row.errorCode).toBe('content_policy');
  });

  it('keeps polling through temporary poll errors', async () => {
    let calls = 0;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => {
          calls += 1;
          if (calls <= 3) throw new ProviderError('unavailable', 'blip');
          return done();
        },
      }),
    });
    const row = await runOne(h, h.enqueue().id);
    expect(row.status).toBe('succeeded');
    expect(calls).toBe(4);
  });

  it('fails after too many consecutive poll errors', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => {
          throw new ProviderError('unavailable', 'always down');
        },
      }),
      tuning: { maxPollErrors: 3 },
    });
    const job = h.enqueue();
    const row = await runOne(h, job.id);
    expect(h.provider.poll).toHaveBeenCalledTimes(4);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.balance()).toBe(50);
  });

  it('counts only consecutive poll errors', async () => {
    let calls = 0;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => {
          calls += 1;
          if (calls < 12 && calls % 2 === 1) throw new ProviderError('unavailable', 'flaky');
          return calls < 12 ? running() : done();
        },
      }),
      tuning: { maxPollErrors: 2 },
    });
    const row = await runOne(h, h.enqueue().id);
    expect(row.status).toBe('succeeded');
  });

  it('does not retry a poll error that cannot succeed', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => {
          throw new ProviderError('auth', 'bad key');
        },
      }),
    });
    const row = await runOne(h, h.enqueue().id);
    expect(h.provider.poll).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
  });
});

describe('unexpected failures', () => {
  it('fails with a generic message, refunds, and keeps the details in the log only', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => {
          throw new TypeError(
            'Cannot read properties of undefined (reading "secretField") at /srv/app/x.ts',
          );
        },
      }),
    });
    const job = h.enqueue({ cost: 3 });
    await h.runner.tick();

    const row = h.row(job.id);
    expect(row).toMatchObject({
      status: 'failed',
      errorCode: 'internal',
      errorMessage: 'The generation failed unexpectedly.',
    });
    expect(JSON.stringify(row)).not.toContain('secretField');
    expect(h.balance()).toBe(50);
    expect(h.logs.lines.some((line) => line.level === 'error')).toBe(true);
    expect(h.logs.text()).toContain('secretField');
  });

  it('survives a provider that throws something that is not even an Error', async () => {
    const h = harness({
      provider: fakeProvider({ submit: () => Promise.reject('just a string') }),
    });
    const job = h.enqueue();
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'internal' });
    expect(h.balance()).toBe(50);
  });

  it('fails a job whose model no longer exists', async () => {
    const h = harness();
    const job = h.enqueue({ modelId: 'removed-model' });
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
  });

  it('fails a job whose provider lost its credentials', async () => {
    const h = harness({ provider: fakeProvider({ configured: false }) });
    const job = h.enqueue();
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'unavailable',
      errorMessage: 'The generation service is not available right now.',
    });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
  });

  it('rejects an async submit without a job id', async () => {
    const h = harness({
      provider: fakeProvider({ submit: () => ({ mode: 'async', providerJobId: '' }) }),
    });
    const job = h.enqueue();
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'unavailable' });
    expect(h.provider.poll).not.toHaveBeenCalled();
  });

  it('keeps going after the database refuses to store progress', async () => {
    const h = harness({ provider: pollingProvider([running(10), done()]) });
    const job = h.enqueue();
    h.db.$client.exec(
      "CREATE TRIGGER no_progress BEFORE UPDATE OF progress ON generations WHEN NEW.progress > 0 AND NEW.progress < 100 BEGIN SELECT RAISE(ABORT, 'progress refused'); END;",
    );
    await runOne(h, job.id);
    expect(h.row(job.id).status).toBe('succeeded');
  });
});

describe('canceling while a job runs', () => {
  it('stops polling, cancels upstream and keeps the single refund', async () => {
    const h = harness({
      provider: pollingProvider([running(20), running(40), running(60)], { cancel: true }),
    });
    const job = h.enqueue({ cost: 4 });
    h.provider.poll.mockImplementation(async () => {
      if (h.provider.poll.mock.calls.length === 2) markCanceled(h.db, h.user.id, job.id);
      return running(30);
    });
    await runOne(h, job.id);

    expect(h.provider.poll).toHaveBeenCalledTimes(2);
    expect(h.provider.cancel).toHaveBeenCalledTimes(1);
    expect(h.provider.cancel).toHaveBeenCalledWith('job-1', expect.anything(), { v: 1 });
    expect(h.row(job.id).status).toBe('canceled');
    expect(h.test.db.select().from(assets).all()).toHaveLength(0);
    expect(h.balance()).toBe(50);
    expect(ledgerInOrder(h.db, h.user.id).map((entry) => entry.reason)).toEqual([
      'generation',
      'refund',
    ]);
  });

  it('does not persist anything when the provider finishes right after the cancel', async () => {
    const h = harness({ provider: pollingProvider([running()], { cancel: true }) });
    const job = h.enqueue();
    h.provider.poll.mockImplementation(async () => {
      markCanceled(h.db, h.user.id, job.id);
      return done();
    });
    await runOne(h, job.id);
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.row(job.id).status).toBe('canceled');
    expect(h.balance()).toBe(50);
  });

  it('notices a cancel during a long synchronous call at the next heartbeat', async () => {
    const release = deferred<SubmitResult>();
    let aborted = false;
    const h = harness({
      provider: fakeProvider({
        submit: (_input, ctx) => {
          ctx.signal.addEventListener('abort', () => {
            aborted = true;
            release.reject(ctx.signal.reason);
          });
          return release.promise;
        },
      }),
    });
    const job = h.enqueue();
    const finished = h.runner.tick();
    await h.clock.advance(5000);
    markCanceled(h.db, h.user.id, job.id);
    expect(aborted).toBe(false);
    await h.clock.advance(11_000);
    await finished;

    expect(aborted).toBe(true);
    expect(h.row(job.id).status).toBe('canceled');
    expect(h.balance()).toBe(50);
  });

  it('survives an upstream cancel that fails or hangs on a missing method', async () => {
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => running(),
        cancel: () => {
          throw new Error('upstream cancel exploded');
        },
      }),
    });
    const job = h.enqueue();
    h.provider.poll.mockImplementation(async () => {
      markCanceled(h.db, h.user.id, job.id);
      return running();
    });
    await runOne(h, job.id);
    expect(h.row(job.id).status).toBe('canceled');
    expect(h.logs.lines.some((line) => line.msg === 'Could not cancel the upstream job')).toBe(
      true,
    );
  });

  it('gives the worker slot back when the upstream cancel never answers, with the refund already made', async () => {
    let cancelStartedAt = 0;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => running(),
        cancel: () => {
          cancelStartedAt = h.clock.now();
          return new Promise<void>(() => undefined);
        },
      }),
      env: { WORKER_CONCURRENCY: '1' },
    });
    const job = h.enqueue({ cost: 4 });
    h.provider.poll.mockImplementation(async () => {
      markCanceled(h.db, h.user.id, job.id);
      return running();
    });
    await h.clock.runUntil(h.runner.tick());

    expect(h.row(job.id).status).toBe('canceled');
    expect(h.balance()).toBe(50);
    expect(h.provider.cancel).toHaveBeenCalledTimes(1);
    expect(h.clock.now() - cancelStartedAt).toBe(10_000);
    expect(h.clock.pending()).toEqual([]);

    // The only slot is free again.
    h.provider.submit.mockImplementation(async (input) => ({
      mode: 'sync',
      outputs: [tinyOutput(input.model.kind)],
    }));
    const next = h.enqueue();
    await h.clock.runUntil(h.runner.tick());
    expect(h.row(next.id).status).toBe('succeeded');
  });

  it('does not cancel upstream twice and does not leak a timer when the cancel answers at once', async () => {
    const h = harness({ provider: pollingProvider([running()], { cancel: true }) });
    const job = h.enqueue();
    h.provider.poll.mockImplementation(async () => {
      markCanceled(h.db, h.user.id, job.id);
      return running();
    });
    await runOne(h, job.id);
    expect(h.provider.cancel).toHaveBeenCalledTimes(1);
    expect(h.clock.pending()).toEqual([]);
  });

  it('treats a deleted generation like a canceled one', async () => {
    const h = harness({ provider: pollingProvider([running()], { cancel: true }) });
    const job = h.enqueue();
    h.provider.poll.mockImplementation(async () => {
      h.db.delete(generations).where(eq(generations.id, job.id)).run();
      return running();
    });
    await runOne(h, job.id);
    expect(h.provider.cancel).toHaveBeenCalledTimes(1);
    expect(h.persist).not.toHaveBeenCalled();
  });
});

describe('lease and heartbeat', () => {
  it('extends the lease every 15 seconds while the job runs and stops afterwards', async () => {
    const seen: Array<{ at: number; lease: number }> = [];
    let startedAt = 0;
    const h = harness({
      provider: fakeProvider({
        submit: () => asyncSubmit(),
        poll: () => {
          startedAt ||= h.clock.now();
          seen.push({ at: h.clock.now() - startedAt, lease: h.row(job.id).leaseUntil ?? 0 });
          return h.clock.now() - startedAt < 46_000 ? running() : done();
        },
      }),
    });
    const job = h.enqueue();
    await runOne(h, job.id);

    // Beats at 15, 30 and 45 s: three extensions, each exactly one heartbeat after the last.
    const leases = [...new Set(seen.map((entry) => entry.lease))];
    expect(leases).toHaveLength(4);
    expect(leases.slice(1).map((lease, index) => lease - (leases[index] ?? 0))).toEqual([
      15_000, 15_000, 15_000,
    ]);
    // The lease is never allowed to run out while the job is alive.
    expect(seen.every((entry, index) => entry.lease > startedAt + entry.at || index === 0)).toBe(
      true,
    );
    expect(h.row(job.id).leaseUntil).toBeNull();
    expect(h.clock.pending()).toEqual([]);
  });

  it('keeps a long job alive past its original lease', async () => {
    const h = harness({
      provider: fakeProvider({ submit: () => asyncSubmit(), poll: () => running() }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '300' },
    });
    const job = h.enqueue();
    const finished = h.runner.tick();
    await h.clock.advance(150_000);
    const row = h.row(job.id);
    expect(row.status).toBe('processing');
    expect(row.leaseUntil ?? 0).toBeGreaterThan(h.clock.now());
    // A second runner must not steal it.
    expect(await h.another().tick()).toBe(0);
    await h.clock.runUntil(finished);
    expect(h.row(job.id).status).toBe('failed');
  });

  it('gives way when another worker took the job over, without touching it', async () => {
    const h = harness({
      provider: pollingProvider([running()], { cancel: true }),
      env: { GENERATION_TIMEOUT_SEC_IMAGE: '300' },
    });
    const job = h.enqueue({ cost: 2 });
    const finished = h.runner.tick();
    await h.clock.advance(20_000);
    h.db
      .update(generations)
      .set({ workerId: 'someone-else' })
      .where(eq(generations.id, job.id))
      .run();
    await h.clock.advance(20_000);
    await h.clock.runUntil(finished);

    expect(h.row(job.id)).toMatchObject({ status: 'processing', workerId: 'someone-else' });
    expect(h.provider.cancel).not.toHaveBeenCalled();
    expect(h.persist).not.toHaveBeenCalled();
    expect(h.balance()).toBe(48);
    expect(h.clock.pending()).toEqual([]);
  });

  it('notices a takeover between two polls even before the next heartbeat', async () => {
    const h = harness({ provider: pollingProvider([running()]) });
    const job = h.enqueue();
    h.provider.poll.mockImplementation(async () => {
      h.db
        .update(generations)
        .set({ workerId: 'someone-else' })
        .where(eq(generations.id, job.id))
        .run();
      return running();
    });
    await runOne(h, job.id);
    expect(h.provider.poll).toHaveBeenCalledTimes(1);
    expect(h.row(job.id).workerId).toBe('someone-else');
  });
});

describe('input images', () => {
  async function withInput(h: Harness, overrides: Partial<Parameters<typeof createAsset>[1]> = {}) {
    const asset = createAsset(h.db, { userId: h.user.id, width: 640, height: 480, ...overrides });
    await h.storage.put(asset.storageKey, TINY_PNG, { mimeType: 'image/png' });
    return asset;
  }

  it('loads the uploaded image for submit and for every poll', async () => {
    const h = harness({ provider: pollingProvider([running(), done()]) });
    const asset = await withInput(h);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: asset.id });
    await runOne(h, job.id);

    for (const input of [
      h.provider.submit.mock.calls[0]?.[0],
      h.provider.poll.mock.calls[0]?.[1],
      h.provider.poll.mock.calls[1]?.[1],
    ] as ProviderInput[]) {
      expect(input.inputImage).toMatchObject({ mimeType: 'image/png', width: 640, height: 480 });
      expect([...(input.inputImage?.bytes ?? [])]).toEqual([...TINY_PNG]);
    }
    expect(h.row(job.id).status).toBe('succeeded');
  });

  it('loads the image again when resuming', async () => {
    const h = harness({ provider: pollingProvider([done()]) });
    const asset = await withInput(h);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: asset.id });
    claimNextJob(h.db, 'dead', 60_000, h.clock.now());
    recordSubmitted(h.db, job.id, 'dead', 'remote-1', { v: 1 });
    await h.clock.advance(61_000);
    await runOne(h, job.id);
    expect(h.provider.poll.mock.calls[0]?.[1].inputImage?.bytes.byteLength).toBe(
      TINY_PNG.byteLength,
    );
  });

  it('does not load anything for a text tool', async () => {
    const h = harness();
    const asset = await withInput(h);
    const spy = vi.spyOn(h.storage, 'get');
    h.enqueue({ tool: 'text-to-image', inputAssetId: asset.id });
    await h.runner.tick();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'the file is gone from storage',
      async (h: Harness) => {
        const asset = await withInput(h);
        h.storage.objects.clear();
        return asset.id;
      },
    ],
    [
      'the asset belongs to somebody else',
      async (h: Harness) => {
        const { createUser } = await import('../../helpers/factories');
        const stranger = createUser(h.db);
        const asset = createAsset(h.db, { userId: stranger.id });
        await h.storage.put(asset.storageKey, TINY_PNG, { mimeType: 'image/png' });
        return asset.id;
      },
    ],
  ])('fails with a clear message and a refund when %s', async (_name, arrange) => {
    const h = harness();
    const inputAssetId = await arrange(h);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId, cost: 2 }).id;
    await h.runner.tick();
    expect(h.row(job)).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_input',
      errorMessage: 'The input image is no longer available.',
    });
    expect(h.provider.submit).not.toHaveBeenCalled();
    expect(h.balance()).toBe(50);
  });

  it('fails when the upload was deleted after the generation was queued', async () => {
    const h = harness();
    const asset = await withInput(h);
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: asset.id, cost: 2 });
    h.db.delete(assets).where(eq(assets.id, asset.id)).run();
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'invalid_input' });
    expect(h.balance()).toBe(50);
  });

  it('fails an image tool whose input id was cleared', async () => {
    const h = harness();
    const job = h.enqueue({ tool: 'image-to-image', inputAssetId: null });
    await h.runner.tick();
    expect(h.row(job.id)).toMatchObject({ status: 'failed', errorCode: 'invalid_input' });
  });
});
