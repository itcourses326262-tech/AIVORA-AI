import 'server-only';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { LedgerEntryDTO, LedgerReason, Page } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { clamp, decodeCursor, encodeCursor } from '@/lib/utils';
import { withTx, type DbOrTx, type Tx } from '@/server/db';
import { creditLedger, users, type LedgerEntry } from '@/server/db/schema';

export type { LedgerEntry };

/** Reasons a plain grant may carry. `generation` and `refund` belong to debit and refund. */
export type GrantReason = Exclude<LedgerReason, 'generation' | 'refund'>;
const GRANT_REASONS: readonly GrantReason[] = [
  'signup_bonus',
  'admin_grant',
  'purchase',
  'adjustment',
];

/** Upper bound for one operation; keeps every sum far inside JS safe integers. */
export const MAX_CREDIT_AMOUNT = 1_000_000_000;

export interface GrantCreditsInput {
  userId: string;
  amount: number;
  reason: GrantReason;
  note?: string;
  generationId?: string;
  /** Replays with the same key return the original entry and change nothing. */
  idempotencyKey?: string;
}

export interface DebitCreditsInput {
  userId: string;
  amount: number;
  generationId: string;
  idempotencyKey?: string;
}

export interface RefundOptions {
  /** Defaults to everything not refunded yet; larger values are capped to what is left. */
  amount?: number;
  note?: string;
  /** Makes a partial refund replay-safe. A full refund is idempotent without it. */
  idempotencyKey?: string;
}

function assertAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_CREDIT_AMOUNT) {
    throw AppError.of(
      'bad_request',
      `Credit amount must be an integer between 1 and ${MAX_CREDIT_AMOUNT}`,
    );
  }
}

function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_CHECK'
  );
}

function findByKey(tx: Tx, key: string): LedgerEntry | undefined {
  return tx.select().from(creditLedger).where(eq(creditLedger.idempotencyKey, key)).get();
}

/** A reused key must describe the same operation, otherwise it is a caller bug worth surfacing. */
function assertReplay(
  existing: LedgerEntry,
  expected: { userId: string; delta: number; reason: LedgerReason; generationId?: string },
): LedgerEntry {
  const same =
    existing.userId === expected.userId &&
    existing.delta === expected.delta &&
    existing.reason === expected.reason &&
    (existing.generationId ?? undefined) === expected.generationId;
  if (!same) {
    throw AppError.of(
      'conflict',
      'Idempotency key was already used for a different credit operation',
    );
  }
  return existing;
}

/** Adds `delta` to the cached balance atomically and returns the new balance. */
function applyDelta(tx: Tx, userId: string, delta: number, now: number): number {
  let row: { balance: number } | undefined;
  try {
    row = tx
      .update(users)
      .set({ creditBalance: sql`${users.creditBalance} + ${delta}`, updatedAt: now })
      .where(and(eq(users.id, userId), sql`${users.creditBalance} + ${delta} >= 0`))
      .returning({ balance: users.creditBalance })
      .get();
  } catch (error) {
    // The CHECK (credit_balance >= 0) is the last line of defence behind the guard above.
    if (isCheckViolation(error)) throw insufficient(tx, userId, -delta);
    throw error;
  }
  if (row) return row.balance;

  const current = tx
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!current) throw AppError.of('not_found', 'User not found');
  throw insufficient(tx, userId, -delta);
}

function insufficient(tx: Tx, userId: string, required: number): AppError {
  const current = tx
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return AppError.of('insufficient_credits', 'Insufficient credits', {
    required,
    balance: current?.balance ?? 0,
  });
}

function insertLedger(
  tx: Tx,
  entry: {
    userId: string;
    delta: number;
    balanceAfter: number;
    reason: LedgerReason;
    generationId?: string;
    note?: string;
    idempotencyKey?: string;
    createdAt: number;
  },
): LedgerEntry {
  return tx
    .insert(creditLedger)
    .values({
      id: newId('led', entry.createdAt),
      userId: entry.userId,
      delta: entry.delta,
      balanceAfter: entry.balanceAfter,
      reason: entry.reason,
      generationId: entry.generationId ?? null,
      note: entry.note ?? null,
      idempotencyKey: entry.idempotencyKey ?? null,
      createdAt: entry.createdAt,
    })
    .returning()
    .get();
}

/** Current cached balance. Throws `not_found` for an unknown user. */
export function getBalance(db: DbOrTx, userId: string): number {
  const row = db
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) throw AppError.of('not_found', 'User not found');
  return row.balance;
}

/** Adds credits and records them. Atomic, and a no-op replay when `idempotencyKey` was seen. */
export function grantCredits(db: DbOrTx, input: GrantCreditsInput): LedgerEntry {
  assertAmount(input.amount);
  if (!GRANT_REASONS.includes(input.reason)) {
    throw AppError.of('bad_request', `Credits cannot be granted with reason "${input.reason}"`);
  }
  return withTx(db, (tx) => {
    if (input.idempotencyKey) {
      const existing = findByKey(tx, input.idempotencyKey);
      if (existing) {
        return assertReplay(existing, {
          userId: input.userId,
          delta: input.amount,
          reason: input.reason,
          generationId: input.generationId,
        });
      }
    }
    const now = Date.now();
    const balanceAfter = applyDelta(tx, input.userId, input.amount, now);
    return insertLedger(tx, {
      userId: input.userId,
      delta: input.amount,
      balanceAfter,
      reason: input.reason,
      generationId: input.generationId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });
  });
}

