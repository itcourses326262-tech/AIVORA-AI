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
    abandon: vi.fn(() => 0),
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

describe('the exit hook', () => {
  it('hands the running jobs back when the process exits, and not after the runner was stopped', async () => {
    const runner = fakeRunner();
    mocks.createJobRunner.mockReturnValue(runner);
    const before = process.listenerCount('exit');
    startWorker();
    expect(process.listenerCount('exit')).toBe(before + 1);

    const [hook] = process.listeners('exit').slice(-1);
    (hook as () => void)();
    expect(runner.abandon).toHaveBeenCalledTimes(1);

    await stopWorker();
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('survives a database that is already closed at exit', () => {
    const runner = fakeRunner();
    runner.abandon.mockImplementation(() => {
      throw new Error('The database connection is not open');
    });
    mocks.createJobRunner.mockReturnValue(runner);
    startWorker();
    const [hook] = process.listeners('exit').slice(-1);
    expect(() => (hook as () => void)()).not.toThrow();
  });
});
