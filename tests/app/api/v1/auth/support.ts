import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { UserDTO } from '@/lib/api-types';
import { resetEnvForTests } from '@/server/env';
import { setRateLimiter } from '@/server/security/rate-limit';
import type { InvokeResult } from '../../../../helpers/http';

export const APP_URL = 'http://localhost:3000';
export const PASSWORD = 'correct horse battery staple';

/** Every route test starts with empty rate-limit counters and restores any env it stubbed. */
export function routeTestState(): void {
  // Real scrypt runs (about 200 ms each, several times that under a loaded CI box) add up.
  vi.setConfig({ testTimeout: 60_000 });
  beforeEach(() => {
    // A developer's shell may have RATE_LIMIT_DISABLED=true; these tests are about the limits.
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

/** Headers of a browser request on the same origin, optionally carrying a cookie. */
export function browser(
  cookie?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return { origin: APP_URL, ...(cookie ? { cookie } : {}), ...extra };
}

export interface ParsedCookie {
  name: string;
  value: string;
  attributes: Map<string, string>;
  raw: string;
}

export function setCookies(result: Pick<InvokeResult, 'headers'>): ParsedCookie[] {
  return result.headers.getSetCookie().map((raw) => {
    const [pair = '', ...rest] = raw.split('; ');
    const separator = pair.indexOf('=');
    return {
      name: pair.slice(0, separator),
      value: pair.slice(separator + 1),
      attributes: new Map(
        rest.map((part) => {
          const index = part.indexOf('=');
          return index < 0
            ? ([part.toLowerCase(), ''] as const)
            : ([part.slice(0, index).toLowerCase(), part.slice(index + 1)] as const);
        }),
      ),
      raw,
    };
  });
}

export function cookieNamed(result: Pick<InvokeResult, 'headers'>, name: string): ParsedCookie {
  const found = setCookies(result).find((cookie) => cookie.name === name);
  expect(found, `Set-Cookie ${name}`).toBeDefined();
  return found as ParsedCookie;
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function expectUserDTO(value: unknown): asserts value is UserDTO {
  expect(value).toMatchObject({
    id: expect.stringMatching(/^usr_/),
    email: expect.any(String),
    name: expect.any(String),
    role: expect.stringMatching(/^(user|admin)$/),
    locale: expect.stringMatching(/^(ar|en)$/),
    creditBalance: expect.any(Number),
    createdAt: expect.any(Number),
  });
  expect(Object.keys(value as object).sort()).toEqual([
    'createdAt',
    'creditBalance',
    'email',
    'id',
    'locale',
    'name',
    'role',
  ]);
}