/**
 * Charges credits for a generation. The balance can never go below zero: a debit that would
 * overdraw throws `insufficient_credits` and changes nothing. Replays of `idempotencyKey` return
 * the original entry instead of charging twice.
 */
export function debitCredits(db: DbOrTx, input: DebitCreditsInput): LedgerEntry {
  assertAmount(input.amount);
  return withTx(db, (tx) => {
    if (input.idempotencyKey) {
      const existing = findByKey(tx, input.idempotencyKey);
      if (existing) {
        return assertReplay(existing, {
          userId: input.userId,
          delta: -input.amount,
          reason: 'generation',
          generationId: input.generationId,
        });
      }
    }
    const now = Date.now();
    const balanceAfter = applyDelta(tx, input.userId, -input.amount, now);
    return insertLedger(tx, {
      userId: input.userId,
      delta: -input.amount,
      balanceAfter,
      reason: 'generation',
      generationId: input.generationId,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    });
  });
}

/**
 * Gives back credits charged for a generation, never more than was debited in total. Returns null
 * when there is nothing (left) to refund, which makes a plain `refundGeneration(db, id)` safe to
 * call any number of times.
 */
export function refundGeneration(
  db: DbOrTx,
  generationId: string,
  opts: RefundOptions = {},
): LedgerEntry | null {
  if (opts.amount !== undefined) assertAmount(opts.amount);
  return withTx(db, (tx) => {
    if (opts.idempotencyKey) {
      const existing = findByKey(tx, opts.idempotencyKey);
      if (existing) {
        if (existing.reason !== 'refund' || existing.generationId !== generationId) {
          throw AppError.of(
            'conflict',
            'Idempotency key was already used for a different credit operation',
          );
        }
        return existing;
      }
    }

    const rows = tx
      .select({
        userId: creditLedger.userId,
        reason: creditLedger.reason,
        delta: creditLedger.delta,
      })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.generationId, generationId),
          inArray(creditLedger.reason, ['generation', 'refund']),
        ),
      )
      .all();

    let debited = 0;
    let refunded = 0;
    let userId: string | undefined;
    for (const row of rows) {
      if (row.reason === 'generation') {
        debited -= row.delta;
        userId ??= row.userId;
      } else {
        refunded += row.delta;
      }
    }
    const remaining = debited - refunded;
    if (userId === undefined || remaining <= 0) return null;

    const amount = Math.min(opts.amount ?? remaining, remaining);
    const now = Date.now();
    const balanceAfter = applyDelta(tx, userId, amount, now);
    return insertLedger(tx, {
      userId,
      delta: amount,
      balanceAfter,
      reason: 'refund',
      generationId,
      note: opts.note,
      idempotencyKey: opts.idempotencyKey,
      createdAt: now,
    });
  });
}

export function toLedgerEntryDTO(entry: LedgerEntry): LedgerEntryDTO {
  return {
    id: entry.id,
    delta: entry.delta,
    balanceAfter: entry.balanceAfter,
    reason: entry.reason,
    ...(entry.generationId ? { generationId: entry.generationId } : {}),
    ...(entry.note ? { note: entry.note } : {}),
    createdAt: entry.createdAt,
  };
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/** Newest first. `cursor` is the `nextCursor` of the previous page. */
export function listLedger(
  db: DbOrTx,
  userId: string,
  opts: { limit?: number; cursor?: string } = {},
): Page<LedgerEntryDTO> {
  // A non-finite limit (NaN would otherwise turn `limit + 1` into an unbounded query) is "not given".
  const limit =
    typeof opts.limit === 'number' && Number.isFinite(opts.limit)
      ? clamp(Math.trunc(opts.limit), 1, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  let after: SQLCursor | undefined;
  if (opts.cursor !== undefined) {
    const parts = decodeCursor(opts.cursor);
    const [createdAt, id] = parts ?? [];
    if (typeof createdAt !== 'number' || typeof id !== 'string') {
      throw AppError.of('bad_request', 'Invalid cursor');
    }
    after = { createdAt, id };
  }

  const rows = db
    .select()
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        after
          ? or(
              lt(creditLedger.createdAt, after.createdAt),
              and(eq(creditLedger.createdAt, after.createdAt), lt(creditLedger.id, after.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(creditLedger.createdAt), desc(creditLedger.id))
    .limit(limit + 1)
    .all();

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    data: pageRows.map(toLedgerEntryDTO),
    nextCursor: hasMore && last ? encodeCursor([last.createdAt, last.id]) : null,
  };
}

interface SQLCursor {
  createdAt: number;
  id: string;
}
