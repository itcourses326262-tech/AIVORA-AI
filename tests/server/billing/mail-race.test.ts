import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RENEWAL_LEAD_MS, addMonthsUtc } from '@/lib/billing/period';
import { newId } from '@/lib/id';
import { emailEvents, orders, subscriptions } from '@/server/db/schema';
import type { OutboxEntry } from '@/server/email';
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
async function race(args: string[][]): Promise<Array<{ tag: string; queued: number }>> {
  const startAt = Date.now() + 3000;
  const outputs = await Promise.all(
    args.map((extra, index) =>
      run(
        process.execPath,
        [
          '--import',
          'tsx',
          '--conditions=react-server',
          'tests/server/billing/mail-race-worker.ts',
          extra[0] ?? '',
          String(startAt),
          `w${index}`,
          ...extra.slice(1),
        ],
        {
          cwd: ROOT,
          timeout: 120_000,
          env: {
            ...process.env,
            DATABASE_PATH: test.path,
            NODE_ENV: 'test',
            LOG_LEVEL: 'silent',
            SMTP_URL: '',
            SMTP_HOST: '',
            EMAIL_VERIFICATION: '',
          },
        },
      ),
    ),
  );
  return outputs.map(
    ({ stdout }) =>
      JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as { tag: string; queued: number },
  );
}

const outboxFile = () => join(dirname(test.path), 'outbox.jsonl');

/** What every process wrote to the shared outbox file: one entry per message that left. */
function outbox(): OutboxEntry[] {
  if (!existsSync(outboxFile())) return [];
  return readFileSync(outboxFile(), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as OutboxEntry)
    .filter((entry) => entry.status === 'sent');
}

function pendingPackOrders(count: number) {
  const user = seedUser(test.db, { creditBalance: 0, locale: 'en' });
  const now = Date.now();
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
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
  return { user, ids };
}

describe('several processes sending billing mail from the same database', () => {
  it('send each receipt exactly once when they all receive the same payments', async () => {
    const { ids } = pendingPackOrders(12);

    // Four processes walk the same orders in the same order, so they collide on every one.
    const results = await race(Array.from({ length: 4 }, () => ['settle', ...ids]));

    const receipts = outbox().filter((entry) => entry.kind === 'payment_receipt');
    expect(receipts).toHaveLength(ids.length);
    for (const id of ids) {
      expect(receipts.filter((entry) => entry.text?.includes(id))).toHaveLength(1);
    }
    expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(ids.length);
    const rows = test.db.select().from(emailEvents).all();
    expect(rows).toHaveLength(ids.length);
    expect(rows.every((row) => row.sentAt !== null)).toBe(true);
  }, 150_000);

  it('send what a crashed process left behind exactly once when several restarted schedulers sweep at the same time', async () => {
    const { ids } = pendingPackOrders(12);
    await race([['settle', ...ids]]);
    // Back to the state after a crash between the commit and the delivery of every message.
    test.db.update(emailEvents).set({ sentAt: null }).run();
    rmSync(outboxFile(), { force: true });

    const results = await race(Array.from({ length: 4 }, () => ['sweep']));

    expect(outbox().filter((entry) => entry.kind === 'payment_receipt')).toHaveLength(ids.length);
    expect(results.reduce((sum, result) => sum + result.queued, 0)).toBe(ids.length);
    expect(
      test.db
        .select()
        .from(emailEvents)
        .all()
        .every((row) => row.sentAt !== null),
    ).toBe(true);
  }, 150_000);

  it('mail one renewal link per due subscription when several schedulers tick together', async () => {
    const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);
    const END = addMonthsUtc(T0, 1, 8);
    const subs: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      const user = seedUser(test.db, { creditBalance: 0, locale: i % 2 === 0 ? 'en' : 'ar' });
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

    await race(Array.from({ length: 3 }, () => ['tick', String(END - RENEWAL_LEAD_MS + 1000)]));

    const links = outbox().filter((entry) => entry.kind === 'renewal_link');
    expect(links).toHaveLength(subs.length);
    expect(new Set(links.map((entry) => entry.to)).size).toBe(subs.length);
    const renewals = test.db
      .select()
      .from(orders)
      .where(eq(orders.kind, 'subscription_renewal'))
      .all();
    expect(renewals).toHaveLength(subs.length);
    for (const order of renewals) {
      expect(links.filter((entry) => entry.text?.includes(order.checkoutUrl ?? '?'))).toHaveLength(
        1,
      );
    }
    expect(test.db.select().from(emailEvents).all()).toHaveLength(subs.length);
  }, 150_000);
});
