import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGateway } from '@/server/billing/config';
import {
  MOCK_WEBHOOK_SECRET,
  createMockGateway,
  getMockGateway,
  resetMockGatewayForTests,
  type MockGateway,
} from '@/server/billing/mock';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { settleOrder } from '@/server/billing/settle';
import { handleWebhook } from '@/server/billing/webhooks';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { billingTest } from './support';

describe('the fake gateway through the real services', () => {
  const harness = freshDb();
  let mock: MockGateway;

  beforeEach(() => {
    resetMockGatewayForTests();
    mock = getMockGateway();
    // No override: the services pick the gateway from the environment, which is the mock in tests.
    // Every caller gets its own gateway object over the one shared memory of the fake.
    expect(getGateway().id).toBe('mock');
  });
  afterEach(() => resetMockGatewayForTests());

  const user = () => createUser(harness.db, { creditBalance: 0 });

  it('sends the buyer to its own hosted page', async () => {
    const buyer = user();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-1500' },
      { idempotencyKey: 'k' },
    );

    expect(order.gateway).toBe('mock');
    expect(order.checkoutUrl).toBe(`http://localhost:3000/billing/mock-checkout/${order.id}`);
    expect(mock.hasCheckout(order.id)).toBe(true);
  });

  it('Pay: the webhook and the return both end in a credited order, once', async () => {
    const buyer = user();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );

    mock.simulatePayment(order.id);
    expect(await handleWebhook(mock.webhookFor(order.id, 'payment_paid'))).toBe('processed');
    expect((await settleOrder(order.id))?.outcome).toBe('already_paid');

    const row = harness.db.$client
      .prepare('select credit_balance as c from users where id = ?')
      .get(buyer.id) as { c: number };
    expect(row.c).toBe(500);
  });

  it('Fail: the checkout closes without credits', async () => {
    const buyer = user();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );

    mock.simulateDecline(order.id);
    await handleWebhook(mock.webhookFor(order.id, 'payment_failed'));

    const row = harness.db.$client
      .prepare('select status from orders where id = ?')
      .get(order.id) as { status: string };
    expect(row.status).toBe('failed');
    expect(() => mock.simulatePayment(order.id)).toThrow(/can no longer be paid/);
  });

  it('refunds like the real thing', async () => {
    const buyer = user();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    mock.simulatePayment(order.id);
    await settleOrder(order.id);

    const result = await refundOrder(order.id);

    expect(result.order).toMatchObject({ status: 'refunded', clawedBackCredits: 500 });
    await expect(refundOrder(order.id)).rejects.toMatchObject({
      code: 'bad_request',
      message: 'This payment has already been refunded in full',
    });
  });

  it('only accepts webhooks signed with its own secret', async () => {
    const buyer = user();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    mock.simulatePayment(order.id);
    const good = mock.webhookFor(order.id, 'payment_paid');
    const forged = JSON.parse(good.rawBody) as Record<string, unknown>;
    forged.secret_token = 'not-the-mock-secret';

    await expect(
      handleWebhook({ headers: good.headers, rawBody: JSON.stringify(forged) }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    expect(MOCK_WEBHOOK_SECRET.length).toBeGreaterThan(16);
  });

  it('expires checkouts with the clock it is given', async () => {
    let now = 1_000;
    const clocked = createMockGateway({ appUrl: 'http://localhost:3000', now: () => now });
    const checkout = await clocked.createCheckout({
      orderId: 'ord_x',
      amountHalalas: 100,
      currency: 'SAR',
      description: 'x',
      successUrl: 'http://localhost:3000/r',
      backUrl: 'http://localhost:3000/r',
      expiresAt: 5_000,
    });
    expect((await clocked.fetchPayment({ invoiceId: checkout.invoiceId }))?.status).toBe('pending');
    now = 5_000;
    expect((await clocked.fetchPayment({ invoiceId: checkout.invoiceId }))?.status).toBe('closed');
    expect(() => clocked.simulatePayment('ord_x')).toThrow(/can no longer be paid/);
  });

  it('does not know checkouts it never made', async () => {
    expect(await mock.fetchPayment({ invoiceId: 'mock_inv_nope' })).toBeNull();
    expect(mock.hasCheckout('ord_nope')).toBe(false);
    expect(() => mock.simulatePayment('ord_nope')).toThrow(/No mock checkout/);
    await expect(mock.cancelCheckout('mock_inv_nope')).rejects.toBeDefined();
  });
});

describe('the real gateway never accepts what the fake signs', () => {
  const t = billingTest();

  it('a mock-signed webhook is rejected by the Moyasar adapter', async () => {
    const buyer = t.newUser();
    const { order } = await createCheckout(
      buyer.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    t.moyasar.pay(order.id);
    const mock = createMockGateway({ appUrl: 'http://localhost:3000' });
    await mock.createCheckout({
      orderId: order.id,
      amountHalalas: 2900,
      currency: 'SAR',
      description: 'x',
      successUrl: 'http://localhost:3000/r',
      backUrl: 'http://localhost:3000/r',
      expiresAt: Date.now() + 1000,
    });

    await expect(handleWebhook(mock.webhookFor(order.id, 'payment_paid'))).rejects.toMatchObject({
      code: 'unauthorized',
    });
    expect(t.balance(buyer.id)).toBe(0);
  });
});

describe('the fake gateway across module instances', () => {
  afterEach(() => resetMockGatewayForTests());

  // Turbopack gives route handlers, server actions and instrumentation their own copy of a module
  // while `globalThis` is shared. The fake keeps its memory there; if it kept the gateway object
  // too, a route would run closures of ANOTHER copy, and the `AppError` they throw is not an
  // `instanceof` the one that route's `route()` wrapper checks: a forged webhook answered 500
  // instead of 401 in development.
  it("shares its checkouts but throws the caller's own AppError", async () => {
    vi.resetModules();
    const first = await import('@/server/billing/mock');
    const firstErrors = await import('@/lib/errors');
    first.resetMockGatewayForTests();
    const checkout = await first.getMockGateway().createCheckout({
      orderId: 'ord_shared',
      amountHalalas: 2900,
      currency: 'SAR',
      description: 'x',
      successUrl: 'http://localhost:3000/r',
      backUrl: 'http://localhost:3000/r',
      expiresAt: Date.now() + 60_000,
    });

    vi.resetModules();
    const second = await import('@/server/billing/mock');
    const secondErrors = await import('@/lib/errors');
    expect(secondErrors.AppError).not.toBe(firstErrors.AppError);

    const gateway = second.getMockGateway();
    expect(gateway.hasCheckout('ord_shared')).toBe(true);
    expect((await gateway.fetchPayment({ invoiceId: checkout.invoiceId }))?.status).toBe('pending');
    const forged = { rawBody: '{"type":"payment_paid"}', headers: new Headers() };
    expect(() => gateway.verifyWebhook(forged)).toThrow(secondErrors.AppError);
    expect(() => gateway.verifyWebhook(forged)).not.toThrow(firstErrors.AppError);
  });
});
