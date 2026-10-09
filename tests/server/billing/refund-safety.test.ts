import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';
import { runBillingAdminCli } from '@/server/billing/admin-cli';
import { setGatewayOverride } from '@/server/billing/config';
import type { BillingGateway } from '@/server/billing/gateway';
import { createCheckout } from '@/server/billing/orders';
import { refundOrder } from '@/server/billing/refunds';
import { settleOrder } from '@/server/billing/settle';
import { resetEnvForTests } from '@/server/env';
import type { CliIo } from '@/server/auth/admin/io';
import { expectConsistentLedger } from '../../helpers/credits';
import { billingTest } from './support';

const t = billingTest();

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});

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

/** The real gateway with `refund` and/or `fetchPayment` replaced. */
function wrapGateway(over: Partial<BillingGateway>): BillingGateway {
  const wrapped: BillingGateway = {
    id: t.gateway.id,
    createCheckout: (input) => t.gateway.createCheckout(input),
    fetchPayment: (ref) => t.gateway.fetchPayment(ref),
    cancelCheckout: (invoiceId) => t.gateway.cancelCheckout(invoiceId),
    refund: (input) => t.gateway.refund(input),
    verifyWebhook: (delivery) => t.gateway.verifyWebhook(delivery),
    ...over,
  };
  setGatewayOverride(wrapped);
  return wrapped;
}

function fakeIo() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    readSecret: async () => '',
    env: () => undefined,
  };
  return { io, out, err };
}

describe('a refund whose answer was lost', () => {
  it('is recognised as done: credits are taken back and the command does not fail', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    wrapGateway({
      async refund(input) {
        await t.gateway.refund(input); // the money went back...
        throw AppError.of('provider_error', 'timeout'); // ...but the answer never arrived
      },
    });

    const result = await refundOrder(order.id);

    expect(result.order).toMatchObject({ status: 'refunded', clawedBackCredits: 500 });
    expect(result.refundedNowHalalas).toBe(order.amountHalalas);
    expect(t.balance(user.id)).toBe(0);
    expect(t.moyasar.callsTo('POST', /\/refund$/)).toHaveLength(1);
    expectConsistentLedger(t.db, user.id, 0);
  });

  it('a refund the gateway really refused is reported as not done, with what it does show', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    wrapGateway({
      async refund() {
        throw AppError.of('provider_error', 'refused');
      },
    });

    await expect(refundOrder(order.id)).rejects.toMatchObject({
      code: 'provider_error',
      message: expect.stringContaining('did not complete the refund'),
      details: { refundedHalalas: 0 },
    });
    expect(t.balance(user.id)).toBe(500);
    expect(t.order(order.id).status).toBe('paid');
  });

  it('when the gateway cannot even be asked afterwards, the operator is told to look before retrying', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    let reads = 0;
    wrapGateway({
      async fetchPayment(ref) {
        reads += 1;
        // The first two reads (settle, then the refund's own look) work; later ones fail.
        if (reads > 2) throw AppError.of('provider_error', 'down');
        return t.gateway.fetchPayment(ref);
      },
      async refund() {
        throw AppError.of('provider_error', 'timeout');
      },
    });

    const error = await refundOrder(order.id).catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'provider_error' });
    expect((error as Error).message).toMatch(/BEFORE running this command again/);
    expect(t.balance(user.id)).toBe(500);
  });
});

