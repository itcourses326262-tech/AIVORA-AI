import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '@/server/db';
import type { HealthDTO } from '@/lib/api-types';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { invokeRoute } from '../../helpers/http';
import { freshDb } from '../../helpers/db';
import packageJson from '../../../package.json';
import { serviceAccountFixture } from '../../server/storage/service-account';

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
  (globalThis as Record<symbol, unknown>)[Symbol.for('aivore.storage')] = undefined;
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

  describe('with STORAGE_DRIVER=gcs', () => {
    function gcs(keyFile: string) {
      vi.stubEnv('WORKER_MODE', 'inline');
      vi.stubEnv('STORAGE_DRIVER', 'gcs');
      vi.stubEnv('FIREBASE_STORAGE_BUCKET', 'demo-project.firebasestorage.app');
      vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '');
      vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_FILE', keyFile);
      resetEnvForTests();
    }

    it('answers 503 and storage:false when the key file is gone, and logs why', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'aivore-health-'));
      const lines: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });
      try {
        gcs(join(dir, 'missing-folder-name.json'));
        const { status, json } = await invokeRoute<HealthDTO>(GET);
        expect(status).toBe(503);
        expect(json).toEqual({
          status: 'error',
          db: true,
          worker: 'inline',
          version: packageJson.version,
          storage: false,
        });
        const logged = lines.join('');
        expect(logged).toContain('Health check: Storage is not usable (STORAGE_DRIVER=gcs)');
        expect(logged).toContain('FIREBASE_SERVICE_ACCOUNT_FILE');
        expect(logged).not.toContain('missing-folder-name');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('is healthy again as soon as the file is there, and says nothing about storage', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'aivore-health-'));
      try {
        const file = join(dir, 'key.json');
        gcs(file);
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        expect((await invokeRoute<HealthDTO>(GET)).status).toBe(503);
        writeFileSync(file, JSON.stringify(serviceAccountFixture()));
        const { status, json } = await invokeRoute<HealthDTO>(GET);
        expect(status).toBe(200);
        expect(json).toEqual({
          status: 'ok',
          db: true,
          worker: 'inline',
          version: packageJson.version,
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('keeps reporting a database failure as before when storage is fine too', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'aivore-health-'));
      try {
        const file = join(dir, 'key.json');
        writeFileSync(file, JSON.stringify(serviceAccountFixture()));
        gcs(file);
        mocks.failDb = true;
        vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const { status, json } = await invokeRoute<HealthDTO>(GET);
        expect(status).toBe(503);
        expect(json).toMatchObject({ status: 'error', db: false });
        expect(json).not.toHaveProperty('storage');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
