import 'server-only';
import { and, asc, gt, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import type { DbOrTx } from '@/server/db';
import { generations } from '@/server/db/schema';
import { getLogger } from '@/server/logger';

/*
 * Cost protection: DAILY_UPSTREAM_BUDGET_CREDITS caps what the platform can owe its paid providers
 * in a rolling day, whatever the users' balances say (free sign-up credits, a bug, an abuser with
 * many accounts). It is checked inside the same transaction that debits the user and inserts the
 * generation, so concurrent requests cannot overshoot it together.
 *
 * What counts as committed: the `cost` of every generation on a PAID provider (anything but the
 * Demo provider) created in the last 24 hours whose status is not `failed` or `canceled`, i.e.
 * queued, processing and succeeded. Failed and canceled generations are refunded in full, so they
 * free their share the moment they end, and a refund never opens more room than the generation
 * took. A partial refund (fewer pictures than paid for) keeps the full cost committed: it is the
 * conservative reading, and the provider usually bills the request, not the pictures that arrived.
 */

export const BUDGET_WINDOW_MS = 24 * 60 * 60 * 1000;
/** `Retry-After` bounds: the estimate is a hint, not a promise (jobs also free room by ending). */
export const MIN_RETRY_AFTER_SEC = 60;
export const MAX_RETRY_AFTER_SEC = 60 * 60;
/** Oldest committed rows read when estimating when room appears; beyond this the maximum is used. */
const ESTIMATE_SCAN_LIMIT = 5000;
const LOG_EVERY_MS = 60_000;

const COMMITTED_STATUSES = ['queued', 'processing', 'succeeded'] as const;

function committedSince(now: number) {
  return and(
    ne(generations.provider, 'mock'),
    inArray(generations.status, COMMITTED_STATUSES),
    gt(generations.createdAt, now - BUDGET_WINDOW_MS),
  );
}

/** Credits committed to paid generations created in the last 24 hours before `now`. */
export function committedUpstreamCredits(db: DbOrTx, now: number = Date.now()): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${generations.cost}), 0)` })
    .from(generations)
    .where(committedSince(now))
    .get();
  return row?.total ?? 0;
}

/** Seconds until enough of the oldest committed generations leave the window for `excess` to fit. */
function estimateRetryAfterSec(db: DbOrTx, now: number, excess: number): number {
  const oldest = db
    .select({ createdAt: generations.createdAt, cost: generations.cost })
    .from(generations)
    .where(committedSince(now))
    .orderBy(asc(generations.createdAt))
    .limit(ESTIMATE_SCAN_LIMIT)
    .all();
  let freed = 0;
  for (const row of oldest) {
    freed += row.cost;
    if (freed >= excess) {
      const seconds = Math.ceil((row.createdAt + BUDGET_WINDOW_MS - now) / 1000);
      return Math.min(MAX_RETRY_AFTER_SEC, Math.max(MIN_RETRY_AFTER_SEC, seconds));
    }
  }
  return MAX_RETRY_AFTER_SEC;
}

let lastLoggedAt = 0;

export interface UpstreamBudgetCheck {
  /** The new request's cost in credits. */
  cost: number;
  /** DAILY_UPSTREAM_BUDGET_CREDITS; 0 or less disables the guard. */
  budget: number;
  now?: number;
}

/**
 * Throws `service_busy` (503, `details.retryAfterSec`) when the credits already committed to paid
 * generations in the last 24 hours plus `cost` would exceed `budget`; exactly reaching it is fine.
 * Call it only for paid providers, inside the transaction that inserts the generation.
 */
export function assertWithinUpstreamBudget(db: DbOrTx, check: UpstreamBudgetCheck): void {
  const { cost, budget } = check;
  if (budget <= 0) return;
  const now = check.now ?? Date.now();
  const committed = committedUpstreamCredits(db, now);
  if (committed + cost <= budget) return;

  // One line a minute at most: a busy service would otherwise log every refused request.
  if (now - lastLoggedAt >= LOG_EVERY_MS || now < lastLoggedAt) {
    lastLoggedAt = now;
    getLogger().warn('Daily upstream budget reached; refusing new paid generations', {
      component: 'generations',
      budget,
      committed,
      cost,
    });
  }
  throw AppError.of('service_busy', 'The service is at capacity right now. Try again later.', {
    retryAfterSec: estimateRetryAfterSec(db, now, committed + cost - budget),
  });
}

/** Lets tests start with a fresh log throttle. */
export function resetBudgetLogForTests(): void {
  lastLoggedAt = 0;
}
