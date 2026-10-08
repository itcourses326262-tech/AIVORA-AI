import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProviderError, ProviderError } from '@/server/providers/errors';
import { mockProvider } from '@/server/providers/mock';
import {
  SLOW_LATENCY_MS,
  latencyFor,
  parseTriggers,
  progressAt,
  stripTriggers,
} from '@/server/providers/mock/job';
import type { PollResult, SubmitResult } from '@/server/providers/types';
import { fakeProviderContext } from '../../../helpers/fakes';
import { captureContext, forbidNetwork, mockInput, useFakeClock } from './fixtures';

const START = 1_800_000_000_000;

beforeEach(() => {
  useFakeClock();
  forbidNetwork();
});
afterEach(() => vi.useRealTimers());

type AsyncSubmit = Extract<SubmitResult, { mode: 'async' }>;

async function submitAsync(input = mockInput('text-to-image')): Promise<AsyncSubmit> {
  const result = await mockProvider.submit(input, captureContext().context);
  if (result.mode !== 'async') throw new Error('expected an async job');
  return result;
}

const durationOf = (job: AsyncSubmit) => (job.meta as { durationMs: number }).durationMs;

function poll(job: AsyncSubmit, input = mockInput('text-to-image')): Promise<PollResult> {
  return mockProvider.poll(job.providerJobId, input, captureContext().context, job.meta);
}

const withPrompt = (tool: Parameters<typeof mockInput>[0], prompt: string) =>
  mockInput(tool, { prompt });

describe('submit', () => {
  it('returns an async job whose meta is plain JSON and carries what poll needs', async () => {
    const job = await submitAsync();
    expect(job.providerJobId).toMatch(/^mock_[0-9a-z]+_[0-9a-z]+$/);
    expect(job.meta).toMatchObject({ v: 1, startedAt: START, seed: 7, outcome: 'ok' });
    expect(JSON.parse(JSON.stringify(job.meta))).toEqual(job.meta);
  });

  it('gives each job its own id even for the same request', async () => {
    const first = await submitAsync();
    vi.setSystemTime(START + 5);
    const second = await submitAsync();
    expect(second.providerJobId).not.toBe(first.providerJobId);
  });
});

describe('simulated latency', () => {
  it('is 2.5 to 4 seconds for images and 7 to 10 seconds for videos, chosen from the seed', () => {
    const none = parseTriggers('plain');
    const images = new Set<number>();
    const videos = new Set<number>();
    for (let seed = 0; seed < 200; seed++) {
      const image = latencyFor('image', seed, none);
      const video = latencyFor('video', seed, none);
      expect(image).toBeGreaterThanOrEqual(2500);
      expect(image).toBeLessThanOrEqual(4000);
      expect(video).toBeGreaterThanOrEqual(7000);
      expect(video).toBeLessThanOrEqual(10_000);
      expect(latencyFor('image', seed, none)).toBe(image);
      images.add(image);
      videos.add(video);
    }
    expect(images.size).toBeGreaterThan(50);
    expect(videos.size).toBeGreaterThan(50);
  });

  it('is what submit reports', async () => {
    for (const [tool, min, max] of [
      ['text-to-image', 2500, 4000],
      ['text-to-video', 7000, 10_000],
    ] as const) {
      const job = await submitAsync(mockInput(tool));
      expect(durationOf(job)).toBeGreaterThanOrEqual(min);
      expect(durationOf(job)).toBeLessThanOrEqual(max);
    }
  });
});

