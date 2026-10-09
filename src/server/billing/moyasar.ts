import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { moyasarKeyMode, type NodeEnvironment } from '@/lib/billing/gateway-config';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/server/logger';
import type {
  BillingGateway,
  GatewayCheckout,
  GatewayCheckoutInput,
  GatewayPaymentState,
  GatewayWebhookEvent,
} from './gateway';

/**
 * Moyasar adapter (https://docs.moyasar.com). Hosted checkout through the Invoices API: the buyer
 * pays on Moyasar's page, so card data never touches this server.
 *
 * VERIFIED (official docs, read through search excerpts on 2026-10-08; docs.moyasar.com itself
 * was unreachable from the build sandbox):
 *  - base https://api.moyasar.com/v1, HTTP Basic auth with the SECRET key as user name and an empty password
 *  - amounts are integers in the smallest unit (halalas for SAR)
 *  - POST /invoices {amount, currency, description, success_url, back_url, expired_at, metadata}
 *    -> invoice {id, status, amount, currency, url, metadata, payments[]}
 *  - invoice statuses: initiated, paid, failed, refunded, canceled, on_hold, expired, voided
 *  - GET /invoices/:id, PUT /invoices/:id/cancel (returns the invoice with status canceled)
 *  - POST /payments/:id/refund, optional {amount}; only paid/captured payments, never above the
 *    charged amount; a refunded payment carries `refunded` (amount) and status refunded
 *  - payment statuses: initiated, paid, authorized, failed, refunded, captured, voided, verified
 *  - metadata: up to 30 string pairs (key <= 40, value <= 500), echoed back in responses and webhooks
 *  - webhook: POST of {id, type, created_at, secret_token, account_name, live, data}; `secret_token`
 *    is the shared secret set on the webhook; event types payment_paid, payment_failed (the docs
 *    also spell it payment_faild), payment_refunded, payment_voided, ...; a non-2xx answer is
 *    retried 5 more times after 1, 10, 30, 60 and 120 minutes
 *
 * UNVERIFIED (kept inside this file; every one fails closed or is cross-checked):
 *  - the exact JSON of an invoice/payment/webhook beyond the fields above (schemas below are lenient
 *    and read only what is needed); whether an invoice embeds `payments[]` (we do not depend on it
 *    for the paid decision, only for the payment id and refunded amounts)
 *  - the format Moyasar accepts for `expired_at` (we send ISO 8601 UTC)
 *  - whether the payment object in a webhook carries `invoice_id` and the invoice metadata (the
 *    services map events by invoice id, payment id or `metadata.order_id`; an unmappable event is
 *    ignored and the reconciliation loop finds the payment within a minute)
 *  - the HTTP error body shape (only `message` is read, truncated, for the log)
 *  - whether a partial refund keeps the payment `paid` or sets `refunded` (amounts decide, not names)
 *  - how a chargeback appears (we expect the payment to become refunded, or voided together with its
 *    invoice; a voided payment next to a payment that took money, or on an invoice that can still
 *    be paid, is an attempt that never took money and is NOT read as "money returned")
 *  - whether a payment can be captured on an invoice that is already canceled or expired (we treat
 *    any payment that took money as the truth, whatever the invoice says; see {@link toPaymentState})
 *  - that webhooks carry no signature header (only the `secret_token` body field is documented)
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARS = 1_000_000;
const MAX_ERROR_MESSAGE_CHARS = 200;
const KEY_LIKE = /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]+/g;

export class BillingConfigError extends Error {
  override readonly name = 'BillingConfigError';
}

export interface MoyasarConfig {
  secretKey: string;
  apiBase: string;
  webhookSecret?: string;
  nodeEnv: NodeEnvironment;
  allowLiveInDev: boolean;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The last line of defence behind the env rules: a gateway cannot even be built from unsafe settings. */
