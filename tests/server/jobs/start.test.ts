import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createJobRunner: vi.fn() }));
vi.mock('@/server/jobs/worker', () => ({ createJobRunner: mocks.createJobRunner }));

import type { JobRunner } from '@/server/jobs/runner';
import { startWorker, stopWorker } from '@/server/jobs/start';

function fakeRunner() {
  return {
    workerId: 'worker-test',
    start: vi.fn(),
    stop: vi.fn(async () => undefined),
  } satisfies Partial<JobRunner>;
}

beforeEach(async () => {
  mocks.createJobRunner.mockReset();
  await stopWorker();
});

afterEach(async () => {
  await stopWorker();
});

describe('startWorker', () => {
  it('creates and starts one runner and returns the same one afterwards', () => {
    const runner = fakeRunner();
    mocks.createJobRunner.mockReturnValue(runner);
    expect(startWorker()).toBe(runner);
    expect(startWorker()).toBe(runner);
    expect(mocks.createJobRunner).toHaveBeenCalledOnce();
    expect(runner.start).toHaveBeenCalledOnce();
  });

  it('does not keep a runner that failed to start, so a later call can retry', () => {
    const broken = fakeRunner();
    broken.start.mockImplementation(() => {
      throw new Error('boom');
    });
    const healthy = fakeRunner();
    mocks.createJobRunner.mockReturnValueOnce(broken).mockReturnValueOnce(healthy);
    expect(() => startWorker()).toThrow('boom');
    expect(startWorker()).toBe(healthy);
  });
});

describe('stopWorker', () => {
  it('stops the running runner and allows a fresh start', async () => {
    const first = fakeRunner();
    const second = fakeRunner();
    mocks.createJobRunner.mockReturnValueOnce(first).mockReturnValueOnce(second);
    startWorker();
    await stopWorker();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(startWorker()).toBe(second);
  });

  it('is a no-op when nothing runs', async () => {
    await expect(stopWorker()).resolves.toBeUndefined();
  });
});
