import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';

const mocks = vi.hoisted(() => ({ startWorkerWithRetry: vi.fn() }));
vi.mock('@/server/jobs/start', () => ({ startWorkerWithRetry: mocks.startWorkerWithRetry }));

import { register } from '@/instrumentation';

let stderr: string[];
let stdout: string[];

beforeEach(() => {
  mocks.startWorkerWithRetry.mockReset().mockReturnValue({ workerId: 'worker-test' });
  stderr = [];
  stdout = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('WORKER_MODE', 'inline');
  vi.stubEnv('LOG_LEVEL', 'info');
  resetEnvForTests();
  resetLoggerForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

describe('register', () => {
  it('starts the runner in the Node.js runtime when WORKER_MODE=inline', async () => {
    await register();
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledOnce();
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Function) }), // the logger the retries report to
    );
    expect(stdout.join('')).toContain('Inline job runner started');
    expect(stderr.join('')).toBe('');
  });

  it('does not claim a runner is up when the first try failed and a retry was scheduled', async () => {
    mocks.startWorkerWithRetry.mockReturnValue(undefined);
    await register();
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledOnce();
    expect(stdout.join('')).not.toContain('Inline job runner started');
  });

  it.each(['off', 'external'])('does nothing when WORKER_MODE=%s', async (mode) => {
    vi.stubEnv('WORKER_MODE', mode);
    resetEnvForTests();
    await register();
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
  });

  it('does nothing outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
  });

  it('logs and carries on when the runner cannot start, so the app still boots', async () => {
    mocks.startWorkerWithRetry.mockImplementation(() => {
      throw new Error('runner exploded');
    });
    await expect(register()).resolves.toBeUndefined();
    const logged = stderr.join('');
    expect(logged).toContain('Inline job runner failed to start');
    expect(logged).toContain('runner exploded');
  });

  it('logs and carries on when the configuration is invalid', async () => {
    vi.stubEnv('WORKER_CONCURRENCY', 'many');
    resetEnvForTests();
    await expect(register()).resolves.toBeUndefined();
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('WORKER_CONCURRENCY');
  });
});
