import { randomUUID } from 'node:crypto';

/**
 * A stateful stand-in for api.moyasar.com that answers with Moyasar-shaped JSON (invoice and
 * payment objects as documented, see the header of `src/server/billing/moyasar.ts`). The adapter
 * under test talks to it through `fetch`, so tests exercise the real HTTP code without a network.
 * Controls (`pay`, `expire`, `refundOutside`, ...) play the part of the buyer and of Moyasar.
 */

export const FAKE_SECRET_KEY = 'sk_test_' + 'AbCdEfGhIjKlMnOpQrStUvWx';
export const FAKE_WEBHOOK_SECRET = 'whsec-test-0123456789abcdef0123456789';
export const FAKE_API_BASE = 'https://api.moyasar.com/v1';

type InvoiceStatus =
  'initiated' | 'paid' | 'failed' | 'refunded' | 'canceled' | 'on_hold' | 'expired' | 'voided';

interface FakePayment {
  id: string;
  status: 'initiated' | 'paid' | 'failed' | 'refunded' | 'captured' | 'voided';
  amount: number;
  currency: string;
  refunded: number;
}

export interface FakeInvoice {
  id: string;
  status: InvoiceStatus;
  amount: number;
  currency: string;
  description: string;
  expired_at: string;
  success_url: string;
  back_url: string;
  metadata: Record<string, string>;
  payments: FakePayment[];
}

export interface FakeCall {
  method: string;
  path: string;
  body: unknown;
  authorization: string | null;
}

