import 'server-only';
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { refundGeneration } from '@/server/credits';
import { withTx, type Db, type DbOrTx, type Tx } from '@/server/db';
import { assets, generations, type GenerationRow } from '@/server/db/schema';
import { getEnv } from '@/server/env';
import type { PersistedOutput } from '@/server/uploads';
import { releaseUpstreamSpend } from './budget';
import { FREE_PROVIDER, isPaidProvider } from './paid';

// Every state change is a compare-and-set on (id, status[, workerId]) inside a synchronous
// transaction; each function returns false when the row was not in the expected state. The `db`
// argument comes first, like the credits functions, so the runner and tests choose the connection.
// `now` (epoch ms) exists for deterministic lease tests. Refunds happen in the same transaction as
// the transition that earns them, so a generation can never be failed without being refunded.

const MAX_ERROR_CODE_CHARS = 64;
const MAX_ERROR_MESSAGE_CHARS = 500;

/** Statuses a generation can still leave. `succeeded`, `failed` and `canceled` are final. */
const ACTIVE_STATUSES = ['queued', 'processing'] as const;

export interface GenerationFailure {
  code: string;
  /** Shown to the user: keep it generic and free of provider detail. */
  message: string;
}

/** What `requeueStale` stores when a job keeps losing its worker. */
export const INTERRUPTED_FAILURE: GenerationFailure = {
  code: 'unavailable',
  message: 'The generation was interrupted and could not be completed.',
};

/**
 * What a job is failed with when it cannot safely be run again: a `provider.submit` was started
 * (see {@link markSubmitStarted}) and the worker vanished before the provider's job id was stored,
 * so the provider may already have accepted, and be billing, a request we cannot find. Submitting
 * again would risk paying for the same picture twice, so the job ends here, fully refunded.
 */
export const SUBMIT_INTERRUPTED_FAILURE: GenerationFailure = {
  code: 'interrupted',
  message:
    'The generation was interrupted before the provider confirmed it, so it was stopped to avoid a duplicate charge. Your credits were refunded; please try again.',
};

export interface ClaimOptions {
  /** A `processing` job that already used this many attempts is not claimed again. Default `MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /**
   * Generations the caller is still running itself. They are never claimed: a job whose lease only
   * LOOKS expired because the caller stalled (or the clock stepped) is not an orphan, and running
   * it a second time would submit it, and bill it, twice.
   */
  excludeIds?: readonly string[];
}

/**
 * A job whose `provider.submit` was started but whose outcome was never recorded, on a provider
 * that bills for it. Only the Demo provider may simply be submitted again.
 */
export function isIndeterminateSubmit(
  row: Pick<GenerationRow, 'provider' | 'submitStartedAt' | 'providerJobId'>,
): boolean {
  return row.submitStartedAt !== null && row.providerJobId === null && isPaidProvider(row.provider);
}

/** The SQL twin of {@link isIndeterminateSubmit}. */
const indeterminateSubmit = and(
  isNotNull(generations.submitStartedAt),
  isNull(generations.providerJobId),
  ne(generations.provider, FREE_PROVIDER),
);

/** Fails (and refunds) every indeterminate job among `candidates`; returns how many. */
function failIndeterminateSubmits(tx: Tx, candidates: SQL | undefined, now: number): number {
  const doomed = tx
    .select({ id: generations.id })
    .from(generations)
    .where(and(candidates, indeterminateSubmit))
    .all();
  let failed = 0;
  for (const { id } of doomed) {
    if (failInTx(tx, id, null, SUBMIT_INTERRUPTED_FAILURE, now)) failed += 1;
  }
  return failed;
}

function ownedBy(workerId: string) {
  return and(eq(generations.status, 'processing'), eq(generations.workerId, workerId));
}

function notExcluded(ids: readonly string[] | undefined) {
  return ids && ids.length > 0 ? notInArray(generations.id, [...ids]) : undefined;
}

/**
 * Atomically takes the next `queued` generation, or a `processing` one whose lease expired, for
 * `workerId`: status `processing`, `attempts + 1`, lease until `now + leaseMs`. Uses
 * `BEGIN IMMEDIATE` so two workers never claim the same row.
 *
 * "Next" is fair between users: the user with the fewest jobs running right now goes first, then
 * the oldest job. Without that, one account that queues its full allowance of long videos would
 * hold every worker slot while everybody else waits. It never idles a slot, though: a user who is
 * alone in the queue still gets all of them.
 */
