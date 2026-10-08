import { eq, sql } from 'drizzle-orm';
import { expect } from 'vitest';
import type { DbOrTx } from '@/server/db';
import { users } from '@/server/db/schema';

interface ChainRow {
  delta: number;
  balanceAfter: number;
  reason: string;
}

/** A user's ledger in insertion order (SQLite rowid), which is the order the writes committed. */
export function ledgerInOrder(db: DbOrTx, userId: string): ChainRow[] {
  return db.all<ChainRow>(
    sql`select delta, balance_after as balanceAfter, reason from credit_ledger where user_id = ${userId} order by rowid`,
  );
}

/**
 * Asserts the credit invariants for one user: the balance is non-negative, every ledger row's
 * `balanceAfter` equals the previous row's plus its delta (starting from `initialBalance`, the
 * balance before the first ledger row), and the cached balance equals the last row.
 */
export function expectConsistentLedger(db: DbOrTx, userId: string, initialBalance: number): void {
  const balance = db
    .select({ value: users.creditBalance })
    .from(users)
    .where(eq(users.id, userId))
    .get()?.value;
  expect(balance, 'user exists').toBeDefined();
  expect(balance, 'balance is never negative').toBeGreaterThanOrEqual(0);

  let running = initialBalance;
  const rows = ledgerInOrder(db, userId);
  rows.forEach((row, index) => {
    running += row.delta;
    expect(row.balanceAfter, `balanceAfter chain at ledger row ${index} (${row.reason})`).toBe(
      running,
    );
    expect(row.balanceAfter, `row ${index} is not negative`).toBeGreaterThanOrEqual(0);
  });
  expect(balance, 'cached balance equals the end of the chain').toBe(running);
}
