import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createCheckout, findOrder, listOrders } from '@/server/billing/orders';
import { toOrderDTO } from '@/server/billing/dto';
import { refundOrder } from '@/server/billing/refunds';
import { settleOrder } from '@/server/billing/settle';
import { users } from '@/server/db/schema';
import { cleanEmailState } from '../email/support';
import { billingTest } from './support';

const t = billingTest();
cleanEmailState();

async function paidPack(userId: string, id = 'pack-500') {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id },
    { idempotencyKey: `k-${Math.random()}` },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id);
  return order;
}

describe('the order DTO says how many credits a refund really took back', () => {
  it('shows 0 for an order that was never refunded, and the full credits after a full refund', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    expect(toOrderDTO(t.order(order.id))).toMatchObject({ credits: 500, clawedBackCredits: 0 });

    await refundOrder(order.id);
    expect(toOrderDTO(t.order(order.id))).toMatchObject({
      status: 'refunded',
      credits: 500,
      clawedBackCredits: 500,
    });
  });

  it('shows the share of a partial refund, rounded down as the server takes it', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id, 'pack-1500');
    await refundOrder(order.id, { amountHalalas: 1_975 });
    expect(toOrderDTO(t.order(order.id))).toMatchObject({
      status: 'paid',
      refundedHalalas: 1_975,
      clawedBackCredits: 375,
    });
  });

  it('shows what was really taken when the credits had been spent (needs_review): less than the refund was worth', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    t.db.update(users).set({ creditBalance: 10 }).where(eq(users.id, user.id)).run();
    await refundOrder(order.id);

    const dto = toOrderDTO(t.order(order.id));
    expect(dto).toMatchObject({
      status: 'needs_review',
      refundedHalalas: 2_900,
      credits: 500,
      clawedBackCredits: 10,
    });
    // The list the billing page reads carries the same number, and it never exceeds the credits.
    const listed = listOrders(user.id).data.find((entry) => entry.id === order.id);
    expect(listed?.clawedBackCredits).toBe(10);
    expect((listed?.clawedBackCredits ?? 0) <= (listed?.credits ?? 0)).toBe(true);
    expect(findOrder(t.db, order.id)?.clawedBackCredits).toBe(10);
  });
});
