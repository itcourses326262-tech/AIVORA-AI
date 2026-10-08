// Child process used by race.test.ts. It opens its OWN connection to the shared database file
// (through getDb(), DATABASE_PATH points at it), waits until `startAt` so every process starts
// together, then does billing work and prints the tallies as JSON.
//
//   settle <startAt> <tag> <orderId>...   apply "paid" to each order, as a webhook would
//   tick   <startAt> <tag> <now>          run one scheduler tick with a counting stub gateway
import { setGatewayOverride } from '@/server/billing/config';
import type { BillingGateway } from '@/server/billing/gateway';
import { tick } from '@/server/billing/scheduler';
import { applyGatewayState } from '@/server/billing/settle';
import { getDb } from '@/server/db';

function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [mode, startAt, tag, ...rest] = process.argv.slice(2);
if (!mode || !startAt || !tag)
  throw new Error('usage: race-worker <settle|tick> <startAt> <tag> ...');

const db = getDb();
sleepUntil(Number(startAt));

if (mode === 'settle') {
  const outcomes: Record<string, number> = {};
  for (const orderId of rest) {
    const order = db.$client
      .prepare(
        'select amount_halalas as amount, currency, gateway_invoice_id as invoice from orders where id = ?',
      )
      .get(orderId) as { amount: number; currency: string; invoice: string };
    const result = applyGatewayState(
      db,
      orderId,
      {
        status: 'paid',
        invoiceId: order.invoice,
        paymentId: `pay_${orderId}`,
        amountHalalas: order.amount,
        currency: order.currency,
        reference: orderId,
        refundedHalalas: 0,
      },
      { now: Date.now() },
    );
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
  }
  console.log(JSON.stringify({ tag, outcomes }));
} else {
  let created = 0;
  const gateway: BillingGateway = {
    id: 'moyasar',
    async createCheckout(input) {
      created += 1;
      return {
        invoiceId: `inv_${input.orderId}`,
        checkoutUrl: `https://checkout.moyasar.com/invoices/inv_${input.orderId}`,
      };
    },
    async fetchPayment({ invoiceId }) {
      return {
        status: 'pending',
        invoiceId,
        paymentId: null,
        amountHalalas: 0,
        currency: 'SAR',
        reference: null,
        refundedHalalas: 0,
      };
    },
    async cancelCheckout() {},
    async refund() {},
    verifyWebhook() {
      throw new Error('not used');
    },
  };
  setGatewayOverride(gateway);
  const report = await tick(Number(rest[0]));
  console.log(JSON.stringify({ tag, created, report }));
}
db.$client.close();
