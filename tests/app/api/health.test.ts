import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@/server/db';
import type { HealthDTO } from '@/lib/api-types';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { invokeRoute } from '../../helpers/http';
import { freshDb } from '../../helpers/db';
import packageJson from '../../../package.json';

const mocks = vi.hoisted(() => ({ failDb: false }));
vi.mock('@/server/db', async (importOriginal) => {
  const original = await importOriginal<typeof DbModule>();
  return {
    ...original,
    getDb: () => {
      if (mocks.failDb) throw new Error('unable to open database file');
      return original.getDb();
    },
  };
});

// Probes must never be throttled: a limiter that fails loudly proves the route does not use it.
vi.mock('@/server/security/rate-limit', () => ({
  getRateLimiter: () => {
    throw new Error('the health route must not consult the rate limiter');
  },
}));

import { GET } from '@/app/api/health/route';

freshDb();

afterEach(() => {
  mocks.failDb = false;
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

describe('GET /api/health', () => {
  it('reports ok with the database, worker mode and package version', async () => {
    vi.stubEnv('WORKER_MODE', 'external');
    resetEnvForTests();
    const { status, json, headers } = await invokeRoute<HealthDTO>(GET, { url: '/api/health' });
    expect(status).toBe(200);
    expect(json).toEqual({
      status: 'ok',
      db: true,
      worker: 'external',
      version: packageJson.version,
    });
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.get('x-request-id')).toBeTruthy();
  });

  it('is not wrapped in the { data } envelope', async () => {
    const { json } = await invokeRoute<Record<string, unknown>>(GET);
    expect(json).not.toHaveProperty('data');
  });

  it('is exempt from the general rate limit, however often it is probed', async () => {
    for (let probe = 0; probe < 3; probe += 1) {
      expect((await invokeRoute(GET)).status).toBe(200);
    }
  });

  it('answers anonymous probes that carry no credentials', async () => {
    const { status } = await invokeRoute(GET, { headers: { 'user-agent': 'docker-healthcheck' } });
    expect(status).toBe(200);
  });

  it('answers 503 with db:false when the database cannot be opened', async () => {
    mocks.failDb = true;
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { status, json } = await invokeRoute<HealthDTO>(GET);
    expect(status).toBe(503);
    expect(json).toMatchObject({ status: 'error', db: false, version: packageJson.version });
  });
});
