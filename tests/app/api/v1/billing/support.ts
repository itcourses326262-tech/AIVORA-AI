import { afterEach, beforeEach, vi } from 'vitest';
import { createApiKey } from '@/server/auth/api-keys';
import type { Db } from '@/server/db';
import { resetEnvForTests } from '@/server/env';
import { setRateLimiter } from '@/server/security/rate-limit';
import { createSession, createUser } from '../../../../helpers/factories';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

/** Fresh rate-limit counters (limits ARE on in these tests) and env for every test. */
export function routeTestState(): void {
  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_DISABLED', 'false');
    resetEnvForTests();
    setRateLimiter(null);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
    setRateLimiter(null);
  });
}

export interface Caller {
  userId: string;
  /** A browser session: cookie plus a matching Origin. */
  browser: Record<string, string>;
  /** A developer's API key. */
  bearer: Record<string, string>;
}

export async function caller(
  db: Db,
  overrides: Parameters<typeof createUser>[1] = {},
): Promise<Caller> {
  const user = createUser(db, { creditBalance: 0, ...overrides });
  const session = createSession(db, user.id);
  const { key } = await createApiKey(user.id, 'test key');
  return { userId: user.id, browser: session.headers, bearer: { authorization: `Bearer ${key}` } };
}
