// Child process used by mail-race.test.ts. It opens its OWN connection to the shared database file
// (DATABASE_PATH points at it), waits until `startAt` so every process starts together, does
// billing work that records and sends mail, and prints what it queued. Without SMTP the outbox
// transport appends every message to `outbox.jsonl` next to the database, which is where the test
// counts what really left the processes.
//
//   settle <startAt> <tag> <orderId>...   apply "paid" to each order, as a webhook would, and dispatch
//   sweep  <startAt> <tag>                dispatch what is recorded and unsent (a restarted scheduler)
//   tick   <startAt> <tag> <now>          run one scheduler tick with a stub gateway
import { setGatewayOverride } from '@/server/billing/config';
import type { BillingGateway } from '@/server/billing/gateway';
import { dispatchBillingMail } from '@/server/billing/mail';
import { tick } from '@/server/billing/scheduler';
import { applyGatewayState } from '@/server/billing/settle';
import { getDb } from '@/server/db';
import { flushEmails } from '@/server/email';

function sleepUntil(epochMs: number): void {
  for (let remaining = epochMs - Date.now(); remaining > 0; remaining = epochMs - Date.now()) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, remaining);
  }
}

const [mode, startAt, tag, ...rest] = process.argv.slice(2);
if (!mode || !startAt || !tag) {
  throw new Error('usage: mail-race-worker <settle|sweep|tick> <startAt> <tag> ...');
}

const db = getDb();
sleepUntil(Number(startAt));

let queued = 0;
if (mode === 'settle') {
  for (const orderId of rest) {
    const order = db.$client
      .prepare(
        'select amount_halalas as amount, currency, gateway_invoice_id as invoice from orders where id = ?',
      )
      .get(orderId) as { amount: number; currency: string; invoice: string };
    applyGatewayState(
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
    queued += dispatchBillingMail();
  }
} else if (mode === 'sweep') {
  for (let pass = 0; pass < 3; pass += 1) queued += dispatchBillingMail();
} else {
  const gateway: BillingGateway = {
    id: 'moyasar',
    async createCheckout(input) {
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
  await tick(Number(rest[0]));
}
await flushEmails();
console.log(JSON.stringify({ tag, queued }));
db.$client.close();