export function claimNextJob(
  db: Db,
  workerId: string,
  leaseMs: number,
  now: number = Date.now(),
  options: ClaimOptions = {},
): GenerationRow | null {
  const maxAttempts = options.maxAttempts ?? getEnv().MAX_ATTEMPTS;
  const claimable = and(
    or(
      eq(generations.status, 'queued'),
      and(
        eq(generations.status, 'processing'),
        or(isNull(generations.leaseUntil), lt(generations.leaseUntil, now)),
        lt(generations.attempts, maxAttempts),
      ),
    ),
    notExcluded(options.excludeIds),
  );
  // Jobs of the same owner that a worker is actively running (live lease). An expired lease is an
  // orphan waiting for a taker, not load.
  const runningForOwner = sql<number>`(select count(*) from ${generations} as running
    where running.user_id = ${generations.userId}
      and running.status = 'processing' and running.lease_until >= ${now})`;
  // An idle runner asks every second. A plain read answers "nothing to do" without taking the
  // write lock that every claim needs.
  if (!db.select({ id: generations.id }).from(generations).where(claimable).limit(1).get()) {
    return null;
  }
  return withTx(db, (tx) => {
    // A job that must not be submitted again is failed here instead of being handed out.
    failIndeterminateSubmits(tx, claimable, now);
    const candidate = tx
      .select({ id: generations.id })
      .from(generations)
      .where(claimable)
      .orderBy(asc(runningForOwner), asc(generations.createdAt), asc(generations.id))
      .limit(1)
      .get();
    if (!candidate) return null;
    const claimed = tx
      .update(generations)
      .set({
        status: 'processing',
        attempts: sql`${generations.attempts} + 1`,
        workerId,
        leaseUntil: now + leaseMs,
        startedAt: sql`coalesce(${generations.startedAt}, ${now})`,
        updatedAt: now,
      })
      .where(and(eq(generations.id, candidate.id), claimable))
      .returning()
      .get();
    return claimed ?? null;
  });
}

/** Pushes the lease out for the worker that still owns the job. */
export function extendLease(
  db: Db,
  id: string,
  workerId: string,
  leaseMs: number,
  now: number = Date.now(),
): boolean {
  const row = db
    .update(generations)
    .set({ leaseUntil: now + leaseMs, updatedAt: now })
    .where(and(eq(generations.id, id), ownedBy(workerId)))
    .returning({ id: generations.id })
    .get();
  return row !== undefined;
}

/**
 * Compare-and-set, right BEFORE `provider.submit` is called: records that a submit is about to
 * leave this process. If the worker dies before {@link recordSubmitted} runs, the marker is what
 * tells the next worker that the provider may be holding (and billing) a request we have no id
 * for. False when the job is no longer this worker's, or already has a provider job id: then
 * nothing may be submitted.
 */
export function markSubmitStarted(
  db: Db,
  id: string,
  workerId: string,
  now: number = Date.now(),
): boolean {
  const row = db
    .update(generations)
    .set({ submitStartedAt: now, updatedAt: now })
    .where(and(eq(generations.id, id), ownedBy(workerId), isNull(generations.providerJobId)))
    .returning({ id: generations.id })
    .get();
  return row !== undefined;
}

/**
 * Takes the marker back after a submit that the provider definitely did not accept (it answered
 * with a retryable error): the engine is about to try again, and a shutdown during the back-off
 * must not leave an indeterminate job behind.
 */
export function clearSubmitStarted(db: Db, id: string, workerId: string): boolean {
  const row = db
    .update(generations)
    .set({ submitStartedAt: null, updatedAt: Date.now() })
    .where(and(eq(generations.id, id), ownedBy(workerId), isNull(generations.providerJobId)))
    .returning({ id: generations.id })
    .get();
  return row !== undefined;
}

