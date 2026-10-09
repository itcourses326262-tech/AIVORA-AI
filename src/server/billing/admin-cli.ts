import 'server-only';
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { LIVE_KEYS_REFUSED_PREFIX } from '@/lib/billing/gateway-config';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS } from '@/lib/billing/plans';
import { marginOf, TARGET_MARGIN_MULTIPLE } from '@/lib/billing/margin';
import { formatMoney } from '@/lib/billing/format';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/billing/types';
import { isAppError, AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { UsageError, type CommandContext } from '@/server/auth/admin/commands';
import { processIo, type CliIo } from '@/server/auth/admin/io';
import { getDb } from '@/server/db';
import { orders, users } from '@/server/db/schema';
import { EnvError, getEnv, type Env } from '@/server/env';
import { getGateway } from './config';
import { BillingConfigError } from './moyasar';
import { findOrder } from './orders';
import { refundOrder } from './refunds';
import { resolveReviewedOrder } from './review';
import { settleOrder } from './settle';

/**
 * Billing commands of `npm run admin` (wired in `scripts/admin.ts`, which hands everything else to
 * the account commands). Same conventions: `--help` lists them, exit 0 done / 1 failed / 2 usage.
 */

export const BILLING_USAGE = `Billing commands:
  billing-orders  [--status ${ORDER_STATUSES.join('|')}] [--email <email>] [--limit <n>] [--json]
                  lists orders, newest first; "needs_review" are the ones that need a person
  refund-order    <order id> [--amount-sar <n.nn>] [--expect-total-sar <n.nn>]   (also: --id <order id>)
                  refunds through the payment gateway (all that is left, or the amount) and takes the
                  matching credits back; credits already spent cannot be recovered, the order then
                  stays "needs_review" with the shortfall visible (credits - clawed back).
                  --expect-total-sar is the refunded total the gateway must show afterwards: use it
                  when you repeat a refund whose answer was lost, so it can never be refunded twice
  settle-order    <order id>                            (also: --id <order id>)
                  asks the gateway what happened to an order and applies it (what a webhook would do)
  resolve-order   <order id> --note "<what was decided>"   (also: --id <order id>)
                  closes an order in "needs_review" after a person dealt with it (moves no money and
                  no credits): refunded if all of it went back, paid if it was credited, else canceled
  billing-prices  prints the price list with VAT, price per credit and margin against the target

refund-order and settle-order talk to the real payment gateway only in production mode. On the
production host run them as:  NODE_ENV=production npm run admin -- <command>`;

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_USAGE = 2;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

function text(context: CommandContext, name: string): string | undefined {
  const value = context.values[name];
  return typeof value === 'string' ? value : undefined;
}

function orderId(context: CommandContext): string {
  const id = text(context, 'id');
  if (id === undefined || id === '') throw new UsageError('Missing the order id');
  if (!isValidId(id, 'ord')) throw new UsageError('That is not an order id (ord_…)');
  return id;
}

/** "12.5" -> 1250 halalas. Anything with more than two decimals or a sign is refused. */
export function parseSarToHalalas(value: string): number {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new UsageError('--amount-sar must look like 25 or 25.50');
  const halalas = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (halalas < 1) throw new UsageError('--amount-sar must be above zero');
  return halalas;
}

/** "SAR 29.00" with a plain space: terminal output gets copied, grepped and pasted into tickets. */
function sar(halalas: number): string {
  return formatMoney(halalas, 'en', { fractionDigits: 2 }).replace(/[\u00a0\u202f]/g, ' ');
}

function iso(ms: number | null): string {
  return ms === null ? '-' : new Date(ms).toISOString();
}

function listOrdersCommand(context: CommandContext): void {
  const statusText = text(context, 'status');
  const status = ORDER_STATUSES.find(
    (candidate): candidate is OrderStatus => candidate === statusText,
  );
  if (statusText !== undefined && status === undefined) {
    throw new UsageError(`--status must be one of: ${ORDER_STATUSES.join(', ')}`);
  }
  const limitText = text(context, 'limit');
  const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new UsageError(`--limit must be between 1 and ${MAX_LIMIT}`);
  }
  const email = text(context, 'email')?.trim().toLowerCase();

  const rows = getDb()
    .select({ order: orders, email: users.email })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(
      and(
        status === undefined ? undefined : eq(orders.status, status),
        email === undefined ? undefined : eq(users.email, email),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(limit)
    .all();

  if (context.values.json === true) {
    context.io.out(
      JSON.stringify(
        rows.map(({ order, email: owner }) => ({
          id: order.id,
          email: owner,
          kind: order.kind,
          itemId: order.itemId,
          status: order.status,
          amountHalalas: order.amountHalalas,
          vatHalalas: order.vatHalalas,
          credits: order.credits,
          refundedHalalas: order.refundedHalalas,
          clawedBackCredits: order.clawedBackCredits,
          shortfallCredits:
            order.paidAt === null
              ? 0
              : Math.max(
                  0,
                  Math.floor((order.credits * order.refundedHalalas) / order.amountHalalas) -
                    order.clawedBackCredits,
                ),
          gateway: order.gateway,
          createdAt: order.createdAt,
          paidAt: order.paidAt,
        })),
        null,
        2,
      ),
    );
    return;
  }
  if (rows.length === 0) {
    context.io.out('No orders.');
    return;
  }
  for (const { order, email: owner } of rows) {
    const refund =
      order.refundedHalalas > 0
        ? `  refunded ${sar(order.refundedHalalas)}, credits taken back ${order.clawedBackCredits}/${order.credits}`
        : '';
    context.io.out(
      `${order.id}  ${order.status.padEnd(12)}  ${order.kind.padEnd(20)}  ${order.itemId.padEnd(10)}  ${sar(order.amountHalalas).padStart(11)}  ${String(order.credits).padStart(6)} cr  ${owner}  ${iso(order.createdAt)}${refund}`,
    );
  }
}

const PRODUCTION_HINT =
  'On the production host run the command as: NODE_ENV=production npm run admin -- <command>';

/**
 * The environment, except that live payment keys on a machine started WITHOUT production mode are
 * explained by what to do (run in production mode) instead of by the env rule that tells a
 * developer how to switch the guard off: on the production host that is never the answer.
 */
function environmentForGateway(): Env {
  try {
    return getEnv();
  } catch (error) {
    if (
      error instanceof EnvError &&
      process.env.NODE_ENV !== 'production' &&
      error.problems.some((problem) => problem.startsWith(LIVE_KEYS_REFUSED_PREFIX))
    ) {
      throw AppError.of(
        'conflict',
        `This machine has live payment keys, which are only used in production mode (NODE_ENV=${process.env.NODE_ENV ?? 'not set'}). ${PRODUCTION_HINT}`,
      );
    }
    throw error;
  }
}

/**
 * Before an order is touched: which payment gateway THIS process would talk to, and whether it is
 * the one the order was made with. `npm run admin` runs in development mode unless told otherwise,
 * where the real gateway is (deliberately) not available; say so instead of failing in a way that
 * invites switching safety checks off.
 */
function assertGatewayFor(context: CommandContext, id: string): void {
  const { NODE_ENV: nodeEnv } = environmentForGateway();
  const order = findOrder(getDb(), id);
  if (!order) throw AppError.of('not_found', `No order ${id}`);
  let gatewayId: string;
  try {
    gatewayId = getGateway().id;
  } catch (error) {
    if (nodeEnv !== 'production') {
      throw AppError.of(
        'conflict',
        `Payments are not available in this mode (NODE_ENV=${nodeEnv}). ${PRODUCTION_HINT}`,
      );
    }
    throw error instanceof BillingConfigError || isAppError(error)
      ? error
      : new Error('Billing is not available');
  }
  context.io.err(`Payment gateway: ${gatewayId} (NODE_ENV=${nodeEnv})`);
  if (order.gateway !== gatewayId) {
    throw AppError.of(
      'conflict',
      `Order ${id} was made with the ${order.gateway} payment gateway, but this process uses ${gatewayId} (NODE_ENV=${nodeEnv}).${nodeEnv === 'production' ? '' : ` ${PRODUCTION_HINT}`}`,
    );
  }
  if (gatewayId === 'mock') {
    // An order OF the fake (a real order met by the fake is the "run it in production mode" case
    // above). The fake keeps its checkouts in the memory of the server that made them. A command
    // line is another process with an empty fake: it would call every payment "unknown" (and
    // settling would close a buyer's open checkout), so it must not pretend to speak for it.
    throw AppError.of(
      'conflict',
      'The fake payment gateway of development lives in the memory of the running server, so this command cannot refund or settle its orders. To try refunds from the command line, run the app with Moyasar test keys (BILLING_GATEWAY=moyasar, sk_test_...).',
    );
  }
}

async function refundOrderCommand(context: CommandContext): Promise<void> {
  const id = orderId(context);
  const amountText = text(context, 'amount-sar');
  const expectText = text(context, 'expect-total-sar');
  // Usage errors first: a malformed amount is the operator's typo, not a problem of the order.
  const amountHalalas = amountText === undefined ? undefined : parseSarToHalalas(amountText);
  const expectTotalHalalas = expectText === undefined ? undefined : parseSarToHalalas(expectText);
  assertGatewayFor(context, id);
  const result = await refundOrder(id, { amountHalalas, expectTotalHalalas });
  const { order } = result;
  context.io.out(
    `Gateway: ${sar(result.refundedBeforeHalalas)} had been refunded before, ${sar(result.refundedNowHalalas)} refunded now.`,
  );
  const balance = getDb()
    .select({ balance: users.creditBalance })
    .from(users)
    .where(eq(users.id, order.userId))
    .get()?.balance;
  context.io.out(
    `Order ${order.id} is ${order.status}: refunded ${sar(order.refundedHalalas)} of ${sar(order.amountHalalas)}, ${order.clawedBackCredits} of ${order.credits} credits taken back. Balance of the user: ${balance ?? '?'}.`,
  );
  if (order.status === 'needs_review') {
    context.io.err(
      `Some of the credits had already been spent (${order.credits - order.clawedBackCredits} could not be taken back). The order stays needs_review.`,
    );
  }
}

async function settleOrderCommand(context: CommandContext): Promise<void> {
  const id = orderId(context);
  assertGatewayFor(context, id);
  const result = await settleOrder(id);
  if (!result) throw AppError.of('not_found', `No order ${id}`);
  context.io.out(`Order ${id}: ${result.outcome}, status ${result.order.status}.`);
}

function resolveOrderCommand(context: CommandContext): void {
  const id = orderId(context);
  const note = text(context, 'note');
  if (note === undefined) throw new UsageError('Missing --note "<what was decided>"');
  const order = resolveReviewedOrder(id, note);
  context.io.out(`Order ${id} is closed as ${order.status}. Nothing was refunded or credited.`);
}

function pricesCommand(context: CommandContext): void {
  const vat = getEnv().VAT_RATE_PERCENT;
  const rows = [
    ...CREDIT_PACKS.map((pack) => ({
      label: `pack     ${pack.id}`,
      credits: pack.credits,
      price: pack.priceHalalas,
    })),
    ...SUBSCRIPTION_PLANS.map((plan) => ({
      label: `plan     ${plan.id}`,
      credits: plan.monthlyCredits,
      price: plan.priceHalalas,
    })),
  ];
  context.io.out(
    `Prices include ${vat}% VAT. Margin = net revenue / upstream cost (target ${TARGET_MARGIN_MULTIPLE}x).`,
  );
  for (const row of rows) {
    const margin = marginOf({ priceHalalas: row.price, credits: row.credits, vatPercent: vat });
    context.io.out(
      `${row.label.padEnd(22)} ${String(row.credits).padStart(6)} credits  ${sar(row.price).padStart(11)}  ${margin.pricePerCreditSar.toFixed(4)}/credit  VAT ${sar(margin.vatHalalas)}  margin ${margin.multiple.toFixed(2)}x${margin.meetsTarget ? '' : '  BELOW TARGET'}`,
    );
  }
}

interface CommandSpec {
  options: NonNullable<ParseArgsConfig['options']>;
  run: (context: CommandContext) => void | Promise<void>;
}

const COMMANDS: Record<string, CommandSpec> = {
  'billing-orders': {
    options: {
      status: { type: 'string' },
      email: { type: 'string' },
      limit: { type: 'string' },
      json: { type: 'boolean' },
    },
    run: listOrdersCommand,
  },
  'refund-order': {
    options: {
      id: { type: 'string' },
      'amount-sar': { type: 'string' },
      'expect-total-sar': { type: 'string' },
    },
    run: refundOrderCommand,
  },
  'settle-order': { options: { id: { type: 'string' } }, run: settleOrderCommand },
  'resolve-order': {
    options: { id: { type: 'string' }, note: { type: 'string' } },
    run: resolveOrderCommand,
  },
  'billing-prices': { options: {}, run: pricesCommand },
};

export function isBillingCommand(name: string | undefined): boolean {
  return name !== undefined && Object.hasOwn(COMMANDS, name);
}

/** Runs one billing command and returns the process exit code. Never exits or reads globals itself. */
export async function runBillingAdminCli(args: string[], io: CliIo = processIo): Promise<number> {
  const [name, ...rest] = args;
  const spec = name !== undefined && Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!spec) {
    io.err(`Unknown command "${name ?? ''}".\n\n${BILLING_USAGE}`);
    return EXIT_USAGE;
  }
  try {
    const parsed = parseArgs({ args: rest, options: spec.options, allowPositionals: true });
    const values: CommandContext['values'] = {};
    for (const [key, value] of Object.entries(parsed.values)) {
      if (typeof value === 'string' || typeof value === 'boolean') values[key] = value;
    }
    // The commands that act on one order take its id as the first argument too.
    if (Object.hasOwn(spec.options, 'id') && values.id === undefined && parsed.positionals[0]) {
      values.id = parsed.positionals[0];
      parsed.positionals.shift();
    }
    if (parsed.positionals.length > 0) {
      throw new UsageError(`Unexpected argument "${parsed.positionals[0]}"`);
    }
    environmentForGateway(); // the same explanation for every command, not only the ones that pay
    await spec.run({ io, values });
    return EXIT_OK;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (
      error instanceof UsageError ||
      (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS_'))
    ) {
      io.err(`${(error as Error).message}\n\nRun with --help for usage.`);
      return EXIT_USAGE;
    }
    io.err(
      `Failed: ${isAppError(error) ? error.message : error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_FAILED;
  }
}
