import { describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { GET as getPlans } from '@/app/api/v1/billing/plans/route';
import { POST as postCheckout } from '@/app/api/v1/billing/checkout/route';
import { GET as listOrders } from '@/app/api/v1/billing/orders/route';
import { GET as getOrder } from '@/app/api/v1/billing/orders/[id]/route';
import { GET as getSubscription } from '@/app/api/v1/billing/subscription/route';
import { POST as postCancel } from '@/app/api/v1/billing/subscription/cancel/route';
import { POST as postResume } from '@/app/api/v1/billing/subscription/resume/route';
import { POST as postWebhook } from '@/app/api/v1/billing/webhooks/moyasar/route';
import { GET as getReturn } from '@/app/api/v1/billing/return/route';
import type { BillingCatalogDTO, OrderDTO, Page, SubscriptionDTO } from '@/lib/api-types';
import { setGatewayOverride } from '@/server/billing/config';
import { orders } from '@/server/db/schema';
import { getEnv, resetEnvForTests } from '@/server/env';
import { invokeRoute } from '../../../../helpers/http';
import { billingTest } from '../../../../server/billing/support';
import { FAKE_WEBHOOK_SECRET } from '../../../../server/billing/fake-moyasar';
import { caller, routeTestState, type ErrorBody } from './support';

const t = billingTest();
routeTestState();

type One<T> = { data: T } & ErrorBody;

const checkout = (headers: Record<string, string>, body: unknown, key: string | null = 'idem-1') =>
  invokeRoute<One<OrderDTO>>(postCheckout, {
    url: '/api/v1/billing/checkout',
    method: 'POST',
    headers: { ...headers, ...(key === null ? {} : { 'idempotency-key': key }) },
    body,
  });

const PACK = { type: 'pack', id: 'pack-500' } as const;

describe('GET /billing/plans', () => {
  it('is public and cacheable, and carries the server-side price list', async () => {
    const result = await invokeRoute<One<BillingCatalogDTO>>(getPlans, {
      url: '/api/v1/billing/plans',
    });

    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toBe(
      'public, max-age=300, stale-while-revalidate=600',
    );
    const catalog = result.json.data;
    expect(catalog).toMatchObject({
      currency: 'SAR',
      vatPercent: 15,
      gateway: 'mock',
      canPurchase: true,
      renewal: { leadDays: 3, graceDays: 7 },
    });
    expect(catalog.packs.map((pack) => [pack.id, pack.credits, pack.priceHalalas])).toEqual([
      ['pack-500', 500, 2900],
      ['pack-1500', 1500, 7900],
      ['pack-5000', 5000, 22900],
    ]);
    expect(catalog.plans.map((plan) => plan.id)).toEqual(['starter', 'pro', 'studio']);
    expect(catalog.packs[0]?.vatHalalas).toBe(378);
    expect(catalog.plans.find((plan) => plan.id === 'pro')?.popular).toBe(true);
  });

  it('never exposes a key, and says so when buying is off', async () => {
    t.moyasar.invoices.clear();
    const on = await invokeRoute<One<BillingCatalogDTO>>(getPlans, {
      url: '/api/v1/billing/plans',
    });
    expect(on.text).not.toMatch(/sk_|pk_|whsec|secret/i);

    setGatewayOverride(null);
    process.env.BILLING_GATEWAY = 'off';
    resetEnvForTests();
    try {
      const off = await invokeRoute<One<BillingCatalogDTO>>(getPlans, {
        url: '/api/v1/billing/plans',
      });
      expect(off.json.data).toMatchObject({ gateway: 'off', canPurchase: false });
    } finally {
      delete process.env.BILLING_GATEWAY;
    }
  });
});

describe('POST /billing/checkout', () => {
  it('needs a signed-in browser session; an API key can never buy', async () => {
    const dev = await caller(t.db);

    const anonymous = await checkout({}, PACK);
    expect(anonymous.status).toBe(401);

    const byKey = await checkout(dev.bearer, PACK);
    expect(byKey.status).toBe(403);
    expect(byKey.json.error.code).toBe('forbidden');
    expect(t.db.select().from(orders).all()).toEqual([]);
    expect(t.moyasar.calls).toEqual([]);
  });

  it('refuses a cross-site request even with a valid session cookie (CSRF)', async () => {
    const alice = await caller(t.db);
    const forged = await checkout(
      { cookie: alice.browser.cookie ?? '', origin: 'https://evil.example' },
      PACK,
    );
    expect(forged.status).toBe(403);
    expect(t.db.select().from(orders).all()).toEqual([]);
  });

  it('creates a pending order and returns where to pay', async () => {
    const alice = await caller(t.db);
    const result = await checkout(alice.browser, PACK);

    expect(result.status).toBe(201);
    expect(result.headers.get('location')).toBe(`/api/v1/billing/orders/${result.json.data.id}`);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(result.json.data).toMatchObject({
      id: expect.stringMatching(/^ord_/),
      kind: 'pack',
      itemId: 'pack-500',
      amountHalalas: 2900,
      vatHalalas: 378,
      currency: 'SAR',
      credits: 500,
      status: 'pending',
      refundedHalalas: 0,
      checkoutUrl: expect.stringMatching(/^https:\/\/checkout\.moyasar\.com\//),
    });
    // The gateway's ids and our idempotency key are internal.
    expect(result.text).not.toContain('idem-1');
    expect(result.text).not.toMatch(/gatewayInvoiceId|gatewayPaymentId|idempotencyKey/);
  });

  it('answers a retry with the same key with 200 and the same order', async () => {
    const alice = await caller(t.db);
    const first = await checkout(alice.browser, PACK);
    const second = await checkout(alice.browser, PACK);

    expect(second.status).toBe(200);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(second.json.data.id).toBe(first.json.data.id);
    expect(t.db.select().from(orders).all()).toHaveLength(1);
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const alice = await caller(t.db);
    for (const key of [null, '', 'has space', 'x'.repeat(129), 'café']) {
      const result = await checkout(alice.browser, PACK, key);
      expect(result.status, String(key)).toBe(422);
      expect(result.json.error.details).toMatchObject({ issues: [{ path: 'Idempotency-Key' }] });
    }
    expect(t.db.select().from(orders).all()).toEqual([]);
  });

  it('takes an item, never an amount: extra or malformed fields are refused', async () => {
    const alice = await caller(t.db);
    const bodies: unknown[] = [
      { ...PACK, amount: 1 },
      { ...PACK, amountHalalas: 1 },
      { ...PACK, currency: 'USD' },
      { ...PACK, credits: 999999 },
      { type: 'gift', id: 'pack-500' },
      { type: 'pack' },
      { id: 'pack-500' },
      { type: 'pack', id: 5 },
      { type: 'pack', id: 'x'.repeat(65) },
      [],
      null,
    ];
    for (const body of bodies) {
      // A fresh account per attempt: every request counts against the 10 per minute limit.
      const result = await checkout((await caller(t.db)).browser, body);
      expect(result.status, JSON.stringify(body)).toBe(422);
    }
    const unknown = await checkout(alice.browser, { type: 'pack', id: 'pack-123456' });
    expect(unknown.status).toBe(404);
    const plain = await invokeRoute<ErrorBody>(postCheckout, {
      url: '/api/v1/billing/checkout',
      method: 'POST',
      headers: { ...alice.browser, 'idempotency-key': 'k', 'content-type': 'text/plain' },
      body: 'pack-500',
    });
    expect(plain.status).toBe(415);
    const malformed = await invokeRoute<ErrorBody>(postCheckout, {
      url: '/api/v1/billing/checkout',
      method: 'POST',
      headers: { ...alice.browser, 'idempotency-key': 'k', 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    expect(t.db.select().from(orders).all()).toEqual([]);
  });

  it('is limited to a handful of checkouts per minute', async () => {
    const alice = await caller(t.db);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await checkout(alice.browser, PACK, `burst-${i}`)).status);
    }
    // The first click makes the order; the next nine return that same open checkout (they still
    // count, they are requests); from the eleventh the per-minute limit answers.
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1, 10).every((status) => status === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(t.db.select().from(orders).all()).toHaveLength(1);
  });

  it('is a 503 with a reason while billing is switched off', async () => {
    const alice = await caller(t.db);
    setGatewayOverride(null);
    process.env.BILLING_GATEWAY = 'off';
    resetEnvForTests();
    try {
      const result = await checkout(alice.browser, PACK);
      expect(result.status).toBe(503);
      expect(result.json.error.details).toEqual({ reason: 'billing_disabled' });
    } finally {
      delete process.env.BILLING_GATEWAY;
    }
  });
});

describe('POST /billing/checkout while the email address is unconfirmed', () => {
  it('is refused with 403 email_not_verified where confirmation is required, creating nothing', async () => {
    const dev = await caller(t.db, { emailVerifiedAt: null });
    vi.stubEnv('EMAIL_VERIFICATION', 'required');
    resetEnvForTests();

    const result = await checkout(dev.browser, PACK);

    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('email_not_verified');
    expect(t.db.select().from(orders).all()).toEqual([]);
    expect(t.moyasar.calls).toEqual([]);
  });

  it('lets a confirmed account buy, and an unconfirmed one when confirmation is not required', async () => {
    // (An API key cannot be made for an unconfirmed account once confirmation is required.)
    const confirmed = await caller(t.db, { emailVerifiedAt: Date.now() });
    const unconfirmed = await caller(t.db, { emailVerifiedAt: null });
    vi.stubEnv('EMAIL_VERIFICATION', 'required');
    resetEnvForTests();
    expect((await checkout(confirmed.browser, PACK, 'k-confirmed')).status).toBe(201);

    vi.stubEnv('EMAIL_VERIFICATION', 'off');
    resetEnvForTests();
    expect((await checkout(unconfirmed.browser, PACK, 'k-off')).status).toBe(201);
  });

  it('keeps the other billing routes open to it: it can still look at its plan and payments', async () => {
    const dev = await caller(t.db, { emailVerifiedAt: null });
    vi.stubEnv('EMAIL_VERIFICATION', 'required');
    resetEnvForTests();
    const list = await invokeRoute(listOrders, {
      url: '/api/v1/billing/orders',
      headers: dev.browser,
    });
    const subscription = await invokeRoute(getSubscription, {
      url: '/api/v1/billing/subscription',
      headers: dev.browser,
    });
    expect([list.status, subscription.status]).toEqual([200, 200]);
  });
});

describe('orders', () => {
  it('lists only the caller’s orders, newest first, with a cursor', async () => {
    const alice = await caller(t.db);
    const bob = await caller(t.db);
    const created: string[] = [];
    for (const [i, id] of ['pack-500', 'pack-1500', 'pack-5000'].entries()) {
      created.push((await checkout(alice.browser, { type: 'pack', id }, `a-${i}`)).json.data.id);
    }
    await checkout(bob.browser, PACK, 'b-0');

    const first = await invokeRoute<Page<OrderDTO>>(listOrders, {
      url: '/api/v1/billing/orders',
      query: { limit: 2 },
      headers: alice.browser,
    });
    expect(first.status).toBe(200);
    expect(first.json.data.map((order) => order.id)).toEqual([created[2], created[1]]);
    expect(first.json.nextCursor).toEqual(expect.any(String));

    const second = await invokeRoute<Page<OrderDTO>>(listOrders, {
      url: '/api/v1/billing/orders',
      query: { limit: 2, cursor: first.json.nextCursor ?? '' },
      headers: alice.browser,
    });
    expect(second.json.data.map((order) => order.id)).toEqual([created[0]]);
    expect(second.json.nextCursor).toBeNull();

    const garbage = await invokeRoute<ErrorBody>(listOrders, {
      url: '/api/v1/billing/orders',
      query: { cursor: 'not-a-cursor' },
      headers: alice.browser,
    });
    expect(garbage.status).toBe(400);
  });

  it('keeps the billing history away from API keys and anonymous callers', async () => {
    const dev = await caller(t.db);
    expect(
      (await invokeRoute(listOrders, { url: '/api/v1/billing/orders', headers: dev.bearer }))
        .status,
    ).toBe(403);
    expect((await invokeRoute(listOrders, { url: '/api/v1/billing/orders' })).status).toBe(401);
  });

  it('shows an order to its owner only; anybody else gets the same 404 as for an unknown id', async () => {
    const alice = await caller(t.db);
    const mallory = await caller(t.db);
    const dev = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;

    const own = await invokeRoute<One<OrderDTO>, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: alice.browser,
      params: { id },
    });
    expect(own.status).toBe(200);
    expect(own.json.data.id).toBe(id);

    const stolen = await invokeRoute<ErrorBody, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: mallory.browser,
      params: { id },
    });
    const unknown = await invokeRoute<ErrorBody, { id: string }>(getOrder, {
      url: '/api/v1/billing/orders/ord_00000000000000000000000000',
      headers: mallory.browser,
      params: { id: 'ord_00000000000000000000000000' },
    });
    expect(stolen.status).toBe(404);
    expect(stolen.json).toEqual(unknown.json);
    expect(stolen.text).not.toContain(id);

    for (const bad of ['nope', '../x', 'gen_00000000000000000000000000', 'ord_short']) {
      const result = await invokeRoute<ErrorBody, { id: string }>(getOrder, {
        url: `/api/v1/billing/orders/${bad}`,
        headers: alice.browser,
        params: { id: bad },
      });
      expect(result.status, bad).toBe(404);
    }
    const byKey = await invokeRoute<unknown, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: dev.bearer,
      params: { id },
    });
    expect(byKey.status).toBe(403);
  });

  it('asks the gateway while the order is pending, so the return page sees the payment without a webhook', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.pay(id);

    const polled = await invokeRoute<One<OrderDTO>, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: alice.browser,
      params: { id },
    });

    expect(polled.json.data).toMatchObject({ status: 'paid', paidAt: expect.any(Number) });
    expect(polled.json.data.checkoutUrl).toBeUndefined();
    expect(t.balance(alice.userId)).toBe(500);
  });

  it('does not call the gateway on every poll, and survives a gateway outage', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    const poll = () =>
      invokeRoute<One<OrderDTO>, { id: string }>(getOrder, {
        url: `/api/v1/billing/orders/${id}`,
        headers: alice.browser,
        params: { id },
      });

    await poll();
    await poll();
    await poll();
    expect(t.moyasar.callsTo('GET', /^\/invoices\//)).toHaveLength(1);

    t.db.update(orders).set({ lastCheckedAt: 0 }).where(eq(orders.id, id)).run();
    t.moyasar.failNext(1, 503);
    const down = await poll();
    expect(down.status).toBe(200);
    expect(down.json.data.status).toBe('pending');
  });
});

