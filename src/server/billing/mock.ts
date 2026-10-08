import 'server-only';
import { randomUUID } from 'node:crypto';
import { AppError } from '@/lib/errors';
import { getEnv } from '@/server/env';
import type {
  BillingGateway,
  GatewayCheckout,
  GatewayCheckoutInput,
  GatewayPaymentState,
  GatewayWebhookEvent,
} from './gateway';
import { parseMoyasarWebhook } from './moyasar';

/**
 * The in-process fake gateway for development, tests and demos. It looks like Moyasar to the rest
 * of the code (the same `BillingGateway` interface, the same webhook body, the same hosted-page
 * round trip through `/billing/mock-checkout/[orderId]`), so the real services, routes and
 * scheduler run unchanged around it.
 *
 * It must never exist in production: a "Pay" button that hands out credits for free is exactly
 * what a misconfigured deployment would sell. `resolveBillingMode` never selects it there,
 * `parseEnv` refuses `BILLING_GATEWAY=mock` there, and this file refuses to be constructed there
 * (the third, independent line of defence; it reads `process.env` itself on purpose).
 */

export const MOCK_WEBHOOK_SECRET = 'mock-gateway-webhook-secret-development-only';

type MockInvoiceStatus = 'initiated' | 'paid' | 'closed';

interface MockInvoice {
  id: string;
  orderId: string;
  amountHalalas: number;
  currency: string;
  status: MockInvoiceStatus;
  paymentId: string | null;
  refundedHalalas: number;
  expiresAt: number;
}

export function assertMockAllowed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The mock billing gateway cannot be used in production');
  }
}

export interface MockWebhookDelivery {
  rawBody: string;
  headers: Headers;
}

export interface MockGateway extends BillingGateway {
  readonly id: 'mock';
  /** The buyer pays on the fake page. Throws when the checkout cannot be paid any more. */
  simulatePayment(orderId: string): void;
  /** The buyer's payment is declined and the checkout is abandoned. */
  simulateDecline(orderId: string): void;
  /** What Moyasar would POST after `type` happened to the order's checkout. */
  webhookFor(orderId: string, type: MockWebhookType): MockWebhookDelivery;
  /** Whether the fake knows a checkout for this order. */
  hasCheckout(orderId: string): boolean;
}

export type MockWebhookType =
  'payment_paid' | 'payment_failed' | 'payment_refunded' | 'payment_voided';

export interface MockGatewayOptions {
  appUrl: string;
  now?: () => number;
}

