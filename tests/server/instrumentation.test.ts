import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { serviceAccountFixture } from './storage/service-account';

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
  (globalThis as Record<symbol, unknown>)[Symbol.for('aivore.storage')] = undefined;
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

describe('register with STORAGE_DRIVER=gcs', () => {
  // A missing key file used to leave a healthy-looking site: /api/health answered 200, generations
  // were accepted and paid for, and the runner retried forever in the log.
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aivore-instrumentation-'));
    vi.stubEnv('STORAGE_DRIVER', 'gcs');
    vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-project.firebasestorage.app');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function keyAt(file: string, valid = true) {
    writeFileSync(file, valid ? JSON.stringify(serviceAccountFixture()) : '{"not":"a key"}');
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', file);
    resetEnvForTests();
  }

  it('stops the start with a one-line error that names the setting, and starts nothing', async () => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', join(dir, 'missing-folder-name', 'key.json'));
    resetEnvForTests();
    const failure = await register().then(
      () => undefined,
      (error: unknown) => error as Error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure?.message).toMatch(/^Storage is not usable \(STORAGE_DRIVER=gcs\): /);
    expect(failure?.message).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
    expect(failure?.message).not.toContain('\n');
    expect(failure?.message).not.toContain('missing-folder-name');
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
    // It is logged once as well, for the people who read the log and not the crash.
    expect(stderr.join('')).toContain('Storage is not usable');
    expect(stderr.join('').split('Storage is not usable')).toHaveLength(2);
  });

  it('ends the process in production, where a register that throws leaves a server answering 500', async () => {
    // `next start` and the standalone server.js both log "Failed to prepare server" and keep
    // listening: a container supervisor sees a running process and never restarts it.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'p'.repeat(40));
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', join(dir, 'missing.json'));
    resetEnvForTests();
    class Exit extends Error {}
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Exit('process.exit');
    });
    await expect(register()).rejects.toThrow(Exit);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    // The reason is already in the log when the process ends.
    expect(stderr.join('')).toContain('Storage is not usable (STORAGE_DRIVER=gcs)');
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
  });

  it('does not end the process outside production, where throwing is what makes it visible', async () => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', join(dir, 'missing.json'));
    resetEnvForTests();
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    await expect(register()).rejects.toThrow('Storage is not usable');
    expect(exit).not.toHaveBeenCalled();
  });

  it('does so whatever the worker mode: the web process needs storage for every request', async () => {
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', join(dir, 'missing.json'));
    for (const mode of ['inline', 'external', 'off']) {
      vi.stubEnv('WORKER_MODE', mode);
      resetEnvForTests();
      await expect(register(), mode).rejects.toThrow('FIREBASE_SERVICE_ACCOUNT_FILE');
    }
  });

  it('stops for a file that is not a service-account key, too', async () => {
    keyAt(join(dir, 'key.json'), false);
    await expect(register()).rejects.toThrow(/FIREBASE_SERVICE_ACCOUNT_FILE/);
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
  });

  it('starts the runner as usual when the key is fine', async () => {
    keyAt(join(dir, 'key.json'));
    await expect(register()).resolves.toBeUndefined();
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledOnce();
    expect(stderr.join('')).toBe('');
  });

  it('does not stop a site on the local disk', async () => {
    vi.stubEnv('STORAGE_DRIVER', 'local');
    resetEnvForTests();
    await expect(register()).resolves.toBeUndefined();
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledOnce();
  });
});