describe('subscription routes', () => {
  it('shows nothing, then the subscription with its unpaid first month, then the running one', async () => {
    const alice = await caller(t.db);
    const get = () =>
      invokeRoute<One<SubscriptionDTO | null>>(getSubscription, {
        url: '/api/v1/billing/subscription',
        headers: alice.browser,
      });

    expect((await get()).json.data).toBeNull();

    const { id } = (await checkout(alice.browser, { type: 'subscription', id: 'pro' })).json.data;
    const incomplete = (await get()).json.data;
    expect(incomplete).toMatchObject({
      planId: 'pro',
      status: 'incomplete',
      cancelAtPeriodEnd: false,
    });
    expect(incomplete?.pendingOrder).toMatchObject({
      id,
      checkoutUrl: expect.stringMatching(/^https:/),
    });

    t.moyasar.pay(id);
    await invokeRoute<unknown, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: alice.browser,
      params: { id },
    });
    const running = (await get()).json.data;
    expect(running).toMatchObject({ status: 'active' });
    expect(running?.currentPeriodEnd).toBeGreaterThan(Date.now());
    expect(running?.pendingOrder).toBeUndefined();
  });

  it('cancels and resumes, only for a browser session', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, { type: 'subscription', id: 'starter' })).json
      .data;
    t.moyasar.pay(id);
    await invokeRoute<unknown, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: alice.browser,
      params: { id },
    });

    const post = (handler: typeof postCancel, headers: Record<string, string>) =>
      invokeRoute<One<SubscriptionDTO>>(handler, {
        url: '/api/v1/billing/subscription/x',
        method: 'POST',
        headers,
      });

    expect((await post(postCancel, alice.bearer)).status).toBe(403);
    expect(
      (await post(postCancel, { ...alice.browser, origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await post(postCancel, {})).status).toBe(401);

    const canceled = await post(postCancel, alice.browser);
    expect(canceled.status).toBe(200);
    expect(canceled.json.data).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    expect((await post(postCancel, alice.browser)).status).toBe(200);

    const resumed = await post(postResume, alice.browser);
    expect(resumed.json.data).toMatchObject({ cancelAtPeriodEnd: false });
    expect((await post(postResume, alice.bearer)).status).toBe(403);
  });

  it('is 404 without a subscription and cannot be touched by someone else', async () => {
    const alice = await caller(t.db);
    const bob = await caller(t.db);
    const { id } = (await checkout(alice.browser, { type: 'subscription', id: 'starter' })).json
      .data;
    t.moyasar.pay(id);
    await invokeRoute<unknown, { id: string }>(getOrder, {
      url: `/api/v1/billing/orders/${id}`,
      headers: alice.browser,
      params: { id },
    });

    const cancel = await invokeRoute<ErrorBody>(postCancel, {
      url: '/api/v1/billing/subscription/cancel',
      method: 'POST',
      headers: bob.browser,
    });
    expect(cancel.status).toBe(404);
    const mine = await invokeRoute<One<SubscriptionDTO | null>>(getSubscription, {
      url: '/api/v1/billing/subscription',
      headers: bob.browser,
    });
    expect(mine.json.data).toBeNull();
  });
});