export function createMockGateway(options: MockGatewayOptions): MockGateway {
  assertMockAllowed();
  const now = options.now ?? Date.now;
  const invoices = new Map<string, MockInvoice>();
  const byOrder = new Map<string, string>();

  const invoiceOf = (invoiceId: string): MockInvoice | undefined => {
    const invoice = invoices.get(invoiceId);
    if (invoice && invoice.status === 'initiated' && invoice.expiresAt <= now()) {
      invoice.status = 'closed';
    }
    return invoice;
  };
  const invoiceOfOrder = (orderId: string): MockInvoice => {
    const id = byOrder.get(orderId);
    const invoice = id === undefined ? undefined : invoiceOf(id);
    if (!invoice) throw AppError.of('not_found', 'No mock checkout for this order');
    return invoice;
  };

  return {
    id: 'mock',

    async createCheckout(input: GatewayCheckoutInput): Promise<GatewayCheckout> {
      const invoice: MockInvoice = {
        id: `mock_inv_${randomUUID()}`,
        orderId: input.orderId,
        amountHalalas: input.amountHalalas,
        currency: input.currency,
        status: 'initiated',
        paymentId: null,
        refundedHalalas: 0,
        expiresAt: input.expiresAt,
      };
      invoices.set(invoice.id, invoice);
      byOrder.set(input.orderId, invoice.id);
      return {
        invoiceId: invoice.id,
        checkoutUrl: `${options.appUrl}/billing/mock-checkout/${input.orderId}`,
      };
    },

    async fetchPayment({ invoiceId }): Promise<GatewayPaymentState | null> {
      const invoice = invoiceOf(invoiceId);
      if (!invoice) return null;
      const base = {
        invoiceId: invoice.id,
        paymentId: invoice.paymentId,
        amountHalalas: invoice.amountHalalas,
        currency: invoice.currency,
        reference: invoice.orderId,
      };
      if (invoice.status === 'paid') {
        return invoice.refundedHalalas >= invoice.amountHalalas
          ? { ...base, status: 'refunded', refundedHalalas: invoice.amountHalalas }
          : { ...base, status: 'paid', refundedHalalas: invoice.refundedHalalas };
      }
      return {
        ...base,
        status: invoice.status === 'closed' ? 'closed' : 'pending',
        refundedHalalas: 0,
      };
    },

    async cancelCheckout(invoiceId) {
      const invoice = invoiceOf(invoiceId);
      if (!invoice) throw AppError.of('provider_error', 'Unknown mock checkout');
      if (invoice.status === 'paid') {
        throw AppError.of('provider_error', 'The mock checkout was already paid');
      }
      invoice.status = 'closed';
    },

    async refund({ paymentId, amountHalalas }) {
      const invoice = [...invoices.values()].find((candidate) => candidate.paymentId === paymentId);
      if (!invoice || invoice.status !== 'paid') {
        throw AppError.of('provider_error', 'Unknown or unpaid mock payment');
      }
      if (invoice.refundedHalalas + amountHalalas > invoice.amountHalalas) {
        throw AppError.of('provider_error', 'Refund exceeds the payment');
      }
      invoice.refundedHalalas += amountHalalas;
    },

    verifyWebhook({ rawBody }): GatewayWebhookEvent {
      return parseMoyasarWebhook(rawBody, MOCK_WEBHOOK_SECRET, 'mock');
    },

    simulatePayment(orderId) {
      const invoice = invoiceOfOrder(orderId);
      if (invoice.status !== 'initiated') {
        throw AppError.of('conflict', 'This mock checkout can no longer be paid');
      }
      invoice.status = 'paid';
      invoice.paymentId = `mock_pay_${randomUUID()}`;
    },

    simulateDecline(orderId) {
      const invoice = invoiceOfOrder(orderId);
      if (invoice.status !== 'initiated') {
        throw AppError.of('conflict', 'This mock checkout can no longer be declined');
      }
      invoice.status = 'closed';
    },

    webhookFor(orderId, type) {
      const invoice = invoiceOfOrder(orderId);
      const body = {
        id: `evt_mock_${randomUUID()}`,
        type,
        created_at: new Date(now()).toISOString(),
        secret_token: MOCK_WEBHOOK_SECRET,
        account_name: 'AIVORE mock',
        live: false,
        data: {
          id: invoice.paymentId ?? `mock_pay_attempt_${invoice.id}`,
          invoice_id: invoice.id,
          amount: invoice.amountHalalas,
          currency: invoice.currency,
          metadata: { order_id: invoice.orderId },
        },
      };
      return {
        rawBody: JSON.stringify(body),
        headers: new Headers({ 'content-type': 'application/json' }),
      };
    },

    hasCheckout: (orderId) => byOrder.has(orderId),
  };
}

// One fake per server process, shared by every route bundle and by dev HMR.
const SINGLETON_KEY = Symbol.for('aivore.mockBillingGateway');
type GlobalWithMock = typeof globalThis & { [SINGLETON_KEY]?: MockGateway };

export function getMockGateway(): MockGateway {
  assertMockAllowed();
  const scope = globalThis as GlobalWithMock;
  scope[SINGLETON_KEY] ??= createMockGateway({ appUrl: getEnv().APP_URL });
  return scope[SINGLETON_KEY];
}

/** Forgets the shared fake (tests). */
export function resetMockGatewayForTests(): void {
  (globalThis as GlobalWithMock)[SINGLETON_KEY] = undefined;
}
