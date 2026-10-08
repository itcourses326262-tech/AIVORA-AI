// OWNER: engine — replace this stub
import 'server-only';
import { NotImplementedError } from '@/lib/errors';
import type { Db } from '@/server/db';
import type { GenerationRow } from '@/server/db/schema';
import type { PersistedOutput } from '@/server/uploads';

// Every state change is a compare-and-set on (id, status[, workerId]) inside a synchronous
// transaction; each function returns false when the row was not in the expected state. The `db`
// argument comes first, like the credits functions, so the runner and tests choose the connection.
// `now` (epoch ms) exists for deterministic lease tests.

/**
 * Atomically takes the oldest `queued` generation, or a `processing` one whose lease expired, for
 * `workerId`: status `processing`, `attempts + 1`, lease until `now + leaseMs`. Uses
 * `BEGIN IMMEDIATE` so two workers never claim the same row.
 */
export function claimNextJob(
  _db: Db,
  _workerId: string,
  _leaseMs: number,
  _now?: number,
): GenerationRow | null {
  throw new NotImplementedError('generations.claimNextJob');
}

/** Pushes the lease out for the worker that still owns the job. */
export function extendLease(
  _db: Db,
  _id: string,
  _workerId: string,
  _leaseMs: number,
  _now?: number,
): boolean {
  throw new NotImplementedError('generations.extendLease');
}

/** Stores the provider's async job id and metadata so a restarted worker can resume polling. */
export function recordSubmitted(
  _db: Db,
  _id: string,
  _workerId: string,
  _providerJobId: string,
  _meta?: Record<string, unknown>,
): boolean {
  throw new NotImplementedError('generations.recordSubmitted');
}

/** 0-100, never decreasing. A no-op when the worker no longer owns the job. */
export function updateProgress(_db: Db, _id: string, _workerId: string, _progress: number): void {
  throw new NotImplementedError('generations.updateProgress');
}

/**
 * `processing` -> `succeeded`, inserting the asset rows in the same transaction. When fewer
 * outputs arrived than were paid for, the shortfall is refunded proportionally.
 */
export function completeGeneration(
  _db: Db,
  _id: string,
  _workerId: string,
  _outputs: readonly PersistedOutput[],
): boolean {
  throw new NotImplementedError('generations.completeGeneration');
}

/**
 * `processing` or `queued` -> `failed` with a full, idempotent refund. `workerId` null is for
 * callers that are not the owning worker (stale recovery, shutdown).
 */
export function failGeneration(
  _db: Db,
  _id: string,
  _workerId: string | null,
  _error: { code: string; message: string },
): boolean {
  throw new NotImplementedError('generations.failGeneration');
}

/**
 * Expired leases: back to `queued`, or `failed` with a refund once `MAX_ATTEMPTS` is reached.
 * Returns how many generations were touched.
 */
export function requeueStale(_db: Db, _now?: number): number {
  throw new NotImplementedError('generations.requeueStale');
}
