import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createJobRunner: vi.fn() }));
vi.mock('@/server/jobs/worker', () => ({ createJobRunner: mocks.createJobRunner }));

import type { JobRunner } from '@/server/jobs/runner';
import {
  isWorkerRunning,
  startWorker,
  startWorkerWithRetry,
  stopWorker,
} from '@/server/jobs/start';
import { recordingLogger } from './support';

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

describe('startWorkerWithRetry', () => {
  /** createJobRunner throws `failures` times (transient boot errors), then hands out a runner. */
  function flaky(failures: number) {
    const runner = fakeRunner();
    let calls = 0;
    mocks.createJobRunner.mockImplementation(() => {
      calls += 1;
      if (calls <= failures) throw new Error(`SQLITE_BUSY ${calls}`);
      return runner;
    });
    return { runner, calls: () => calls };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts at once and schedules nothing when the first try works', () => {
    vi.useFakeTimers();
    const { runner } = flaky(0);
    const { log, lines } = recordingLogger();
    expect(startWorkerWithRetry(log)).toBe(runner);
    expect(vi.getTimerCount()).toBe(0);
    expect(lines).toEqual([]);
    expect(isWorkerRunning()).toBe(true);
  });

  it('keeps trying with growing pauses until the runner starts, and then stops trying', async () => {
    vi.useFakeTimers();
    const { runner, calls } = flaky(3);
    const { log, lines } = recordingLogger();

    expect(startWorkerWithRetry(log)).toBeUndefined();
    expect(isWorkerRunning()).toBe(false);
    expect(calls()).toBe(1);

    await vi.advanceTimersByTimeAsync(999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1); // 1 s
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(2000); // then 2 s
    expect(calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(3999);
    expect(calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(1); // then 4 s: this one works
    expect(calls()).toBe(4);
    expect(runner.start).toHaveBeenCalledOnce();
    expect(isWorkerRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls()).toBe(4);
    expect(vi.getTimerCount()).toBe(0);

    const failures = lines.filter((line) => line.level === 'error');
    expect(failures.map((line) => [line.fields.attempt, line.fields.retryInMs])).toEqual([
      [1, 1000],
      [2, 2000],
      [3, 4000],
    ]);
    expect(
      lines.some((line) => line.level === 'info' && line.msg === 'Inline job runner started'),
    ).toBe(true);
  });

  it('never waits longer than 30 s between tries', async () => {
    vi.useFakeTimers();
    flaky(Infinity);
    const { log, lines } = recordingLogger();
    startWorkerWithRetry(log);
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000 + 8000 + 16_000 + 30_000 + 30_000);
    const delays = lines.map((line) => line.fields.retryInMs);
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('does not stack a second retry loop while one is pending', async () => {
    vi.useFakeTimers();
    const { calls } = flaky(1);
    const { log } = recordingLogger();
    expect(startWorkerWithRetry(log)).toBeUndefined();
    expect(startWorkerWithRetry(log)).toBeUndefined();
    expect(calls()).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls()).toBe(2);
  });

  it('stopWorker() cancels a pending retry', async () => {
    vi.useFakeTimers();
    const { calls } = flaky(Infinity);
    const { log } = recordingLogger();
    startWorkerWithRetry(log);
    expect(vi.getTimerCount()).toBe(1);
    await stopWorker();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls()).toBe(1);
    // A later start is possible again.
    mocks.createJobRunner.mockReturnValue(fakeRunner());
    expect(startWorkerWithRetry(log)).toBeDefined();
  });

  it('never keeps the process alive just to retry', () => {
    const unref = vi.fn();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    flaky(1);
    startWorkerWithRetry(recordingLogger().log);
    expect(unref).toHaveBeenCalledOnce();
  });
});

describe('isWorkerRunning', () => {
  it('follows start and stop', async () => {
    mocks.createJobRunner.mockReturnValue(fakeRunner());
    expect(isWorkerRunning()).toBe(false);
    startWorker();
    expect(isWorkerRunning()).toBe(true);
    await stopWorker();
    expect(isWorkerRunning()).toBe(false);
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
