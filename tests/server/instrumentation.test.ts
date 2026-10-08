import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';

const mocks = vi.hoisted(() => ({ startWorker: vi.fn() }));
vi.mock('@/server/jobs/start', () => ({ startWorker: mocks.startWorker }));

import { register } from '@/instrumentation';

let stderr: string[];

beforeEach(() => {
  mocks.startWorker.mockReset().mockReturnValue({ workerId: 'worker-test' });
  stderr = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
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
    expect(mocks.startWorker).toHaveBeenCalledOnce();
  });

  it.each(['off', 'external'])('does nothing when WORKER_MODE=%s', async (mode) => {
    vi.stubEnv('WORKER_MODE', mode);
    resetEnvForTests();
    await register();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it('does nothing outside the Node.js runtime', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(mocks.startWorker).not.toHaveBeenCalled();
  });

  it('logs and carries on when the runner cannot start, so the app still boots', async () => {
    mocks.startWorker.mockImplementation(() => {
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
    expect(mocks.startWorker).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain('WORKER_CONCURRENCY');
  });
});
