import { vi } from 'vitest';

/**
 * `useRouter` of the page under test: `push` and `replace` record where it wanted to go. It lives
 * in a module of its own because the `next/navigation` mock imports it while the components that
 * use the mock are still being imported by `support.tsx`.
 */
export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  back: vi.fn(),
  prefetch: vi.fn(),
};

export function resetRouter() {
  for (const fn of Object.values(router)) fn.mockReset();
}
