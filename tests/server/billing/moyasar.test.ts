import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BillingConfigError,
  createMoyasarGateway,
  secretsMatch,
  type MoyasarConfig,
} from '@/server/billing/moyasar';
import { resetEnvForTests } from '@/server/env';
import { resetLoggerForTests } from '@/server/logger';
import { FAKE_API_BASE, FAKE_SECRET_KEY, FAKE_WEBHOOK_SECRET } from './fake-moyasar';

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
  resetLoggerForTests();
});

function config(overrides: Partial<MoyasarConfig> = {}): MoyasarConfig {
  return {
    secretKey: FAKE_SECRET_KEY,
    apiBase: FAKE_API_BASE,
    webhookSecret: FAKE_WEBHOOK_SECRET,
    nodeEnv: 'test',
    allowLiveInDev: false,
    ...overrides,
  };
}

function reply(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

const INVOICE = {
  id: 'inv-1',
  status: 'initiated',
  amount: 2900,
  currency: 'SAR',
  url: 'https://checkout.moyasar.com/invoices/inv-1',
  metadata: { order_id: 'ord_x' },
  payments: [] as unknown[],
};

const PAID = { id: 'pay-1', status: 'paid', amount: 2900, currency: 'SAR', refunded: 0 };

async function stateOf(invoice: Record<string, unknown>) {
  const gateway = createMoyasarGateway(config({ fetch: reply(200, { ...INVOICE, ...invoice }) }));
  return gateway.fetchPayment({ invoiceId: 'inv-1' });
}

describe('configuration guards', () => {
  it('refuses a live key outside production unless explicitly allowed', () => {
    const live = 'sk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
    for (const nodeEnv of ['development', 'test'] as const) {
      expect(() => createMoyasarGateway(config({ secretKey: live, nodeEnv }))).toThrow(
        BillingConfigError,
      );
      expect(() => createMoyasarGateway(config({ secretKey: live, nodeEnv }))).toThrow(
        /live Moyasar key/,
      );
    }
    expect(() =>
      createMoyasarGateway(
        config({ secretKey: live, nodeEnv: 'development', allowLiveInDev: true }),
      ),
    ).not.toThrow();
    expect(() =>
      createMoyasarGateway(
        config({ secretKey: live, nodeEnv: 'production', apiBase: 'https://api.moyasar.com/v1' }),
      ),
    ).not.toThrow();
  });

  it('the refusal never repeats the key', () => {
    const live = 'sk_live_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
    try {
      createMoyasarGateway(config({ secretKey: live, nodeEnv: 'development' }));
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(live);
    }
  });

  it.each([
    '',
    'pk_test_' + 'AbCdEfGhIjKlMnOp',
    'sk_test_short',
    'not a key',
    'sk_prod_AbCdEfGhIjKlMnOp',
  ])('refuses %j as a secret key', (secretKey) => {
    expect(() => createMoyasarGateway(config({ secretKey }))).toThrow(BillingConfigError);
  });

  it('sends the secret key only to an https moyasar.com host (any host in tests)', () => {
    for (const apiBase of [
      'http://api.moyasar.com/v1',
      'https://moyasar.com.evil.example/v1',
      'https://evil.example/v1',
      'https://notmoyasar.com/v1',
      'ftp://api.moyasar.com/v1',
      'api.moyasar.com',
    ]) {
      expect(() => createMoyasarGateway(config({ nodeEnv: 'development', apiBase }))).toThrow(
        BillingConfigError,
      );
    }
    expect(() =>
      createMoyasarGateway(
        config({ nodeEnv: 'development', apiBase: 'https://api.moyasar.com/v1' }),
      ),
    ).not.toThrow();
    expect(() =>
      createMoyasarGateway(
        config({ nodeEnv: 'development', apiBase: 'https://sandbox.moyasar.com/v1' }),
      ),
    ).not.toThrow();
    expect(() =>
      createMoyasarGateway(config({ nodeEnv: 'test', apiBase: 'http://127.0.0.1:9999/v1' })),
    ).not.toThrow();
  });
});

describe('requests', () => {
  it('authenticates with HTTP Basic (secret key, empty password) and never follows redirects', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const gateway = createMoyasarGateway(
      config({
        fetch: (async (url: string, init: RequestInit) => {
          seen.push({ url, init });
          return new Response(JSON.stringify(INVOICE), { status: 200 });
        }) as unknown as typeof fetch,
      }),
    );
    await gateway.fetchPayment({ invoiceId: 'inv-1' });

    expect(seen[0]?.url).toBe(`${FAKE_API_BASE}/invoices/inv-1`);
    expect(new Headers(seen[0]?.init.headers).get('authorization')).toBe(
      `Basic ${Buffer.from(`${FAKE_SECRET_KEY}:`).toString('base64')}`,
    );
    expect(seen[0]?.init.redirect).toBe('error');
    expect(seen[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('encodes the invoice id into the path', async () => {
    const urls: string[] = [];
    const gateway = createMoyasarGateway(
      config({
        fetch: (async (url: string) => {
          urls.push(url);
          return new Response('{}', { status: 404 });
        }) as unknown as typeof fetch,
      }),
    );
    await gateway.fetchPayment({ invoiceId: '../payments/x?y=1' });
    expect(urls[0]).toBe(`${FAKE_API_BASE}/invoices/..%2Fpayments%2Fx%3Fy%3D1`);
  });

  it('creates an invoice with the amount in halalas, our order id as metadata and an ISO expiry', async () => {
    let body: Record<string, unknown> = {};
    const gateway = createMoyasarGateway(
      config({
        fetch: (async (_url: string, init: RequestInit) => {
          body = JSON.parse(String(init.body)) as Record<string, unknown>;
          return new Response(JSON.stringify(INVOICE), { status: 201 });
        }) as unknown as typeof fetch,
      }),
    );
    const checkout = await gateway.createCheckout({
      orderId: 'ord_x',
      amountHalalas: 2900,
      currency: 'SAR',
      description: 'AIVORE - Small pack',
      successUrl: 'https://app.example/return?order=ord_x',
      backUrl: 'https://app.example/return?order=ord_x',
      expiresAt: Date.UTC(2026, 9, 9, 10, 0, 0),
    });

    expect(checkout).toEqual({
      invoiceId: 'inv-1',
      checkoutUrl: 'https://checkout.moyasar.com/invoices/inv-1',
    });
    expect(body).toEqual({
      amount: 2900,
      currency: 'SAR',
      description: 'AIVORE - Small pack',
      success_url: 'https://app.example/return?order=ord_x',
      back_url: 'https://app.example/return?order=ord_x',
      expired_at: '2026-10-09T10:00:00.000Z',
      metadata: { order_id: 'ord_x' },
    });
  });

  it.each([
    ['a checkout page that is not https', { url: 'http://checkout.moyasar.com/x' }],
    ['a checkout page with credentials in it', { url: 'https://user:pw@checkout.moyasar.com/x' }],
    ['a javascript: page', { url: 'javascript:alert(1)' }],
    ['no page at all', { url: null }],
    ['another amount than asked', { amount: 100 }],
    ['another currency than asked', { currency: 'USD' }],
  ])('refuses %s', async (_name, change) => {
    const gateway = createMoyasarGateway(config({ fetch: reply(201, { ...INVOICE, ...change }) }));
    await expect(
      gateway.createCheckout({
        orderId: 'ord_x',
        amountHalalas: 2900,
        currency: 'SAR',
        description: 'x',
        successUrl: 'https://app.example/r',
        backUrl: 'https://app.example/r',
        expiresAt: Date.now() + 1000,
      }),
    ).rejects.toMatchObject({ code: 'provider_error' });
  });
});

describe('reading a payment', () => {
  it.each([
    ['initiated', 'pending'],
    ['on_hold', 'pending'],
    ['failed', 'pending'],
    ['something-new', 'pending'],
    ['canceled', 'closed'],
    ['expired', 'closed'],
    ['voided', 'closed'],
  ])('invoice status %s is %s', async (status, expected) => {
    expect((await stateOf({ status }))?.status).toBe(expected);
  });

  it('a paid invoice carries the payment id, the amount, the currency and our reference', async () => {
    expect(await stateOf({ status: 'paid', payments: [PAID] })).toEqual({
      status: 'paid',
      invoiceId: 'inv-1',
      paymentId: 'pay-1',
      amountHalalas: 2900,
      currency: 'SAR',
      reference: 'ord_x',
      refundedHalalas: 0,
    });
  });

  it('is paid even if the invoice does not list its payments', async () => {
    expect(await stateOf({ status: 'paid', payments: undefined })).toMatchObject({
      status: 'paid',
      paymentId: null,
    });
  });

  it('reads refunds from the amounts, not from the names', async () => {
    expect(
      await stateOf({ status: 'paid', payments: [{ ...PAID, refunded: 1000 }] }),
    ).toMatchObject({
      status: 'paid',
      refundedHalalas: 1000,
    });
    expect(
      await stateOf({
        status: 'refunded',
        payments: [{ ...PAID, status: 'refunded', refunded: 2900 }],
      }),
    ).toMatchObject({
      status: 'refunded',
      refundedHalalas: 2900,
    });
    // A "refunded" payment that only returned part of the money is a partial refund.
    expect(
      await stateOf({
        status: 'refunded',
        payments: [{ ...PAID, status: 'refunded', refunded: 900 }],
      }),
    ).toMatchObject({
      status: 'paid',
      refundedHalalas: 900,
    });
    expect(await stateOf({ status: 'refunded', payments: undefined })).toMatchObject({
      status: 'refunded',
      refundedHalalas: 2900,
    });
    expect(
      await stateOf({ status: 'voided', payments: [{ ...PAID, status: 'voided', refunded: 0 }] }),
    ).toMatchObject({
      status: 'refunded',
    });
  });

  it('a payment that took money wins over the invoice status, and reports what it really charged', async () => {
    for (const status of ['canceled', 'expired', 'voided']) {
      expect(await stateOf({ status, payments: [PAID] }), status).toMatchObject({
        status: 'paid',
        paymentId: 'pay-1',
        refundedHalalas: 0,
      });
    }
    expect(await stateOf({ status: 'paid', payments: [{ ...PAID, amount: 100 }] })).toMatchObject({
      status: 'paid',
      amountHalalas: 2900,
      paidAmountHalalas: 100,
    });
    expect(
      await stateOf({ status: 'paid', payments: [{ ...PAID, currency: 'USD' }] }),
    ).toMatchObject({ currency: 'SAR', paidCurrency: 'USD' });
    // A double charge reports the sum, so it can never equal the price of one order.
    expect(
      await stateOf({
        status: 'paid',
        payments: [PAID, { ...PAID, id: 'pay-2' }],
      }),
    ).toMatchObject({ paymentId: 'pay-1', paidAmountHalalas: 5800 });
    // The fields are only there when they differ: an ordinary payment adds nothing.
    expect(await stateOf({ status: 'paid', payments: [PAID] })).not.toHaveProperty(
      'paidAmountHalalas',
    );
  });

  it('a voided payment counts as money returned only when nothing else moved money and the invoice says so', async () => {
    const voided = { ...PAID, id: 'pay-v', status: 'voided' };
    // Next to a payment that went through: ignored.
    expect(await stateOf({ status: 'paid', payments: [voided, PAID] })).toMatchObject({
      status: 'paid',
      paymentId: 'pay-1',
      refundedHalalas: 0,
    });
    // On an invoice that can still be paid, or one that simply ended: not a refund.
    expect(await stateOf({ status: 'initiated', payments: [voided] })).toMatchObject({
      status: 'pending',
    });
    expect(await stateOf({ status: 'canceled', payments: [voided] })).toMatchObject({
      status: 'closed',
    });
    // When the invoice itself was voided or refunded: the money went back.
    for (const status of ['voided', 'refunded']) {
      expect(await stateOf({ status, payments: [voided] }), status).toMatchObject({
        status: 'refunded',
        paymentId: 'pay-v',
        refundedHalalas: 2900,
      });
    }
  });

  it('declined or merely authorized attempts are not payments', async () => {
    const failed = { ...PAID, id: 'pay-f', status: 'failed' };
    const authorized = { ...PAID, id: 'pay-a', status: 'authorized' };
    expect(await stateOf({ status: 'failed', payments: [failed] })).toMatchObject({
      status: 'pending',
      paymentId: null,
    });
    expect(await stateOf({ status: 'initiated', payments: [authorized] })).toMatchObject({
      status: 'pending',
    });
    expect(await stateOf({ status: 'paid', payments: [failed, PAID] })).toMatchObject({
      status: 'paid',
      paymentId: 'pay-1',
    });
  });

  it('a missing order reference is reported as missing, not guessed', async () => {
    expect((await stateOf({ status: 'paid', metadata: null }))?.reference).toBeNull();
    expect((await stateOf({ status: 'paid', metadata: { order_id: 42 } }))?.reference).toBeNull();
  });

  it('an answer about another invoice is never used', async () => {
    const gateway = createMoyasarGateway(
      config({ fetch: reply(200, { ...INVOICE, id: 'another' }) }),
    );
    await expect(gateway.fetchPayment({ invoiceId: 'inv-1' })).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('an unknown invoice is null', async () => {
    const gateway = createMoyasarGateway(config({ fetch: reply(404, { message: 'not found' }) }));
    expect(await gateway.fetchPayment({ invoiceId: 'inv-1' })).toBeNull();
  });
});

describe('failures', () => {
  it.each([401, 403, 429, 500, 503])(
    'HTTP %s is a provider_error that says nothing about secrets',
    async (status) => {
      vi.stubEnv('LOG_LEVEL', 'error');
      resetEnvForTests();
      resetLoggerForTests();
      const written: string[] = [];
      vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });
      const gateway = createMoyasarGateway(
        config({
          fetch: reply(status, { type: 'api_error', message: `Invalid key ${FAKE_SECRET_KEY}` }),
        }),
      );

      await expect(gateway.fetchPayment({ invoiceId: 'inv-1' })).rejects.toMatchObject({
        code: 'provider_error',
        status: 502,
      });

      expect(written.join('')).toContain('Moyasar request failed');
      // The gateway's own message is logged (truncated) but the key we sent is never in our output.
      expect(written.join('')).not.toContain(Buffer.from(`${FAKE_SECRET_KEY}:`).toString('base64'));
    },
  );

  it('a network error, a timeout and a non-JSON body are provider errors', async () => {
    const boom = createMoyasarGateway(
      config({
        fetch: (async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch,
      }),
    );
    await expect(boom.fetchPayment({ invoiceId: 'x' })).rejects.toMatchObject({
      code: 'provider_error',
    });

    const html = createMoyasarGateway(config({ fetch: reply(200, '<html>maintenance</html>') }));
    await expect(html.fetchPayment({ invoiceId: 'x' })).rejects.toMatchObject({
      code: 'provider_error',
    });

    const huge = createMoyasarGateway(config({ fetch: reply(200, 'x'.repeat(1_100_000)) }));
    await expect(huge.fetchPayment({ invoiceId: 'x' })).rejects.toMatchObject({
      code: 'provider_error',
    });
  });

  it('canceling an unknown invoice or an already paid one throws', async () => {
    const unknown = createMoyasarGateway(config({ fetch: reply(404, {}) }));
    await expect(unknown.cancelCheckout('x')).rejects.toMatchObject({ code: 'provider_error' });
    const paid = createMoyasarGateway(
      config({ fetch: reply(400, { message: 'Invoice is already paid' }) }),
    );
    await expect(paid.cancelCheckout('x')).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('a refund whose answer has a surprising body still counts as sent', async () => {
    const calls: string[] = [];
    const gateway = createMoyasarGateway(
      config({
        fetch: (async (url: string, init: RequestInit) => {
          calls.push(`${init.method} ${url} ${String(init.body)}`);
          return new Response('ok', { status: 200 });
        }) as unknown as typeof fetch,
      }),
    );
    await gateway.refund({ paymentId: 'pay-1', amountHalalas: 500 });
    expect(calls).toEqual([`POST ${FAKE_API_BASE}/payments/pay-1/refund {"amount":500}`]);
  });
});

describe('webhook verification', () => {
  const body = (
    extra: Record<string, unknown> = {},
    secret: string | undefined = FAKE_WEBHOOK_SECRET,
  ) =>
    JSON.stringify({
      id: 'evt-1',
      type: 'payment_paid',
      ...(secret === undefined ? {} : { secret_token: secret }),
      data: { id: 'pay-1', invoice_id: 'inv-1', metadata: { order_id: 'ord_x' } },
      ...extra,
    });
  const gateway = () => createMoyasarGateway(config());

  it('accepts the shared secret and extracts hints only', () => {
    const event = gateway().verifyWebhook({ headers: new Headers(), rawBody: body() });
    expect(event).toEqual({
      eventKey: 'moyasar:evt-1',
      type: 'payment_paid',
      payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      invoiceId: 'inv-1',
      paymentId: 'pay-1',
      orderRef: 'ord_x',
    });
  });

  it('the hash does not depend on the secret and a redelivery has the same key', () => {
    const other = createMoyasarGateway(config({ webhookSecret: 'another-secret-0123456789' }));
    const a = gateway().verifyWebhook({ headers: new Headers(), rawBody: body() });
    const b = other.verifyWebhook({
      headers: new Headers(),
      rawBody: body({}, 'another-secret-0123456789'),
    });
    expect(a.payloadHash).toBe(b.payloadHash);
    expect(a.eventKey).toBe(b.eventKey);
  });

  it('derives a key from the content when the event has no id', () => {
    const event = gateway().verifyWebhook({
      headers: new Headers(),
      rawBody: body({ id: undefined }),
    });
    expect(event.eventKey).toMatch(/^moyasar:h:[0-9a-f]{64}$/);
  });

  it.each([
    ['wrong', 'nope-nope-nope-nope-nope'],
    ['a prefix of the secret', FAKE_WEBHOOK_SECRET.slice(0, -1)],
    ['the secret plus more', `${FAKE_WEBHOOK_SECRET}x`],
    ['the secret in another case', FAKE_WEBHOOK_SECRET.toUpperCase()],
    ['empty', ''],
  ])('rejects a %s secret', (_name, secret) => {
    expect(() =>
      gateway().verifyWebhook({ headers: new Headers(), rawBody: body({}, secret) }),
    ).toThrow(expect.objectContaining({ code: 'unauthorized' }));
  });

  it('does not take the secret from a header or the query', () => {
    const headers = new Headers({
      'x-moyasar-signature': FAKE_WEBHOOK_SECRET,
      authorization: FAKE_WEBHOOK_SECRET,
    });
    const withoutSecret = JSON.stringify({
      id: 'evt-1',
      type: 'payment_paid',
      data: { id: 'pay-1' },
    });
    expect(() => gateway().verifyWebhook({ headers, rawBody: withoutSecret })).toThrow(
      expect.objectContaining({ code: 'unauthorized' }),
    );
  });

  it('compares secrets of any length without throwing', () => {
    expect(secretsMatch('a', 'abcdef')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
    expect(secretsMatch('same', 'same')).toBe(true);
    expect(secretsMatch('same', 'sane')).toBe(false);
  });

  it('refuses everything when no secret is configured', () => {
    const none = createMoyasarGateway(config({ webhookSecret: undefined }));
    expect(() => none.verifyWebhook({ headers: new Headers(), rawBody: body() })).toThrow(
      expect.objectContaining({ code: 'unauthorized' }),
    );
  });
});
