/**
 * Runs one request per selected creation for the bulk actions. A few run at once; a `429` (writes
 * are limited to 60 a minute) waits and tries that creation again instead of failing it, so a big
 * selection still goes through. Every other error fails only that creation and the rest continue.
 */
import { isApiError } from '@/lib/api-client';
import { retryAfterSeconds } from '@/lib/generations/errors';

export interface BulkFailure {
  id: string;
  error: unknown;
}

export interface BulkResult {
  succeeded: string[];
  failed: BulkFailure[];
}

export interface BulkOptions {
  /** Requests in flight at once. */
  concurrency?: number;
  /** How often one creation is tried again after a `429`. */
  maxRateLimitRetries?: number;
  /** Called after every creation, whatever its outcome. */
  onProgress?: (done: number, total: number) => void;
  /** Called with `true` while the run waits for the rate limit and with `false` when it resumes. */
  onWaiting?: (waiting: boolean) => void;
  /** Waits `ms` milliseconds; replaceable so tests need no real time. */
  wait?: (ms: number) => Promise<void>;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_RETRIES = 4;
/** The window of the write limit is a minute; a quarter of it is a reasonable first wait. */
const DEFAULT_WAIT_MS = 15_000;
const MAX_WAIT_MS = 60_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runBulk(
  ids: readonly string[],
  action: (id: string) => Promise<void>,
  options: BulkOptions = {},
): Promise<BulkResult> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    maxRateLimitRetries = DEFAULT_RETRIES,
    onProgress,
    onWaiting,
    wait = sleep,
  } = options;
  const result: BulkResult = { succeeded: [], failed: [] };
  let next = 0;
  let done = 0;
  let waiting = 0;

  async function attempt(id: string): Promise<void> {
    for (let tries = 0; ; tries += 1) {
      try {
        await action(id);
        result.succeeded.push(id);
        return;
      } catch (error) {
        const limited = isApiError(error) && error.code === 'rate_limited';
        if (!limited || tries >= maxRateLimitRetries) {
          result.failed.push({ id, error });
          return;
        }
        const delay = Math.min((retryAfterSeconds(error) ?? 0) * 1000 || DEFAULT_WAIT_MS, MAX_WAIT_MS);
        waiting += 1;
        onWaiting?.(true);
        await wait(delay);
        waiting -= 1;
        if (waiting === 0) onWaiting?.(false);
      }
    }
  }

  async function worker(): Promise<void> {
    while (next < ids.length) {
      const id = ids[next] as string;
      next += 1;
      await attempt(id);
      done += 1;
      onProgress?.(done, ids.length);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(Math.max(concurrency, 1), ids.length) }, () => worker()),
  );
  return result;
}