describe('poll', () => {
  it('is stateless: progress follows the clock, then the job succeeds', async () => {
    const job = await submitAsync();
    const duration = durationOf(job);

    expect(await poll(job)).toEqual({ status: 'running', progress: 0 });
    const seen: number[] = [];
    for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.99]) {
      vi.setSystemTime(START + Math.floor(duration * fraction));
      const result = await poll(job);
      expect(result.status).toBe('running');
      seen.push((result as { progress: number }).progress);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen[0]).toBeGreaterThanOrEqual(9);
    expect(seen[2]).toBeGreaterThanOrEqual(49);
    expect(seen[2]).toBeLessThanOrEqual(50);
    expect(seen.at(-1)).toBeLessThanOrEqual(99);

    vi.setSystemTime(START + duration - 1);
    expect((await poll(job)).status).toBe('running');
    vi.setSystemTime(START + duration);
    const done = await poll(job);
    expect(done.status).toBe('succeeded');
    expect(done.status === 'succeeded' && done.outputs).toHaveLength(1);
  }, 30_000);

  it('answers the same from a freshly started process (a worker restart loses nothing)', async () => {
    const input = mockInput('text-to-image');
    const job = await submitAsync(input);
    const storedMeta = JSON.parse(JSON.stringify(job.meta)) as Record<string, unknown>;
    vi.setSystemTime(START + durationOf(job) / 2);

    vi.resetModules();
    const { mockProvider: restarted } = await import('@/server/providers/mock');
    expect(restarted).not.toBe(mockProvider);
    const midway = await restarted.poll(
      job.providerJobId,
      input,
      captureContext().context,
      storedMeta,
    );
    expect(midway).toMatchObject({ status: 'running' });
    expect((midway as { progress: number }).progress).toBeGreaterThanOrEqual(49);

    vi.setSystemTime(START + durationOf(job) + 60_000);
    const done = await restarted.poll(
      job.providerJobId,
      input,
      captureContext().context,
      storedMeta,
    );
    expect(done.status).toBe('succeeded');
  }, 30_000);

  it('keeps answering succeeded, with the same picture, if polled again', async () => {
    const input = mockInput('text-to-image');
    const job = await submitAsync(input);
    vi.setSystemTime(START + durationOf(job) + 1000);
    const first = await poll(job, input);
    const second = await poll(job, input);
    expect(first.status).toBe('succeeded');
    const bytes = (result: PollResult) =>
      result.status === 'succeeded' ? Buffer.from(result.outputs[0]!.bytes!) : Buffer.alloc(0);
    expect(bytes(first).equals(bytes(second))).toBe(true);
  }, 30_000);

  it('is not fooled by a clock that moved backwards', async () => {
    const job = await submitAsync();
    vi.setSystemTime(START - 10_000);
    expect(await poll(job)).toEqual({ status: 'running', progress: 0 });
    expect(progressAt({ v: 1, startedAt: 5000, durationMs: 0, seed: 1, outcome: 'ok' }, 9999)).toBe(
      0,
    );
  });

  it('reports a failure, not a crash, when its metadata is missing or damaged', async () => {
    const input = mockInput('text-to-image');
    const broken: unknown[] = [
      undefined,
      {},
      { v: 1, startedAt: 'yesterday', durationMs: 5, seed: 1, outcome: 'ok' },
      { v: 1, startedAt: START, durationMs: -5, seed: 1, outcome: 'ok' },
      { v: 1, startedAt: START, durationMs: 5, seed: 1, outcome: 'teapot' },
      { v: 2, startedAt: START, durationMs: 5, seed: 1, outcome: 'ok' },
    ];
    for (const meta of broken) {
      const result = await mockProvider.poll(
        'mock_x',
        input,
        captureContext().context,
        meta as Record<string, unknown> | undefined,
      );
      expect(result.status).toBe('failed');
      const error = (result as { error: ProviderError }).error;
      expect(isProviderError(error)).toBe(true);
      expect(error).toMatchObject({ code: 'unknown', retryable: false });
    }
  });

  it('stops promptly when the job is canceled while it renders', async () => {
    const input = mockInput('text-to-video');
    const job = await submitAsync(input);
    vi.setSystemTime(START + durationOf(job));
    const controller = new AbortController();
    const reason = new Error('canceled by the engine');
    const polling = mockProvider.poll(
      job.providerJobId,
      input,
      captureContext({ signal: controller.signal }).context,
      job.meta,
    );
    controller.abort(reason);
    await expect(polling).rejects.toBe(reason);
  }, 30_000);

  it('does not hand out outputs for a sync-only request through poll', async () => {
    const job = await submitAsync();
    expect((await poll(job)).status).toBe('running');
  });
});

