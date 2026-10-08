import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootBillingScheduler } from '@/server/billing/boot';
import {
  isBillingSchedulerRunning,
  startBillingScheduler,
  stopBillingScheduler,
} from '@/server/billing/scheduler';
import { resetEnvForTests } from '@/server/env';
import { createLogger, resetLoggerForTests } from '@/server/logger';

const mocks = vi.hoisted(() => ({ startWorkerWithRetry: vi.fn() }));
vi.mock('@/server/jobs/start', () => ({ startWorkerWithRetry: mocks.startWorkerWithRetry }));

const log = createLogger({ level: 'silent' });

beforeEach(() => {
  mocks.startWorkerWithRetry.mockReset().mockReturnValue(undefined);
  vi.stubEnv('LOG_LEVEL', 'silent');
  resetEnvForTests();
});
afterEach(async () => {
  await stopBillingScheduler();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe('starting the billing scheduler', () => {
  it('starts with the fake gateway outside production, once however often it is asked', () => {
    vi.stubEnv('WORKER_MODE', 'inline');
    resetEnvForTests();

    expect(bootBillingScheduler(log)).toBe(true);
    expect(isBillingSchedulerRunning()).toBe(true);
    startBillingScheduler();
    expect(isBillingSchedulerRunning()).toBe(true);
  });

  it('stays out of tools and tests that run with WORKER_MODE=off', () => {
    vi.stubEnv('WORKER_MODE', 'off');
    resetEnvForTests();

    expect(bootBillingScheduler(log)).toBe(false);
    expect(isBillingSchedulerRunning()).toBe(false);
  });

  it('does nothing while billing is switched off', () => {
    vi.stubEnv('WORKER_MODE', 'inline');
    vi.stubEnv('BILLING_GATEWAY', 'off');
    resetEnvForTests();

    expect(bootBillingScheduler(log)).toBe(false);
    expect(isBillingSchedulerRunning()).toBe(false);
  });

  it('can be stopped, and stopping twice is harmless', async () => {
    startBillingScheduler(10_000);
    await stopBillingScheduler();
    await stopBillingScheduler();
    expect(isBillingSchedulerRunning()).toBe(false);
  });

  it('is started by instrumentation, also when the job runner is external', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('WORKER_MODE', 'external');
    resetEnvForTests();
    const { register } = await import('@/instrumentation');

    await register();

    expect(isBillingSchedulerRunning()).toBe(true);
    expect(mocks.startWorkerWithRetry).not.toHaveBeenCalled();
  });

  it('a failure while starting it is logged and the job runner still starts', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('WORKER_MODE', 'inline');
    vi.stubEnv('LOG_LEVEL', 'error');
    resetEnvForTests();
    resetLoggerForTests();
    const written: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    vi.resetModules();
    vi.doMock('@/server/billing/boot', () => ({
      bootBillingScheduler: () => {
        throw new Error('billing exploded');
      },
    }));
    try {
      const { register } = await import('@/instrumentation');
      await expect(register()).resolves.toBeUndefined();
    } finally {
      vi.doUnmock('@/server/billing/boot');
      resetLoggerForTests();
    }

    expect(written.join('')).toContain('Billing scheduler failed to start');
    expect(mocks.startWorkerWithRetry).toHaveBeenCalledOnce();
  });
});