describe('POST /billing/webhooks/moyasar', () => {
  const deliver = (
    delivery: { rawBody: string; headers: Headers },
    extra: Record<string, string> = {},
  ) =>
    invokeRoute<One<{ received: boolean; result: string }> & ErrorBody>(postWebhook, {
      url: '/api/v1/billing/webhooks/moyasar',
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extra },
      body: delivery.rawBody,
    });

  it('needs no session and no same-origin header, only the shared secret', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.pay(id);

    const ok = await deliver(t.moyasar.webhook('payment_paid', id), {
      origin: 'https://api.moyasar.com',
    });

    expect(ok.status).toBe(200);
    expect(ok.json.data).toEqual({ received: true, result: 'processed' });
    expect(t.balance(alice.userId)).toBe(500);

    const again = await deliver(t.moyasar.webhook('payment_paid', id));
    expect(again.json.data.result).toBe('processed');
    expect(t.balance(alice.userId)).toBe(500);
  });

  it('ignores the caller’s cookie: a logged-in user cannot use the webhook to credit themselves', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;

    const forged = await deliver(
      t.moyasar.webhook('payment_paid', id, { secret: 'guess' }),
      alice.browser,
    );

    expect(forged.status).toBe(401);
    expect(t.balance(alice.userId)).toBe(0);
  });

  it('rejects a wrong or missing secret with 401 and malformed bodies with 400', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.pay(id);

    expect(
      (
        await deliver(
          t.moyasar.webhook('payment_paid', id, { secret: 'wrong-secret-wrong-secret' }),
        )
      ).status,
    ).toBe(401);
    expect((await deliver(t.moyasar.webhook('payment_paid', id, { secret: null }))).status).toBe(
      401,
    );
    expect((await deliver({ rawBody: 'nope', headers: new Headers() })).status).toBe(400);
    expect(t.balance(alice.userId)).toBe(0);
    expect(FAKE_WEBHOOK_SECRET.length).toBeGreaterThan(16);
  });

  it('answers 5xx when the gateway is down, so the delivery is retried', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.pay(id);
    const delivery = t.moyasar.webhook('payment_paid', id, { eventId: 'evt-down' });

    t.moyasar.failNext(1, 503);
    expect((await deliver(delivery)).status).toBe(502);
    expect((await deliver(delivery)).status).toBe(200);
    expect(t.balance(alice.userId)).toBe(500);
  });

  it('refuses huge bodies', async () => {
    const result = await invokeRoute<ErrorBody>(postWebhook, {
      url: '/api/v1/billing/webhooks/moyasar',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filler: 'x'.repeat(70 * 1024) }),
    });
    expect(result.status).toBe(413);
  });

  it('is rate limited per client, generously', async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 5; i += 1) {
      statuses.add((await deliver({ rawBody: '{}', headers: new Headers() })).status);
    }
    expect([...statuses]).toEqual([401]);
    expect(getEnv().APP_URL).toBeTruthy();
  });
});