function assertSafeConfig(config: MoyasarConfig): void {
  const mode = moyasarKeyMode(config.secretKey, 'secret');
  if (mode === null) throw new BillingConfigError('MOYASAR_SECRET_KEY is not a Moyasar secret key');
  if (mode === 'live' && config.nodeEnv !== 'production' && !config.allowLiveInDev) {
    throw new BillingConfigError(
      'Refusing to use a live Moyasar key outside production (set MOYASAR_ALLOW_LIVE_IN_DEV=true to override)',
    );
  }
  let url: URL;
  try {
    url = new URL(config.apiBase);
  } catch {
    throw new BillingConfigError('MOYASAR_API_BASE is not a URL');
  }
  if (config.nodeEnv === 'test') return;
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !(host === 'moyasar.com' || host.endsWith('.moyasar.com'))) {
    throw new BillingConfigError('MOYASAR_API_BASE must be an https URL on moyasar.com');
  }
}

const paymentSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  refunded: z.number().int().nullish(),
});

const invoiceSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  amount: z.number().int(),
  currency: z.string(),
  url: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  payments: z.array(paymentSchema).nullish(),
});
type Invoice = z.infer<typeof invoiceSchema>;

const PAID_PAYMENT_STATUSES = ['paid', 'captured'];
const CLOSED_INVOICE_STATUSES = ['canceled', 'expired', 'voided'];
const RETURNED_INVOICE_STATUSES = ['refunded', 'voided'];

type Payment = z.infer<typeof paymentSchema>;

/** How much of a payment that took money went back to the buyer. */
function refundedOf(payment: Payment): number {
  const refunded = payment.refunded ?? 0;
  if (payment.status === 'refunded') return refunded > 0 ? refunded : payment.amount;
  return refunded;
}

/**
 * Moyasar's invoice, reduced to the facts the services compare with the order. Money is decided
 * PAYMENT BY PAYMENT, and the payments win over the invoice's own status:
 *  - a payment that took money (`paid`, `captured`, or `refunded` after it was captured) makes the
 *    checkout paid whatever the invoice says. A buyer who finished 3-D Secure just as the invoice
 *    expired or was canceled has still been charged, and must get the credits (or a human must
 *    look), never a silently failed order;
 *  - the amount and currency that were actually charged are reported next to the invoice's own, so
 *    a payment of another amount, or two payments on one invoice, can never match the order;
 *  - a `voided` payment is a payment that never took money (a released authorization) unless the
 *    invoice itself says the money went back. It is never added to the money returned, so a voided
 *    attempt next to a later paid payment, or on an invoice that can still be paid, changes nothing.
 */
function toPaymentState(invoice: Invoice): GatewayPaymentState {
  const payments = invoice.payments ?? [];
  const reference = invoice.metadata?.order_id;
  const base = {
    invoiceId: invoice.id,
    amountHalalas: invoice.amount,
    currency: invoice.currency,
    reference: typeof reference === 'string' ? reference : null,
  };

  const charged = payments.filter(
    (payment) => PAID_PAYMENT_STATUSES.includes(payment.status) || payment.status === 'refunded',
  );
  if (charged.length > 0) {
    const settling = charged.find((payment) => PAID_PAYMENT_STATUSES.includes(payment.status));
    const chargedAmount = charged.reduce((sum, payment) => sum + payment.amount, 0);
    const returned = Math.min(
      charged.reduce((sum, payment) => sum + refundedOf(payment), 0),
      chargedAmount,
    );
    const currencies = new Set(charged.map((payment) => payment.currency));
    const [onlyCurrency] = currencies;
    const common = {
      ...base,
      paymentId: (settling ?? charged[0])?.id ?? null,
      ...(chargedAmount === invoice.amount ? {} : { paidAmountHalalas: chargedAmount }),
      ...(currencies.size === 1 && onlyCurrency === invoice.currency
        ? {}
        : { paidCurrency: currencies.size === 1 && onlyCurrency ? onlyCurrency : 'MIXED' }),
    };
    const refundedHalalas = Math.min(returned, invoice.amount);
    return returned >= chargedAmount
      ? { ...common, status: 'refunded', refundedHalalas }
      : { ...common, status: 'paid', refundedHalalas };
  }

  const voided = payments.find((payment) => payment.status === 'voided');
  if (voided && RETURNED_INVOICE_STATUSES.includes(invoice.status)) {
    return {
      ...base,
      paymentId: voided.id,
      status: 'refunded',
      refundedHalalas: Math.min(voided.amount, invoice.amount),
      ...(voided.amount === invoice.amount ? {} : { paidAmountHalalas: voided.amount }),
      ...(voided.currency === invoice.currency ? {} : { paidCurrency: voided.currency }),
    };
  }
  if (invoice.status === 'paid') {
    return { ...base, paymentId: null, status: 'paid', refundedHalalas: 0 };
  }
  if (invoice.status === 'refunded') {
    return { ...base, paymentId: null, status: 'refunded', refundedHalalas: invoice.amount };
  }
  if (CLOSED_INVOICE_STATUSES.includes(invoice.status)) {
    return { ...base, paymentId: null, status: 'closed', refundedHalalas: 0 };
  }
  // initiated, on_hold, failed (the page may allow another attempt) and anything we do not know.
  return { ...base, paymentId: null, status: 'pending', refundedHalalas: 0 };
}

const webhookSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  type: z.string().min(1).max(100),
  secret_token: z.string(),
  data: z
    .object({
      id: z.union([z.string(), z.number()]).nullish(),
      invoice_id: z.string().nullish(),
      metadata: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
});

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Compares secrets of any length in constant time (both sides are hashed to the same length). */
export function secretsMatch(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

function text(value: unknown): string | null {
  if (typeof value === 'number') return String(value);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Authenticates and parses a Moyasar-shaped webhook body. Shared with the in-process fake
 * gateway so that both go through the same parser. `expectedSecret` unset means "no webhooks are
 * accepted" (fail closed).
 */
export function parseMoyasarWebhook(
  rawBody: string,
  expectedSecret: string | undefined,
  gatewayId: 'moyasar' | 'mock',
): GatewayWebhookEvent {
  if (!expectedSecret) {
    throw AppError.of('unauthorized', 'Webhooks are not configured');
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw AppError.of('bad_request', 'Webhook body is not JSON');
  }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) {
    // A body without a string secret_token cannot be authentic; do not say which part is missing.
    throw AppError.of('unauthorized', 'Webhook authentication failed');
  }
  const { secret_token: token, ...event } = parsed.data;
  if (!secretsMatch(token, expectedSecret)) {
    throw AppError.of('unauthorized', 'Webhook authentication failed');
  }

  // Hash what was sent minus the secret, so the stored hash cannot help guess it.
  const { secret_token: _secret, ...sent } = json as Record<string, unknown>;
  const payloadHash = createHash('sha256').update(JSON.stringify(sent)).digest('hex');
  const eventId = text(event.id);
  const invoiceId = text(event.data?.invoice_id);
  const reference = text(event.data?.metadata?.order_id);
  return {
    eventKey: `${gatewayId}:${eventId ?? `h:${payloadHash}`}`,
    type: event.type,
    payloadHash,
    invoiceId,
    paymentId: event.type.startsWith('payment') ? text(event.data?.id) : null,
    orderRef: reference,
  };
}

export function createMoyasarGateway(config: MoyasarConfig): BillingGateway {
  assertSafeConfig(config);
  const fetchImpl = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const authorization = `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`;
  const log = getLogger().child({ gateway: 'moyasar' });

  // The gateway's message goes to the log; make sure no key can ride along if it ever quotes one.
  const scrub = (message: string) =>
    message.replaceAll(config.secretKey, '[REDACTED]').replace(KEY_LIKE, '[REDACTED]');

  function failure(operation: string, status: number | null, message?: string): AppError {
    log.error('Moyasar request failed', {
      operation,
      status,
      ...(message ? { message: scrub(message).slice(0, MAX_ERROR_MESSAGE_CHARS) } : {}),
    });
    return AppError.of('provider_error', 'The payment gateway could not complete the request', {
      reason: 'gateway_error',
    });
  }

  type CallResult<T> = { found: false } | { found: true; data: T | undefined };

  /**
   * One JSON call. A 404 is `{ found: false }`; every other failure is a `provider_error`. Without
   * a `schema` any 2xx answer counts as success and the body is ignored (refunds and cancellations:
   * the caller re-reads the truth afterwards, a surprising body must not turn a done refund into an error).
   */
  async function call<T = never>(
    operation: string,
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    options: { body?: unknown; schema?: z.ZodType<T> } = {},
  ): Promise<CallResult<T>> {
    let response: Response;
    let bodyText: string;
    try {
      response = await fetchImpl(`${config.apiBase}${path}`, {
        method,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        // Never follow a redirect with our credentials attached.
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      bodyText = await response.text();
    } catch (error) {
      log.error('Moyasar request did not complete', { operation, err: error });
      throw AppError.of('provider_error', 'The payment gateway is unreachable', {
        reason: 'gateway_unreachable',
      });
    }
    if (bodyText.length > MAX_RESPONSE_CHARS) throw failure(operation, response.status);

    let json: unknown;
    try {
      json = bodyText === '' ? undefined : JSON.parse(bodyText);
    } catch {
      json = undefined;
    }
    if (response.status === 404) return { found: false };
    if (!response.ok) {
      const message =
        typeof json === 'object' && json !== null && 'message' in json
          ? String((json as { message: unknown }).message)
          : undefined;
      throw failure(operation, response.status, message);
    }
    if (!options.schema) return { found: true, data: undefined };
    const parsed = options.schema.safeParse(json);
    if (!parsed.success) throw failure(operation, response.status, 'unexpected response shape');
    return { found: true, data: parsed.data };
  }

  return {
    id: 'moyasar',

    async createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckout> {
      const created = await call('create_invoice', 'POST', '/invoices', {
        schema: invoiceSchema,
        body: {
          amount: input.amountHalalas,
          currency: input.currency,
          description: input.description,
          success_url: input.successUrl,
          back_url: input.backUrl,
          expired_at: new Date(input.expiresAt).toISOString(),
          metadata: { order_id: input.orderId },
        },
      });
      const invoice = created.found ? created.data : undefined;
      const url = invoice?.url ? safeHttpsUrl(invoice.url) : null;
      if (!invoice || !url) throw failure('create_invoice', null, 'no usable checkout url');
      if (invoice.amount !== input.amountHalalas || invoice.currency !== input.currency) {
        throw failure('create_invoice', null, 'gateway echoed a different amount');
      }
      return { invoiceId: invoice.id, checkoutUrl: url };
    },

    async fetchPayment({ invoiceId }): Promise<GatewayPaymentState | null> {
      const result = await call(
        'fetch_invoice',
        'GET',
        `/invoices/${encodeURIComponent(invoiceId)}`,
        { schema: invoiceSchema },
      );
      const invoice = result.found ? result.data : undefined;
      if (!invoice) return null;
      // We asked for this id; an answer about another invoice is never used.
      if (invoice.id !== invoiceId) throw failure('fetch_invoice', null, 'id mismatch');
      return toPaymentState(invoice);
    },

    async cancelCheckout(invoiceId) {
      const result = await call(
        'cancel_invoice',
        'PUT',
        `/invoices/${encodeURIComponent(invoiceId)}/cancel`,
      );
      if (!result.found) throw failure('cancel_invoice', 404);
    },

    async refund({ paymentId, amountHalalas }) {
      const result = await call(
        'refund_payment',
        'POST',
        `/payments/${encodeURIComponent(paymentId)}/refund`,
        { body: { amount: amountHalalas } },
      );
      if (!result.found) throw failure('refund_payment', 404);
    },

    verifyWebhook({ rawBody }) {
      return parseMoyasarWebhook(rawBody, config.webhookSecret, 'moyasar');
    },
  };
}

/** The hosted page must be a plain https URL (it is where the buyer's browser is sent). */
function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
