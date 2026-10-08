import { describe, expect, it } from 'vitest';
import {
  BILLING_USAGE,
  isBillingCommand,
  parseSarToHalalas,
  runBillingAdminCli,
} from '@/server/billing/admin-cli';
import { createCheckout } from '@/server/billing/orders';
import { settleOrder } from '@/server/billing/settle';
import type { CliIo } from '@/server/auth/admin/io';
import { billingTest } from './support';

const t = billingTest();

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

async function bought(email = 'buyer@example.com') {
  const user = t.newUser({ email });
  const { order } = await createCheckout(
    user.id,
    { type: 'pack', id: 'pack-500' },
    { idempotencyKey: `k-${email}` },
  );
  t.moyasar.pay(order.id);
  await settleOrder(order.id);
  return { user, order };
}

describe('billing admin commands', () => {
  it('knows its own commands and lists them in the help', () => {
    for (const name of ['billing-orders', 'refund-order', 'settle-order', 'billing-prices']) {
      expect(isBillingCommand(name), name).toBe(true);
      expect(BILLING_USAGE).toContain(name);
    }
    expect(isBillingCommand('grant-credits')).toBe(false);
    expect(isBillingCommand(undefined)).toBe(false);
    expect(isBillingCommand('__proto__')).toBe(false);
  });

  it('billing-orders lists orders and filters by status and email', async () => {
    await bought('a@example.com');
    const pending = t.newUser({ email: 'b@example.com' });
    await createCheckout(pending.id, { type: 'pack', id: 'pack-1500' }, { idempotencyKey: 'p' });

    const all = fakeIo();
    expect(await runBillingAdminCli(['billing-orders'], all.io)).toBe(0);
    expect(all.out).toHaveLength(2);

    const paid = fakeIo();
    await runBillingAdminCli(['billing-orders', '--status', 'paid'], paid.io);
    expect(paid.out).toHaveLength(1);
    expect(paid.out[0]).toContain('a@example.com');
    expect(paid.out[0]).toContain('SAR 29.00');

    const mine = fakeIo();
    await runBillingAdminCli(['billing-orders', '--email', 'B@Example.com'], mine.io);
    expect(mine.out).toHaveLength(1);
    expect(mine.out[0]).toContain('pending');

    const json = fakeIo();
    await runBillingAdminCli(['billing-orders', '--json', '--status', 'paid'], json.io);
    expect(JSON.parse(json.out[0] ?? '[]')).toMatchObject([
      { email: 'a@example.com', status: 'paid', amountHalalas: 2900, shortfallCredits: 0 },
    ]);

    const none = fakeIo();
    await runBillingAdminCli(['billing-orders', '--status', 'refunded'], none.io);
    expect(none.out).toEqual(['No orders.']);
  });

  it('refund-order refunds through the gateway and takes the credits back', async () => {
    const { order, user } = await bought();
    const cli = fakeIo();

    expect(await runBillingAdminCli(['refund-order', '--id', order.id], cli.io)).toBe(0);

    expect(cli.out.join('\n')).toMatch(
      /is refunded: refunded SAR 29.00 of SAR 29.00, 500 of 500 credits taken back/,
    );
    expect(t.balance(user.id)).toBe(0);
    expect(t.order(order.id).status).toBe('refunded');
  });

  it('takes the order id as the first argument or as --id', async () => {
    const { order, user } = await bought();
    const positional = fakeIo();
    expect(await runBillingAdminCli(['settle-order', order.id], positional.io)).toBe(0);
    expect(positional.out[0]).toContain(order.id);

    const refund = fakeIo();
    expect(
      await runBillingAdminCli(['refund-order', order.id, '--amount-sar', '29'], refund.io),
    ).toBe(0);
    expect(t.order(order.id).status).toBe('refunded');
    expect(t.balance(user.id)).toBe(0);

    const extra = fakeIo();
    expect(await runBillingAdminCli(['settle-order', order.id, 'surprise'], extra.io)).toBe(2);
    const stray = fakeIo();
    expect(await runBillingAdminCli(['billing-prices', 'surprise'], stray.io)).toBe(2);
  });

  it('refund-order can refund part of a payment and warns when credits were spent', async () => {
    const { order, user } = await bought();
    const partial = fakeIo();
    expect(
      await runBillingAdminCli(
        ['refund-order', '--id', order.id, '--amount-sar', '14.50'],
        partial.io,
      ),
    ).toBe(0);
    expect(t.order(order.id)).toMatchObject({ refundedHalalas: 1450, status: 'paid' });
    expect(t.balance(user.id)).toBe(250);

    t.db.$client.prepare('update users set credit_balance = 100 where id = ?').run(user.id);
    t.db.$client
      .prepare(
        "update credit_ledger set balance_after = 100 where user_id = ? and reason = 'purchase'",
      )
      .run(user.id);
    const rest = fakeIo();
    expect(await runBillingAdminCli(['refund-order', '--id', order.id], rest.io)).toBe(0);
    expect(t.order(order.id).status).toBe('needs_review');
    expect(rest.err.join('\n')).toMatch(/could not be taken back/);
  });

  it('reports usage errors with exit code 2 and failures with exit code 1', async () => {
    for (const args of [
      ['refund-order'],
      ['refund-order', '--id', 'not-an-order'],
      ['refund-order', '--id', 'usr_00000000000000000000000000'],
      ['refund-order', '--id', 'ord_00000000000000000000000000', '--amount-sar', '1.234'],
      ['refund-order', '--id', 'ord_00000000000000000000000000', '--amount-sar', '-5'],
      ['billing-orders', '--status', 'weird'],
      ['billing-orders', '--limit', '0'],
      ['billing-orders', '--bogus'],
      ['nope'],
    ]) {
      const cli = fakeIo();
      expect(await runBillingAdminCli(args, cli.io), args.join(' ')).toBe(2);
      expect(cli.err.length).toBeGreaterThan(0);
    }
    const unknown = fakeIo();
    expect(
      await runBillingAdminCli(
        ['refund-order', '--id', 'ord_00000000000000000000000000'],
        unknown.io,
      ),
    ).toBe(1);
    expect(unknown.err[0]).toMatch(/^Failed:/);
    const settle = fakeIo();
    expect(
      await runBillingAdminCli(
        ['settle-order', '--id', 'ord_00000000000000000000000000'],
        settle.io,
      ),
    ).toBe(1);
  });

  it('settle-order applies what the gateway says', async () => {
    const user = t.newUser();
    const { order } = await createCheckout(
      user.id,
      { type: 'pack', id: 'pack-500' },
      { idempotencyKey: 'k' },
    );
    t.moyasar.pay(order.id);
    const cli = fakeIo();

    expect(await runBillingAdminCli(['settle-order', '--id', order.id], cli.io)).toBe(0);

    expect(cli.out[0]).toContain('paid');
    expect(t.balance(user.id)).toBe(500);
  });

  it('billing-prices prints the table with the margin against the target', async () => {
    const cli = fakeIo();
    expect(await runBillingAdminCli(['billing-prices'], cli.io)).toBe(0);
    expect(cli.out[0]).toMatch(/15% VAT/);
    expect(cli.out).toHaveLength(7);
    expect(cli.out.join('\n')).toMatch(/pack-500\s+500 credits\s+SAR 29.00/);
    expect(cli.out.join('\n')).not.toMatch(/BELOW TARGET/);
  });

  it('parses riyal amounts exactly', () => {
    expect(parseSarToHalalas('25')).toBe(2500);
    expect(parseSarToHalalas('25.5')).toBe(2550);
    expect(parseSarToHalalas('25.05')).toBe(2505);
    expect(parseSarToHalalas('0.01')).toBe(1);
    for (const bad of ['', '-1', '1.', '.5', '1.234', '1e3', 'abc', '0', '0.00', '99999999']) {
      expect(() => parseSarToHalalas(bad), bad).toThrow();
    }
  });
});