describe('GET /billing/return', () => {
  const comeBack = (query: Record<string, string>) =>
    invokeRoute<unknown>(getReturn, { url: '/api/v1/billing/return', query });

  it('confirms the payment with the gateway and redirects to our own return page', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.pay(id);

    const result = await comeBack({ order: id });

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(`${getEnv().APP_URL}/billing/return?order=${id}`);
    expect(t.balance(alice.userId)).toBe(500);
  });

  it('believes nothing in the query: status, amount and redirect hints are ignored', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;

    const result = await comeBack({
      order: id,
      status: 'paid',
      id: 'pay-123',
      message: 'APPROVED',
      amount: '2900',
      next: 'https://evil.example/steal',
      redirect: '//evil.example',
    });

    expect(result.headers.get('location')).toBe(`${getEnv().APP_URL}/billing/return?order=${id}`);
    expect(t.order(id).status).toBe('pending');
    expect(t.balance(alice.userId)).toBe(0);
  });

  it('never reflects an unknown or malformed order parameter', async () => {
    for (const order of [
      '<script>alert(1)</script>',
      'ord_00000000000000000000000000',
      '../../etc',
      'https://evil.example',
      '',
    ]) {
      const result = await comeBack({ order });
      expect(result.status, order).toBe(303);
      expect(result.headers.get('location'), order).toBe(`${getEnv().APP_URL}/billing/return`);
    }
    const none = await comeBack({});
    expect(none.headers.get('location')).toBe(`${getEnv().APP_URL}/billing/return`);
  });

  it('still redirects when the gateway is unreachable', async () => {
    const alice = await caller(t.db);
    const { id } = (await checkout(alice.browser, PACK)).json.data;
    t.moyasar.failNext(1, 503);

    const result = await comeBack({ order: id });

    expect(result.status).toBe(303);
    expect(result.headers.get('location')).toBe(`${getEnv().APP_URL}/billing/return?order=${id}`);
  });
});
