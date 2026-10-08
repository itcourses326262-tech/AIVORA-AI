import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { newId } from '@/lib/id';
import { orders, subscriptions, creditLedger } from '@/server/db/schema';
import { expectConsistentLedger } from '../../helpers/credits';
import { createTestDb, seedUser, type TestDb } from '../../helpers/db';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../../..');

let test: TestDb;

beforeEach(() => {
  test = createTestDb({ file: true });
});
afterEach(() => {
  test.close();
});

/** Several OS processes, each with its own connection to the same database file, started together. */
async function race(args: string[][]): Promise<Array<Record<string, unknown>>> {
  const startAt = Date.now() + 3000;
  const outputs = await Promise.all(
    args.map((extra, index) =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          'tests/server/billing/race-worker.ts',
          extra[0] ?? '',
          String(startAt),
          `w${index}`,
          ...extra.slice(1),
        ],
        {
          cwd: ROOT,
          timeout: 120_000,
          env: { ...process.env, DATABASE_PATH: test.path, NODE_ENV: 'test', LOG_LEVEL: 'silent' },
        },
      ),
    ),
  );
  return outputs.map(
    ({ stdout }) => JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as Record<string, unknown>,
  );
}

describe('several processes working on the same database', () => {
  it('credit every order exactly once when they all receive the same payment', async () => {
    const user = seedUser(test.db, { creditBalance: 0 });
    const ids: string[] = [];
    const now = Date.now();
    for (let i = 0; i < 40; i += 1) {
      const id = newId('ord');
      ids.push(id);
      test.db
        .insert(orders)
        .values({
          id,
          userId: user.id,
          kind: 'pack',
          itemId: 'pack-500',
          amountHalalas: 2900,
          currency: 'SAR',
          vatHalalas: 378,
          credits: 500,
          status: 'pending',
          gateway: 'moyasar',
          gatewayInvoiceId: `inv_${id}`,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // Four processes walk the same orders in the same order, so they collide on every one.
    const results = await race(Array.from({ length: 4 }, () => ['settle', ...ids]));

    const tally = (key: string) =>
      results.reduce(
        (sum, result) => sum + ((result.outcomes as Record<string, number>)[key] ?? 0),
        0,
      );
    expect(tally('paid')).toBe(ids.length);
    expect(tally('already_paid')).toBe(ids.length * 3);
    expect(test.db.select().from(creditLedger).all()).toHaveLength(ids.length);
    const [balance] = test.db.$client
      .prepare('select credit_balance as c from users where id = ?')
      .all(user.id) as Array<{ c: number }>;
    expect(balance?.c).toBe(40 * 500);
    expectConsistentLedger(test.db, user.id, 0);
    for (const id of ids) {
      expect(test.db.select().from(orders).where(eq(orders.id, id)).get()?.status).toBe('paid');
    }
  }, 150_000);

  it('issue exactly one renewal link per due subscription', async () => {
    const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
    const END = addMonthsUtc(T0, 1, 8);
    const subs: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const user = seedUser(test.db, { creditBalance: 0 });
      const id = newId('sub');
      subs.push(id);
      test.db
        .insert(subscriptions)
        .values({
          id,
          userId: user.id,
          planId: 'starter',
          status: 'active',
          anchorDay: 8,
          currentPeriodStart: T0,
          currentPeriodEnd: END,
          nextChargeAt: END - RENEWAL_LEAD_MS,
          createdAt: T0,
          updatedAt: T0,
        })
        .run();
    }

    const results = await race(
      Array.from({ length: 3 }, () => ['tick', String(END - RENEWAL_LEAD_MS + 1000)]),
    );

    const renewals = test.db
      .select()
      .from(orders)
      .where(eq(orders.kind, 'subscription_renewal'))
      .all();
    expect(renewals).toHaveLength(subs.length);
    expect(new Set(renewals.map((order) => order.subscriptionId)).size).toBe(subs.length);
    expect(
      renewals.every((order) => order.status === 'pending' && order.gatewayInvoiceId !== null),
    ).toBe(true);
    // One payment page per link across all processes: nobody did the same work twice.
    expect(results.reduce((sum, result) => sum + (result.created as number), 0)).toBe(subs.length);
    for (const id of subs) {
      const row = test.db.select().from(subscriptions).where(eq(subscriptions.id, id)).get();
      expect(row).toMatchObject({ status: 'active', nextChargeAt: END });
    }
  }, 150_000);
});
