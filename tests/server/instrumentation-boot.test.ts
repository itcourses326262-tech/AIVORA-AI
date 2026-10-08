import { afterEach, describe, expect, it, vi } from 'vitest';

// The app must come up even when the logger itself cannot be loaded.
describe('register when everything is broken', () => {
  afterEach(() => {
    vi.doUnmock('@/server/logger');
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('never rejects, and says so on the console', async () => {
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.resetModules();
    vi.doMock('@/server/logger', () => {
      throw new Error('logger is unavailable');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register } = await import('@/instrumentation');
    await expect(register()).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});