describe('failure injection', () => {
  const tools = ['text-to-image', 'text-to-video'] as const;

  it.each(tools)(
    '__fail__ ends in failed(unavailable, not retryable) after the delay (%s)',
    async (tool) => {
      const input = withPrompt(tool, 'a lake __fail__');
      const job = await submitAsync(input);
      expect(job.meta).toMatchObject({ outcome: 'fail' });

      vi.setSystemTime(START + durationOf(job) - 1);
      expect((await poll(job, input)).status).toBe('running');

      vi.setSystemTime(START + durationOf(job));
      const result = await poll(job, input);
      expect(result.status).toBe('failed');
      const error = (result as { error: ProviderError }).error;
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'unavailable', retryable: false });
      expect(error.userMessage.length).toBeGreaterThan(10);
    },
  );

  it.each(tools)(
    '__content__ ends in failed(content_policy) after the delay (%s)',
    async (tool) => {
      const input = withPrompt(tool, '__content__ a lake');
      const job = await submitAsync(input);
      vi.setSystemTime(START + durationOf(job) - 1);
      expect((await poll(job, input)).status).toBe('running');
      vi.setSystemTime(START + durationOf(job));
      const result = await poll(job, input);
      expect(result.status).toBe('failed');
      expect((result as { error: ProviderError }).error).toMatchObject({
        code: 'content_policy',
        retryable: false,
      });
    },
  );

  it('lets content_policy win when both failure triggers are present', async () => {
    const input = withPrompt('text-to-image', '__fail__ __content__');
    const job = await submitAsync(input);
    vi.setSystemTime(START + durationOf(job));
    const result = await poll(job, input);
    expect((result as { error: ProviderError }).error.code).toBe('content_policy');
  });

  it.each(tools)('__slow__ takes 25 seconds (%s)', async (tool) => {
    const input = withPrompt(tool, 'a lake __slow__ __fail__');
    const job = await submitAsync(input);
    expect(durationOf(job)).toBe(SLOW_LATENCY_MS);
    expect(SLOW_LATENCY_MS).toBe(25_000);
    vi.setSystemTime(START + 24_999);
    expect(await poll(job, input)).toMatchObject({ status: 'running', progress: 99 });
    vi.setSystemTime(START + 25_000);
    expect((await poll(job, input)).status).toBe('failed');
  });

  it('__sync__ returns the outputs from submit, with no job to poll', async () => {
    const input = withPrompt('text-to-image', 'a lake __sync__');
    const result = await mockProvider.submit(input, captureContext().context);
    expect(result.mode).toBe('sync');
    if (result.mode !== 'sync') return;
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ kind: 'image', mimeType: 'image/webp', seed: 7 });
    expect(result.outputs[0]?.bytes?.byteLength).toBeGreaterThan(1000);
  }, 30_000);

  it('__sync__ combined with a failure trigger fails right in submit', async () => {
    const fail = mockProvider.submit(
      withPrompt('text-to-image', '__sync__ __fail__'),
      captureContext().context,
    );
    await expect(fail).rejects.toMatchObject({ code: 'unavailable', retryable: false });
    const content = mockProvider.submit(
      withPrompt('text-to-video', '__sync__ __content__'),
      captureContext().context,
    );
    await expect(content).rejects.toMatchObject({ code: 'content_policy', retryable: false });
  });

  it('matches triggers case-insensitively and only in the prompt', async () => {
    expect(parseTriggers('x __FAIL__ y')).toMatchObject({ fail: true });
    expect(parseTriggers('x __Slow__')).toMatchObject({ slow: true });
    const input = mockInput('text-to-image', { negativePrompt: '__fail__ __slow__ __sync__' });
    const job = await submitAsync(input);
    expect(job.meta).toMatchObject({ outcome: 'ok' });
    expect(durationOf(job)).toBeLessThanOrEqual(4000);
  });

  it('does not mistake look-alike words for triggers', () => {
    for (const text of ['fail', '_fail_', '__fails__', 'slow', '__ fail __', 'content']) {
      expect(parseTriggers(text)).toEqual({
        fail: false,
        content: false,
        slow: false,
        sync: false,
      });
    }
  });

  it('strips the trigger words from the text the artwork is based on', () => {
    expect(stripTriggers('a  lake __FAIL__ at dawn __sync__')).toBe('a lake at dawn');
    expect(stripTriggers('plain')).toBe('plain');
  });
});

describe('cancel', () => {
  it('resolves and changes nothing', async () => {
    const job = await submitAsync();
    await expect(
      mockProvider.cancel?.(job.providerJobId, captureContext().context, job.meta),
    ).resolves.toBeUndefined();
    expect((await poll(job)).status).toBe('running');
  });
});

describe('isolation and hygiene', () => {
  it('never touches the network, however the job ends', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('network is off')));
    const context = captureContext({ fetch: fetch as unknown as typeof globalThis.fetch }).context;
    const input = mockInput('text-to-image');
    const job = await mockProvider.submit(input, context);
    if (job.mode !== 'async') throw new Error('expected async');
    vi.setSystemTime(START + durationOf(job));
    await mockProvider.poll(job.providerJobId, input, context, job.meta);
    expect(fetch).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  }, 30_000);

  it('never writes the prompt (or the negative prompt) to any log line', async () => {
    const secret = 'PROMPT-SECRET-4711';
    const negative = 'NEGATIVE-SECRET-0815';
    const { lines, context } = captureContext();
    const input = mockInput('text-to-image', {
      prompt: `${secret} __sync__`,
      negativePrompt: negative,
    });
    await mockProvider.submit(input, context);
    const asyncInput = { ...input, prompt: secret };
    const job = await mockProvider.submit(asyncInput, context);
    if (job.mode !== 'async') throw new Error('expected async');
    vi.setSystemTime(START + durationOf(job));
    await mockProvider.poll(job.providerJobId, asyncInput, context, job.meta);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(secret);
      expect(line).not.toContain(negative);
      expect(line).not.toContain('SECRET');
    }
    const loud = lines.filter((line) => /"level":"(info|warn|error)"/.test(line));
    expect(loud).toEqual([]);
  }, 30_000);

  it('survives fake timers of every kind: rendering never waits on a timer', async () => {
    vi.useFakeTimers();
    const input = mockInput('text-to-video', { prompt: 'a lake __sync__' });
    const result = await mockProvider.submit(
      { ...input, params: { ...input.params, aspectRatio: '1:1' } },
      fakeProviderContext(),
    );
    expect(result.mode).toBe('sync');
  }, 30_000);
});
