import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCheckout } from '@/server/billing/orders';
import { handleWebhook } from '@/server/billing/webhooks';
import { billingEvents, creditLedger } from '@/server/db/schema';
import { FAKE_WEBHOOK_SECRET } from './fake-moyasar';
import { billingTest } from './support';

const t = billingTest();

async function buy(userId: string) {
  const { order } = await createCheckout(
    userId,
    { type: 'pack', id: 'pack-500' },
    { idempotencyKey: `k-${Math.random()}` },
  );
  return order;
}

const events = () => t.db.select().from(billingEvents).all();

describe('webhook authentication', () => {
  it.each([
    ['a wrong secret', 'definitely-not-the-secret'],
    ['an empty secret', ''],
    ['no secret at all', null],
  ])('rejects %s and changes nothing', async (_name, secret) => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);

    const delivery = t.moyasar.webhook('payment_paid', order.id, { secret });
    await expect(handleWebhook(delivery)).rejects.toMatchObject({
      code: 'unauthorized',
      status: 401,
    });

    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('pending');
    expect(events()).toEqual([]);
  });

  it('rejects a body that is not JSON or not an object with a secret', async () => {
    await expect(
      handleWebhook({ headers: new Headers(), rawBody: 'not json' }),
    ).rejects.toMatchObject({
      code: 'bad_request',
    });
    for (const rawBody of ['[]', '{}', '"x"', 'null', '{"type":"payment_paid"}']) {
      await expect(handleWebhook({ headers: new Headers(), rawBody })).rejects.toMatchObject({
        code: 'unauthorized',
      });
    }
  });

  it('accepts nothing when no webhook secret is configured (fail closed)', async () => {
    const { createMoyasarGateway } = await import('@/server/billing/moyasar');
    const { setGatewayOverride } = await import('@/server/billing/config');
    const gateway = createMoyasarGateway({
      secretKey: 'sk_test_' + 'AbCdEfGhIjKlMnOpQrStUvWx',
      apiBase: 'https://api.moyasar.com/v1',
      nodeEnv: 'test',
      allowLiveInDev: false,
      fetch: t.moyasar.fetch,
    });
    setGatewayOverride(gateway);
    const user = t.newUser();
    const order = await buy(user.id);

    await expect(
      handleWebhook(t.moyasar.webhook('payment_paid', order.id, { secret: '' })),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      handleWebhook(t.moyasar.webhook('payment_paid', order.id, { secret: 'anything' })),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('never stores the shared secret', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    await handleWebhook(t.moyasar.webhook('payment_paid', order.id));

    expect(JSON.stringify(events())).not.toContain(FAKE_WEBHOOK_SECRET);
  });
});

describe('a genuine webhook', () => {
  it('credits the order after the gateway API confirms it, exactly once across redeliveries', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    const delivery = t.moyasar.webhook('payment_paid', order.id, { eventId: 'evt-1' });

    expect(await handleWebhook(delivery)).toBe('processed');
    expect(await handleWebhook(delivery)).toBe('duplicate');
    expect(await handleWebhook(delivery)).toBe('duplicate');

    expect(t.balance(user.id)).toBe(500);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      gateway: 'moyasar',
      eventKey: 'moyasar:evt-1',
      type: 'payment_paid',
      orderId: order.id,
    });
    expect(events()[0]?.processedAt).not.toBeNull();
  });

  it('the same payment announced by two different events is still credited once', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);

    await handleWebhook(t.moyasar.webhook('payment_paid', order.id));
    await handleWebhook(t.moyasar.webhook('payment_captured', order.id));

    expect(t.balance(user.id)).toBe(500);
    expect(
      t.db.select().from(creditLedger).where(eq(creditLedger.userId, user.id)).all(),
    ).toHaveLength(1);
  });

  it('a paid-looking webhook is worthless when the gateway says nothing was paid', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    // The sender knows the secret but the invoice was never paid: the API is the judge.
    const forged = t.moyasar.webhook('payment_paid', order.id);

    expect(await handleWebhook(forged)).toBe('processed');

    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('pending');
  });

  it('a webhook cannot make us credit another amount than the order asked for', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id, { amount: 1 });

    await handleWebhook(t.moyasar.webhook('payment_paid', order.id));

    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('needs_review');
  });

  it('events in the wrong order end in the right state', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    t.moyasar.refundOutside(order.id);

    // "refunded" arrives first, then "paid" (late): the truth is read, not the event order.
    await handleWebhook(t.moyasar.webhook('payment_refunded', order.id));
    await handleWebhook(t.moyasar.webhook('payment_paid', order.id));

    expect(t.order(order.id).status).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);
  });

  it('a refund event after the credits were granted takes them back', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    await handleWebhook(t.moyasar.webhook('payment_paid', order.id));
    expect(t.balance(user.id)).toBe(500);

    t.moyasar.refundOutside(order.id);
    await handleWebhook(t.moyasar.webhook('payment_refunded', order.id));

    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('refunded');
  });

  it('acknowledges events about payments that are not ours', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    const stranger = t.moyasar.webhook('payment_paid', order.id);
    const body = JSON.parse(stranger.rawBody) as { data: Record<string, unknown> };
    body.data.invoice_id = 'someone-elses-invoice';
    body.data.id = 'someone-elses-payment';

    const result = await handleWebhook({
      headers: stranger.headers,
      rawBody: JSON.stringify(body),
    });

    expect(result).toBe('ignored');
    expect(t.order(order.id).status).toBe('pending');
  });

  it('keeps an event unprocessed when the gateway is down, so the retry works', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    t.moyasar.pay(order.id);
    const delivery = t.moyasar.webhook('payment_paid', order.id, { eventId: 'evt-retry' });

    t.moyasar.failNext(1, 503);
    await expect(handleWebhook(delivery)).rejects.toMatchObject({ code: 'provider_error' });
    expect(events()[0]?.processedAt).toBeNull();
    expect(t.balance(user.id)).toBe(0);

    expect(await handleWebhook(delivery)).toBe('processed');
    expect(t.balance(user.id)).toBe(500);
  });

  it('finds the order by the payment id when the event does not carry the invoice id', async () => {
    const user = t.newUser();
    const order = await buy(user.id);
    const payment = t.moyasar.pay(order.id);
    await (await import('@/server/billing/settle')).settleOrder(order.id);

    t.moyasar.refundOutside(order.id);
    const body = JSON.parse(t.moyasar.webhook('payment_refunded', order.id).rawBody) as {
      data: Record<string, unknown>;
    };
    delete body.data.invoice_id;
    body.data.id = payment.id;
    expect(
      await handleWebhook({
        headers: new Headers(),
        rawBody: JSON.stringify(body),
      }),
    ).toBe('processed');
    expect(t.order(order.id).status).toBe('refunded');
  });
});
