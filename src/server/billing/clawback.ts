import 'server-only';
import { eq, sql } from 'drizzle-orm';
import { newId } from '@/lib/id';
import type { Tx } from '@/server/db';
import { creditLedger, users } from '@/server/db/schema';

/**
 * Takes credits back after a refund, never more than the user has. `credits/index.ts` only knows
 * how to ADD credits and how to charge them for a generation; reversing a purchase is a billing
 * concern, so it lives here, but it follows the same rules: one transaction moves the cached
 * balance and appends the ledger row, the balance can never go below zero (the `UPDATE` itself
 * refuses to, and the column CHECK is behind it) and the idempotency key makes a replay a no-op.
 *
 * Returns how many credits were actually taken (0 when the user has none left).
 */
export function clawbackCredits(
  tx: Tx,
  input: { userId: string; amount: number; idempotencyKey: string; note: string },
): number {
  const replay = tx
    .select({ delta: creditLedger.delta })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, input.idempotencyKey))
    .get();
  if (replay) return -replay.delta;

  const wanted = Math.floor(input.amount);
  if (wanted < 1) return 0;
  const now = Date.now();
  // Take what is there: `min(balance, wanted)` is computed by the same statement that updates it.
  const before = tx
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, input.userId))
    .get();
  if (!before) return 0;
  const taken = Math.min(wanted, before.balance);
  if (taken < 1) return 0;

  const after = tx
    .update(users)
    .set({ creditBalance: sql`${users.creditBalance} - ${taken}`, updatedAt: now })
    .where(eq(users.id, input.userId))
    .returning({ balance: users.creditBalance })
    .get();
  if (!after) return 0;
  tx.insert(creditLedger)
    .values({
      id: newId('led', now),
      userId: input.userId,
      delta: -taken,
      balanceAfter: after.balance,
      reason: 'adjustment',
      generationId: null,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      createdAt: now,
    })
    .run();
  return taken;
}
