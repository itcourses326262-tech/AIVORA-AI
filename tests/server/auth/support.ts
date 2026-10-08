import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { resetEnvForTests } from '@/server/env';
import { setRateLimiter } from '@/server/security/rate-limit';
import { hashPassword } from '@/server/auth/password';

export const GOOD_PASSWORD = 'correct horse battery staple';

let cachedHash: string | undefined;

/** One real scrypt hash of {@link GOOD_PASSWORD} per test file; hashing is the slow part. */
export function usePasswordFixture(): { readonly hash: string } {
  beforeAll(async () => {
    cachedHash = await hashPassword(GOOD_PASSWORD);
  });
  return {
    get hash() {
      if (!cachedHash) throw new Error('password fixture not ready');
      return cachedHash;
    },
  };
}

/** Fresh rate-limit counters for every test, and env stubs undone afterwards. */
export function useCleanSecurityState(): void {
  beforeEach(() => {
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