export interface FakeMoyasar {
  fetch: typeof fetch;
  calls: FakeCall[];
  invoices: Map<string, FakeInvoice>;
  /** The invoice created for `orderId` (its `metadata.order_id`). */
  invoiceOf(orderId: string): FakeInvoice;
  /** The buyer pays the invoice in full (or with the odd values given, to simulate tampering). */
  pay(
    orderId: string,
    odd?: { amount?: number; currency?: string; orderRef?: string | null },
  ): FakePayment;
  /** A card attempt is declined; the invoice stays payable. */
  declineAttempt(orderId: string): void;
  expire(orderId: string): void;
  /** Money returned from the dashboard or by a chargeback. `amount` omitted = everything. */
  refundOutside(orderId: string, amount?: number, as?: 'refunded' | 'voided'): void;
  /** Makes the next `count` requests fail with `status` (a network error when status is 0). */
  failNext(count: number, status?: number): void;
  /** A webhook delivery as Moyasar would send it. */
  webhook(
    type: string,
    orderId: string,
    options?: { secret?: string | null; eventId?: string; omitInvoiceId?: boolean },
  ): { rawBody: string; headers: Headers };
  callsTo(method: string, pathPattern: RegExp): FakeCall[];
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function payment(invoice: FakeInvoice, p: FakePayment) {
  return {
    id: p.id,
    status: p.status,
    amount: p.amount,
    fee: Math.round(p.amount * 0.025),
    currency: p.currency,
    refunded: p.refunded,
    refunded_at: p.refunded > 0 ? '2026-10-08T12:00:00.000Z' : null,
    captured: p.status === 'paid' ? p.amount : 0,
    description: invoice.description,
    invoice_id: invoice.id,
    ip: null,
    callback_url: null,
    created_at: '2026-10-08T11:00:00.000Z',
    updated_at: '2026-10-08T11:00:00.000Z',
    metadata: null,
    source: {
      type: 'creditcard',
      company: 'mada',
      name: 'T. Buyer',
      number: 'XXXX-XXXX-XXXX-1010',
    },
  };
}

function invoiceJson(invoice: FakeInvoice) {
  return {
    id: invoice.id,
    status: invoice.status,
    amount: invoice.amount,
    currency: invoice.currency,
    description: invoice.description,
    expired_at: invoice.expired_at,
    logo_url: null,
    amount_format: `${(invoice.amount / 100).toFixed(2)} SAR`,
    url: `https://checkout.moyasar.com/invoices/${invoice.id}?lang=ar`,
    callback_url: null,
    success_url: invoice.success_url,
    back_url: invoice.back_url,
    created_at: '2026-10-08T11:00:00.000Z',
    updated_at: '2026-10-08T11:00:00.000Z',
    metadata: invoice.metadata,
    payments: invoice.payments.map((p) => payment(invoice, p)),
  };
}

export function fakeMoyasar(options: { secretKey?: string } = {}): FakeMoyasar {
  const secretKey = options.secretKey ?? FAKE_SECRET_KEY;
  const expectedAuth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  const invoices = new Map<string, FakeInvoice>();
  const calls: FakeCall[] = [];
  let failures = { count: 0, status: 500 };

  const find = (orderId: string): FakeInvoice => {
    const invoice = [...invoices.values()].find(
      (candidate) => candidate.metadata.order_id === orderId,
    );
    if (!invoice) throw new Error(`The fake Moyasar has no invoice for ${orderId}`);
    return invoice;
  };

  const handler = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const path = url.pathname.replace(/^\/v1/, '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body, authorization: headers.get('authorization') });

    if (failures.count > 0) {
      failures = { ...failures, count: failures.count - 1 };
      if (failures.status === 0) throw new TypeError('fetch failed');
      return json(failures.status, { type: 'api_error', message: 'Simulated failure' });
    }
    if (headers.get('authorization') !== expectedAuth) {
      return json(401, {
        type: 'authentication_error',
        message: 'Invalid authorization credentials',
      });
    }

    if (method === 'POST' && path === '/invoices') {
      const request = body as Record<string, unknown>;
      const invoice: FakeInvoice = {
        id: randomUUID(),
        status: 'initiated',
        amount: request.amount as number,
        currency: request.currency as string,
        description: request.description as string,
        expired_at: request.expired_at as string,
        success_url: request.success_url as string,
        back_url: request.back_url as string,
        metadata: request.metadata as Record<string, string>,
        payments: [],
      };
      invoices.set(invoice.id, invoice);
      return json(201, invoiceJson(invoice));
    }
    const invoiceMatch = /^\/invoices\/([^/]+)(\/cancel)?$/.exec(path);
    if (invoiceMatch) {
      const invoice = invoices.get(decodeURIComponent(invoiceMatch[1] ?? ''));
      if (!invoice)
        return json(404, { type: 'invalid_request_error', message: 'Invoice not found' });
      if (method === 'GET' && !invoiceMatch[2]) return json(200, invoiceJson(invoice));
      if (method === 'PUT' && invoiceMatch[2]) {
        if (invoice.status === 'paid') {
          return json(400, { type: 'invalid_request_error', message: 'Invoice is already paid' });
        }
        invoice.status = 'canceled';
        return json(200, invoiceJson(invoice));
      }
    }
    const refundMatch = /^\/payments\/([^/]+)\/refund$/.exec(path);
    if (method === 'POST' && refundMatch) {
      const id = decodeURIComponent(refundMatch[1] ?? '');
      for (const invoice of invoices.values()) {
        const found = invoice.payments.find((candidate) => candidate.id === id);
        if (!found) continue;
        const amount =
          (body as { amount?: number } | undefined)?.amount ?? found.amount - found.refunded;
        if (found.status !== 'paid' || found.refunded + amount > found.amount) {
          return json(400, {
            type: 'invalid_request_error',
            message: 'Cannot refund this payment',
          });
        }
        found.refunded += amount;
        if (found.refunded >= found.amount) {
          found.status = 'refunded';
          invoice.status = 'refunded';
        }
        return json(200, payment(invoice, found));
      }
      return json(404, { type: 'invalid_request_error', message: 'Payment not found' });
    }
    return json(404, { type: 'invalid_request_error', message: 'No such route' });
  };

  return {
    fetch: handler as typeof fetch,
    calls,
    invoices,
    invoiceOf: find,
    pay(orderId, odd = {}) {
      const invoice = find(orderId);
      if (invoice.status !== 'initiated')
        throw new Error(`Invoice is ${invoice.status}, not payable`);
      const paid: FakePayment = {
        id: randomUUID(),
        status: 'paid',
        amount: odd.amount ?? invoice.amount,
        currency: odd.currency ?? invoice.currency,
        refunded: 0,
      };
      if (odd.orderRef !== undefined) {
        if (odd.orderRef === null) delete invoice.metadata.order_id;
        else invoice.metadata.order_id = odd.orderRef;
      }
      // A tampered amount shows on the invoice too, which is what the adapter reads.
      invoice.amount = odd.amount ?? invoice.amount;
      invoice.currency = odd.currency ?? invoice.currency;
      invoice.payments.push(paid);
      invoice.status = 'paid';
      return paid;
    },
    declineAttempt(orderId) {
      const invoice = find(orderId);
      invoice.payments.push({
        id: randomUUID(),
        status: 'failed',
        amount: invoice.amount,
        currency: invoice.currency,
        refunded: 0,
      });
      invoice.status = 'failed';
    },
    expire(orderId) {
      const invoice = find(orderId);
      if (invoice.status !== 'paid') invoice.status = 'expired';
    },
    refundOutside(orderId, amount, as = 'refunded') {
      const invoice = find(orderId);
      const paid = invoice.payments.find((candidate) => candidate.status === 'paid');
      if (!paid) throw new Error('Nothing paid to refund');
      const value = amount ?? paid.amount - paid.refunded;
      paid.refunded += value;
      if (paid.refunded >= paid.amount) {
        paid.status = as;
        invoice.status = as === 'voided' ? 'voided' : 'refunded';
      }
    },
    failNext(count, status = 500) {
      failures = { count, status };
    },
    webhook(type, orderId, { secret = FAKE_WEBHOOK_SECRET, eventId, omitInvoiceId } = {}) {
      const invoice = find(orderId);
      const paid = invoice.payments.at(-1);
      const body: Record<string, unknown> = {
        id: eventId ?? randomUUID(),
        type,
        created_at: '2026-10-08T12:00:00.000Z',
        account_name: 'AIVORE',
        live: false,
        data: {
          id: paid?.id ?? randomUUID(),
          status: paid?.status ?? 'initiated',
          amount: invoice.amount,
          currency: invoice.currency,
          ...(omitInvoiceId ? {} : { invoice_id: invoice.id }),
          metadata: null,
        },
      };
      if (secret !== null) body.secret_token = secret;
      return {
        rawBody: JSON.stringify(body),
        headers: new Headers({ 'content-type': 'application/json' }),
      };
    },
    callsTo: (method, pattern) =>
      calls.filter((call) => call.method === method && pattern.test(call.path)),
  };
}