describe('--expect-total guards a repeated explicit refund', () => {
  it('refunds once; the same command again refuses instead of refunding twice', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id, 'pack-1500');

    const first = await refundOrder(order.id, { amountHalalas: 1000, expectTotalHalalas: 1000 });
    expect(first.order.refundedHalalas).toBe(1000);
    expect(first.refundedBeforeHalalas).toBe(0);

    await expect(
      refundOrder(order.id, { amountHalalas: 1000, expectTotalHalalas: 1000 }),
    ).rejects.toMatchObject({
      code: 'conflict',
      details: { refundedHalalas: 1000, amountHalalas: 1000 },
    });
    expect(t.moyasar.callsTo('POST', /\/refund$/)).toHaveLength(1);
    expect(t.order(order.id).refundedHalalas).toBe(1000);
  });

  it('without it the amount is still read from the gateway and capped', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    await refundOrder(order.id, { amountHalalas: 1000 });
    await expect(
      refundOrder(order.id, { amountHalalas: order.amountHalalas }),
    ).rejects.toMatchObject({ code: 'bad_request', details: { refundedHalalas: 1000 } });
    expect(t.moyasar.callsTo('POST', /\/refund$/)).toHaveLength(1);
  });

  it('the command takes --expect-total-sar and reports what the gateway had refunded', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);

    const first = fakeIo();
    expect(
      await runBillingAdminCli(
        ['refund-order', order.id, '--amount-sar', '10', '--expect-total-sar', '10'],
        first.io,
      ),
    ).toBe(0);
    expect(first.out.join('\n')).toContain(
      'SAR 0.00 had been refunded before, SAR 10.00 refunded now',
    );

    const repeat = fakeIo();
    expect(
      await runBillingAdminCli(
        ['refund-order', order.id, '--amount-sar', '10', '--expect-total-sar', '10'],
        repeat.io,
      ),
    ).toBe(1);
    expect(repeat.err.join('\n')).toContain('Nothing was refunded');
    expect(t.moyasar.callsTo('POST', /\/refund$/)).toHaveLength(1);

    const typo = fakeIo();
    expect(
      await runBillingAdminCli(['refund-order', order.id, '--expect-total-sar', '1.234'], typo.io),
    ).toBe(2);
  });
});

describe('the command says what is wrong when it runs in the wrong mode', () => {
  it('development mode cannot reach an order made with Moyasar, and the hint is to use production mode', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    setGatewayOverride(null); // `npm run admin` without NODE_ENV: the fake gateway is selected
    vi.stubEnv('NODE_ENV', 'development');
    resetEnvForTests();

    for (const command of ['refund-order', 'settle-order']) {
      const cli = fakeIo();
      expect(await runBillingAdminCli([command, order.id], cli.io), command).toBe(1);
      const message = cli.err.join('\n');
      expect(message).toContain('made with the moyasar payment gateway');
      expect(message).toContain('this process uses mock (NODE_ENV=development)');
      expect(message).toContain('NODE_ENV=production npm run admin');
      expect(message).not.toContain('MOYASAR_ALLOW_LIVE_IN_DEV');
    }
    expect(t.balance(user.id)).toBe(500);
  });

  it('a live key refused outside production does not push the operator to switch the guard off', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    setGatewayOverride(null);
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BILLING_GATEWAY', 'moyasar');
    vi.stubEnv('MOYASAR_SECRET_KEY', 'sk_live_' + 'ZyXwVuTsRqPoNmLkJiHgFeDc');
    resetEnvForTests();

    // The environment itself is refused at parse time; every billing command explains it the same way,
    // also the read-only ones the operator runs first to find the order.
    for (const args of [['refund-order', order.id], ['billing-orders'], ['billing-prices']]) {
      const cli = fakeIo();
      expect(await runBillingAdminCli(args, cli.io), args.join(' ')).toBe(1);
      const message = cli.err.join('\n');
      expect(message).not.toContain('ZyXwVuTsRqPoNmLkJiHgFeDc');
      expect(message).not.toContain('MOYASAR_ALLOW_LIVE_IN_DEV');
      expect(message).toContain('NODE_ENV=production');
    }
  });

  it('names the mode it runs in when it goes ahead', async () => {
    const user = t.newUser();
    const order = await paidPack(user.id);
    const cli = fakeIo();

    expect(await runBillingAdminCli(['settle-order', order.id], cli.io)).toBe(0);
    expect(cli.err.join('\n')).toContain('Payment gateway: moyasar (NODE_ENV=test)');
  });
});
