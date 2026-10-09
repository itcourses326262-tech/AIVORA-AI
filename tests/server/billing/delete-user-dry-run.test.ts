import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { EXIT_OK, runAdminCli } from '@/server/auth/admin/cli';
import type { CliIo } from '@/server/auth/admin/io';
import { createCheckout } from '@/server/billing/orders';
import { settleOrder } from '@/server/billing/settle';
import { orders, subscriptions, users } from '@/server/db/schema';
import { cleanEmailState } from '../email/support';
import { billingTest } from './support';

const t = billingTest();
cleanEmailState();

async function dryRun(email: string): Promise<{ code: number; out: string }> {
  const out: string[] = [];
  const io: CliIo = {
    out: (line) => void out.push(line),
    err: () => undefined,
    readSecret: async () => '',
    env: () => undefined,
  };
  const code = await runAdminCli(['delete-user', email], io);
  return { code, out: out.join('\n') };
}

describe('delete-user without --yes', () => {
  it('says it also ends the running plan and withdraws the open payment pages, and does neither', async () => {
    const user = t.newUser({ email: 'aya@example.com', locale: 'en' });
    // A running plan and two payment pages that were never paid.
    const plan = await createCheckout(
      user.id,
      { type: 'subscription', id: 'pro' },
      { idempotencyKey: 'plan' },
    );
    t.moyasar.pay(plan.order.id);
    await settleOrder(plan.order.id);
    await createCheckout(user.id, { type: 'pack', id: 'pack-500' }, { idempotencyKey: 'a' });
    await createCheckout(user.id, { type: 'pack', id: 'pack-1500' }, { idempotencyKey: 'b' });

    const result = await dryRun('aya@example.com');

    expect(result.code).toBe(EXIT_OK);
    expect(result.out).toContain('Would delete aya@example.com');
    expect(result.out).toContain(
      'the active plan "pro" is ended at once (credits already granted stay)',
    );
    expect(result.out).toContain('2 open payment pages are withdrawn at the payment gateway first');
    expect(result.out).toContain('if one cannot be, nothing is deleted');
    expect(result.out).toContain('Run again with --yes');
    // It is a preview: the account, the plan and the payment pages are untouched.
    expect(t.db.select().from(users).where(eq(users.id, user.id)).get()?.deletedAt).toBeNull();
    expect(
      t.db.select().from(subscriptions).where(eq(subscriptions.userId, user.id)).get()?.status,
    ).toBe('active');
    expect(
      t.db
        .select()
        .from(orders)
        .where(eq(orders.userId, user.id))
        .all()
        .filter((order) => order.status === 'pending'),
    ).toHaveLength(2);
    expect(t.moyasar.callsTo('PUT', /\/cancel$/)).toEqual([]);
  });

  it('says there is nothing of the kind to end for an account that never bought anything', async () => {
    t.newUser({ email: 'noor@example.com' });
    const result = await dryRun('noor@example.com');
    expect(result.out).toContain('no running plan to end');
    expect(result.out).toContain('and 0 open payment pages are withdrawn');
  });

  it('counts one open payment page in the singular', async () => {
    const user = t.newUser({ email: 'omar@example.com' });
    await createCheckout(user.id, { type: 'pack', id: 'pack-500' }, { idempotencyKey: 'a' });
    expect((await dryRun('omar@example.com')).out).toContain(
      'and 1 open payment page is withdrawn',
    );
  });
});
