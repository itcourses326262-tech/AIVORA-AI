import { afterEach, beforeEach, vi } from 'vitest';
import type { GenerationDTO, Page } from '@/lib/api-types';
import { createApiKey } from '@/server/auth/api-keys';
import type { Db } from '@/server/db';
import { resetEnvForTests } from '@/server/env';
import { setRateLimiter } from '@/server/security/rate-limit';
import { createSession, createUser } from '../../../../helpers/factories';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export type One = { data: GenerationDTO } & ErrorBody;
export type Many = Page<GenerationDTO> & ErrorBody;

/** Fresh rate-limit counters and env for every test, and the env restored afterwards. */
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

export function stubEnv(values: Record<string, string>): void {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  resetEnvForTests();
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
  const user = createUser(db, overrides);
  const session = createSession(db, user.id);
  const { key } = await createApiKey(user.id, 'test key');
  return { userId: user.id, browser: session.headers, bearer: { authorization: `Bearer ${key}` } };
}

export const IMAGE_BODY = {
  tool: 'text-to-image',
  modelId: 'aivore-demo-image',
  prompt: 'A lighthouse at dawn',
} as const;