/** Stores the provider's async job id and metadata so a restarted worker can resume polling. */
export function recordSubmitted(
  db: Db,
  id: string,
  workerId: string,
  providerJobId: string,
  meta?: Record<string, unknown>,
): boolean {
  const row = db
    .update(generations)
    .set({
      providerJobId,
      providerMeta: meta ?? null,
      // The outcome of the submit is on record now: the job is resumable, not indeterminate.
      submitStartedAt: null,
      updatedAt: Date.now(),
    })
    .where(and(eq(generations.id, id), ownedBy(workerId)))
    .returning({ id: generations.id })
    .get();
  return row !== undefined;
}

/** 0-100, never decreasing. A no-op when the worker no longer owns the job. */
export function updateProgress(db: Db, id: string, workerId: string, progress: number): void {
  if (!Number.isFinite(progress)) return;
  const value = Math.min(100, Math.max(0, Math.round(progress)));
  db.update(generations)
    .set({ progress: sql`max(${generations.progress}, ${value})`, updatedAt: Date.now() })
    .where(and(eq(generations.id, id), ownedBy(workerId)))
    .run();
}

/**
 * `processing` -> `succeeded`, inserting the asset rows in the same transaction. When fewer
 * outputs arrived than were paid for, the shortfall is refunded proportionally (rounded down, so
 * the user never gets back more than the missing share). Callers pass at most `params.count`
 * outputs and at least one: a job without outputs has failed, so use `failGeneration`.
 */
export function completeGeneration(
  db: Db,
  id: string,
  workerId: string,
  outputs: readonly PersistedOutput[],
): boolean {
  if (outputs.length === 0) {
    throw new RangeError(
      'completeGeneration needs at least one output; fail the generation instead',
    );
  }
  return withTx(db, (tx) => {
    const now = Date.now();
    const row = tx
      .update(generations)
      .set({
        status: 'succeeded',
        progress: 100,
        finishedAt: now,
        leaseUntil: null,
        errorCode: null,
        errorMessage: null,
        submitStartedAt: null,
        updatedAt: now,
      })
      .where(and(eq(generations.id, id), ownedBy(workerId)))
      .returning()
      .get();
    if (!row) return false;

    tx.insert(assets)
      .values(
        outputs.map((output) => ({
          id: output.assetId,
          userId: row.userId,
          generationId: row.id,
          role: 'output' as const,
          kind: output.kind,
          index: output.index,
          storageKey: output.storageKey,
          thumbKey: output.thumbKey ?? null,
          mimeType: output.mimeType,
          bytes: output.bytes,
          width: output.width ?? null,
          height: output.height ?? null,
          durationMs: output.durationMs ?? null,
          sha256: output.sha256 ?? null,
          createdAt: now,
        })),
      )
      .run();

    const requested = Math.max(1, row.params.count);
    const missing = requested - Math.min(requested, outputs.length);
    const refund = Math.floor((row.cost * missing) / requested);
    if (refund > 0) {
      refundGeneration(tx, row.id, {
        amount: refund,
        note: `Partial result: ${outputs.length} of ${requested} delivered`,
        idempotencyKey: `refund:partial:${row.id}`,
      });
    }
    return true;
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/** The shared body of every transition into `failed`: CAS, then the full refund, in `tx`. */
function failInTx(
  tx: Tx,
  id: string,
  workerId: string | null,
  failure: GenerationFailure,
  now: number,
): boolean {
  const row = tx
    .update(generations)
    .set({
      status: 'failed',
      errorCode: truncate(failure.code, MAX_ERROR_CODE_CHARS),
      errorMessage: truncate(failure.message, MAX_ERROR_MESSAGE_CHARS),
      finishedAt: now,
      leaseUntil: null,
      submitStartedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(generations.id, id),
        workerId === null ? inArray(generations.status, ACTIVE_STATUSES) : ownedBy(workerId),
      ),
    )
    .returning({ id: generations.id })
    .get();
  if (!row) return false;
  refundGeneration(tx, id, { note: 'Generation failed', idempotencyKey: `refund:${id}` });
  releaseUpstreamSpend(tx, id, now);
  return true;
}

/**
 * `processing` or `queued` -> `failed` with a full, idempotent refund. `workerId` null is for
 * callers that are not the owning worker (stale recovery, shutdown); a worker id only matches a
 * job that worker still owns.
 */
export function failGeneration(
  db: Db,
  id: string,
  workerId: string | null,
  error: GenerationFailure,
): boolean {
  return withTx(db, (tx) => failInTx(tx, id, workerId, error, Date.now()));
}

/**
 * `queued` or `processing` -> `canceled` with a full refund, for the owner of the generation. The
 * runner notices the new status on its next poll or heartbeat. False when the row is not the
 * user's or is already final. Joins the caller's transaction when given a `Tx`.
 */
export function markCanceled(db: DbOrTx, userId: string, id: string): boolean {
  return withTx(db, (tx) => {
    const now = Date.now();
    const row = tx
      .update(generations)
      .set({
        status: 'canceled',
        finishedAt: now,
        leaseUntil: null,
        submitStartedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(generations.id, id),
          eq(generations.userId, userId),
          inArray(generations.status, ACTIVE_STATUSES),
        ),
      )
      .returning({ id: generations.id })
      .get();
    if (!row) return false;
    refundGeneration(tx, id, { note: 'Generation canceled', idempotencyKey: `refund:${id}` });
    releaseUpstreamSpend(tx, id, now);
    return true;
  });
}

/**
 * Hands a job this worker owns back to the queue without failing it (graceful shutdown). The
 * provider job id and metadata stay, so the next worker resumes polling. The attempt does not
 * count: stopping for a deploy is not the job's fault.
 */
export function releaseJob(db: Db, id: string, workerId: string): boolean {
  const row = db
    .update(generations)
    .set({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      attempts: sql`max(${generations.attempts} - 1, 0)`,
      updatedAt: Date.now(),
    })
    .where(and(eq(generations.id, id), ownedBy(workerId)))
    .returning({ id: generations.id })
    .get();
  return row !== undefined;
}

/**
 * Hands back every job the given worker id(s) still own, in one statement: what a process does as
 * it exits, when nothing asynchronous can run any more, so the next worker resumes at once instead
 * of after the lease runs out. Returns how many jobs it released.
 */
export function releaseWorkerJobs(db: Db, workerIds: string | readonly string[]): number {
  const ids = typeof workerIds === 'string' ? [workerIds] : workerIds;
  if (ids.length === 0) return 0;
  return db
    .update(generations)
    .set({
      status: 'queued',
      workerId: null,
      leaseUntil: null,
      attempts: sql`max(${generations.attempts} - 1, 0)`,
      updatedAt: Date.now(),
    })
    .where(and(eq(generations.status, 'processing'), inArray(generations.workerId, ids)))
    .returning({ id: generations.id })
    .all().length;
}

export interface RequeueOptions {
  /** Default `MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /** Generations the caller is still running itself; see {@link ClaimOptions.excludeIds}. */
  excludeIds?: readonly string[];
}

/**
 * Expired leases: back to `queued`, or `failed` with a refund once `MAX_ATTEMPTS` is reached.
 * Returns how many generations were touched.
 */
export function requeueStale(
  db: Db,
  now: number = Date.now(),
  options: RequeueOptions = {},
): number {
  const maxAttempts = options.maxAttempts ?? getEnv().MAX_ATTEMPTS;
  const expired = and(
    eq(generations.status, 'processing'),
    or(isNull(generations.leaseUntil), lt(generations.leaseUntil, now)),
    notExcluded(options.excludeIds),
  );
  if (!db.select({ id: generations.id }).from(generations).where(expired).limit(1).get()) return 0;
  return withTx(db, (tx) => {
    // First the jobs that must not run again: their submit may already be billing upstream.
    let touched = failIndeterminateSubmits(tx, expired, now);
    const stale = tx
      .select({ id: generations.id, attempts: generations.attempts })
      .from(generations)
      .where(expired)
      .all();
    for (const job of stale) {
      if (job.attempts >= maxAttempts) {
        if (failInTx(tx, job.id, null, INTERRUPTED_FAILURE, now)) touched += 1;
        continue;
      }
      const row = tx
        .update(generations)
        .set({ status: 'queued', workerId: null, leaseUntil: null, updatedAt: now })
        .where(and(eq(generations.id, job.id), expired))
        .returning({ id: generations.id })
        .get();
      if (row) touched += 1;
    }
    return touched;
  });
}
