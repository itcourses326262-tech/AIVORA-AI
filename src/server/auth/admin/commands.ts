import 'server-only';
import { and, count, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { UserRole } from '@/lib/api-types';
import { USER_ROLES } from '@/lib/api-types';
import { LIVE_SUBSCRIPTION_STATUSES } from '@/lib/billing/types';
import { AppError } from '@/lib/errors';
import { LOCALES, isLocale, type Locale } from '@/lib/i18n/locales';
import { MAX_CREDIT_AMOUNT, grantCredits } from '@/server/credits';
import { getDb, withTx } from '@/server/db';
import {
  assets,
  generations,
  orders,
  sessions,
  subscriptions,
  users,
  type UserRow,
} from '@/server/db/schema';
import { flushEmails, isSmtpConfigured, outboxFilePath } from '@/server/email';
import { getEnv } from '@/server/env';
import { deleteAccount, resumeAccountPurges } from '../account-deletion';
import { isEmailVerificationRequired } from '../email-policy';
import { assertPasswordPolicy, hashPassword } from '../password';
import { provisionUser } from '../users';
import { markEmailVerified, resendVerificationNow } from '../verification';
import { normalizeEmail } from '../validation';
import type { CliIo } from './io';

/** A problem with how the command was called: reported with the usage text, exit code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

export interface CommandContext {
  io: CliIo;
  values: Record<string, string | boolean | undefined>;
}

function text(context: CommandContext, name: string): string | undefined {
  const value = context.values[name];
  return typeof value === 'string' ? value : undefined;
}

function required(context: CommandContext, name: string): string {
  const value = text(context, name);
  if (value === undefined || value === '') throw new UsageError(`Missing --${name}`);
  return value;
}

function whole(context: CommandContext, name: string): number | undefined {
  const value = text(context, name);
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(value)) throw new UsageError(`--${name} must be a whole number`);
  return Number(value);
}

function roleOption(context: CommandContext): UserRole | undefined {
  const value = text(context, 'role');
  if (value === undefined) return undefined;
  const role = USER_ROLES.find((candidate) => candidate === value);
  if (!role) throw new UsageError(`--role must be one of: ${USER_ROLES.join(', ')}`);
  return role;
}

function localeOption(context: CommandContext): Locale | undefined {
  const value = text(context, 'locale');
  if (value === undefined) return undefined;
  if (!isLocale(value)) throw new UsageError(`--locale must be one of: ${LOCALES.join(', ')}`);
  return value;
}

function findUser(context: CommandContext): UserRow {
  const email = normalizeEmail(required(context, 'email'));
  const user = getDb().select().from(users).where(eq(users.email, email)).get();
  if (!user) throw AppError.of('not_found', `No user with email ${email}`);
  return user;
}

/**
 * Like {@link findUser}, but a deleted account (whose email is a tombstone) is found by `--id`
 * too, which is how a leftover purge is resumed.
 */
function findUserByEmailOrId(context: CommandContext): UserRow {
  const id = text(context, 'id');
  if (id === undefined) return findUser(context);
  const user = getDb().select().from(users).where(eq(users.id, id)).get();
  if (!user) throw AppError.of('not_found', `No user with id ${id}`);
  return user;
}

/** The new password from `--password-stdin`, `--password`, `AIVORE_ADMIN_PASSWORD` or a prompt. */
async function passwordFrom(context: CommandContext, confirm: boolean): Promise<string> {
  const { io } = context;
  if (context.values['password-stdin'] === true) return io.readSecret('');
  const given = text(context, 'password');
  if (given !== undefined) {
    io.err('Warning: a password on the command line ends up in shell history and process lists.');
    return given;
  }
  const fromEnv = io.env('AIVORE_ADMIN_PASSWORD');
  if (fromEnv) return fromEnv;
  const first = await io.readSecret('Password: ');
  if (confirm && (await io.readSecret('Repeat password: ')) !== first) {
    throw new Error('The passwords do not match');
  }
  return first;
}

function adminCount(): number {
  const row = getDb()
    .select({ total: count() })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
    .get();
  return row?.total ?? 0;
}

/** Losing the last active admin would lock everyone out of admin tooling; `--force` overrides. */
function assertNotLastAdmin(context: CommandContext, user: UserRow, action: string): void {
  if (user.role !== 'admin' || user.disabledAt !== null) return;
  if (context.values.force === true || adminCount() > 1) return;
  throw new Error(`Refusing to ${action} the last active admin (${user.email}). Use --force.`);
}

// ---- Commands --------------------------------------------------------------------------------

export async function createUser(context: CommandContext): Promise<void> {
  const email = required(context, 'email');
  const locale = localeOption(context);
  const password = await passwordFrom(context, true);
  const user = await provisionUser({
    email,
    password,
    name: text(context, 'name') ?? normalizeEmail(email).split('@')[0] ?? 'User',
    locale,
    role: roleOption(context),
    bonusCredits: whole(context, 'credits'),
  });
  context.io.out(
    `Created ${user.role} ${user.email} (${user.id}) with ${user.creditBalance} credits.`,
  );
}

export function grantCreditsTo(context: CommandContext): void {
  const user = findUser(context);
  const amount = whole(context, 'amount');
  if (amount === undefined) throw new UsageError('Missing --amount');
  if (amount < 1 || amount > MAX_CREDIT_AMOUNT) {
    throw new UsageError(`--amount must be between 1 and ${MAX_CREDIT_AMOUNT}`);
  }
  const entry = grantCredits(getDb(), {
    userId: user.id,
    amount,
    reason: 'admin_grant',
    note: text(context, 'note'),
  });
  context.io.out(`Granted ${amount} credits to ${user.email}. Balance: ${entry.balanceAfter}.`);
}

export function setRole(context: CommandContext): void {
  const user = findUser(context);
  const role = roleOption(context);
  if (!role) throw new UsageError('Missing --role');
  if (role === 'user') assertNotLastAdmin(context, user, 'demote');
  getDb().update(users).set({ role, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
  context.io.out(`${user.email} is now ${role}.`);
}

export function disableUser(context: CommandContext): void {
  const user = findUser(context);
  assertNotLastAdmin(context, user, 'disable');
  withTx(getDb(), (tx) => {
    const now = Date.now();
    tx.update(users).set({ disabledAt: now, updatedAt: now }).where(eq(users.id, user.id)).run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
  });
  context.io.out(`Disabled ${user.email} and signed them out everywhere.`);
}

export function enableUser(context: CommandContext): void {
  const user = findUser(context);
  getDb()
    .update(users)
    .set({ disabledAt: null, updatedAt: Date.now() })
    .where(eq(users.id, user.id))
    .run();
  context.io.out(`Enabled ${user.email}.`);
}

export async function resetPassword(context: CommandContext): Promise<void> {
  const user = findUser(context);
  const password = await passwordFrom(context, true);
  assertPasswordPolicy(password, { email: user.email });
  const passwordHash = await hashPassword(password);
  withTx(getDb(), (tx) => {
    tx.update(users)
      .set({ passwordHash, hasPassword: true, updatedAt: Date.now() })
      .where(eq(users.id, user.id))
      .run();
    tx.delete(sessions).where(eq(sessions.userId, user.id)).run();
  });
  context.io.out(`Password of ${user.email} changed; all their sessions were revoked.`);
}

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 1000;

export function listUsers(context: CommandContext): void {
  const limit = whole(context, 'limit') ?? DEFAULT_LIST_LIMIT;
  if (limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new UsageError(`--limit must be between 1 and ${MAX_LIST_LIMIT}`);
  }
  const search = text(context, 'search');
  const pattern = search === undefined ? undefined : `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const rows = getDb()
    .select()
    .from(users)
    .where(
      pattern === undefined
        ? undefined
        : or(
            sql`${users.email} like ${pattern} escape '\\'`,
            sql`${users.name} like ${pattern} escape '\\'`,
          ),
    )
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit)
    .all();

  const summary = rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    credits: row.creditBalance,
    status: row.disabledAt === null ? 'active' : 'disabled',
    createdAt: new Date(row.createdAt).toISOString(),
  }));
  if (context.values.json === true) {
    context.io.out(JSON.stringify(summary, null, 2));
    return;
  }
  if (summary.length === 0) {
    context.io.out('No users found.');
    return;
  }
  for (const row of summary) {
    context.io.out(
      [row.id, row.email, row.role, `${row.credits} credits`, row.status, row.createdAt].join('\t'),
    );
  }
}

// ---- Trust & safety --------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

interface StatsRow {
  total: number;
  active: number;
  disabled: number;
  deleted: number;
  confirmed: number;
  unconfirmed: number;
  admins: number;
  signups24h: number;
  signups7d: number;
  signups30d: number;
  credits: number;
}

export function usersStats(context: CommandContext): void {
  const now = Date.now();
  const row = getDb()
    .$client.prepare(
      `select
         count(*) as total,
         coalesce(sum(deleted_at is null and disabled_at is null), 0) as active,
         coalesce(sum(deleted_at is null and disabled_at is not null), 0) as disabled,
         coalesce(sum(deleted_at is not null), 0) as deleted,
         coalesce(sum(deleted_at is null and email_verified_at is not null), 0) as confirmed,
         coalesce(sum(deleted_at is null and email_verified_at is null), 0) as unconfirmed,
         coalesce(sum(deleted_at is null and role = 'admin'), 0) as admins,
         coalesce(sum(created_at > ?), 0) as signups24h,
         coalesce(sum(created_at > ?), 0) as signups7d,
         coalesce(sum(created_at > ?), 0) as signups30d,
         coalesce(sum(case when deleted_at is null then credit_balance else 0 end), 0) as credits
       from users`,
    )
    .get(now - DAY_MS, now - 7 * DAY_MS, now - 30 * DAY_MS) as StatsRow;

  const env = getEnv();
  const policy = {
    confirmationRequired: isEmailVerificationRequired(env),
    setting: env.EMAIL_VERIFICATION,
    smtpConfigured: isSmtpConfigured(env),
  };
  if (context.values.json === true) {
    context.io.out(JSON.stringify({ ...row, policy }, null, 2));
    return;
  }
  const out = context.io.out;
  out(
    `Accounts        ${row.total} (active ${row.active}, disabled ${row.disabled}, deleted ${row.deleted})`,
  );
  out(`Email           confirmed ${row.confirmed}, not confirmed ${row.unconfirmed}`);
  out(`Admins          ${row.admins}`);
  out(`New accounts    24 h ${row.signups24h}, 7 d ${row.signups7d}, 30 d ${row.signups30d}`);
  out(`Credits held    ${row.credits}`);
  out(
    `Confirmation    ${policy.confirmationRequired ? 'required' : 'not required'} ` +
      `(EMAIL_VERIFICATION=${policy.setting}, SMTP ${policy.smtpConfigured ? 'configured' : 'not configured'})`,
  );
}

/** Where a message went, so an operator without SMTP knows where to look. */
function describeMailDestination(): string {
  if (isSmtpConfigured()) return 'sent through SMTP';
  const file = outboxFilePath();
  return file
    ? `written to the outbox file ${file}`
    : 'kept in memory (no SMTP, no data directory)';
}

export async function resendVerification(context: CommandContext): Promise<void> {
  const user = findUser(context);
  if (!resendVerificationNow(user.id)) {
    context.io.out(`${user.email} has already confirmed their address.`);
    return;
  }
  await flushEmails();
  context.io.out(`Confirmation email for ${user.email}: ${describeMailDestination()}.`);
}

export function forceVerify(context: CommandContext): void {
  const user = findUser(context);
  // Confirming never promotes: the operator vouches for the mailbox, not for whoever chose the
  // password. An ADMIN_EMAILS address is promoted by a password reset, or with set-role.
  const outcome = withTx(getDb(), (tx) => markEmailVerified(tx, user.id));
  if (!outcome.changed) {
    context.io.out(`${user.email} had already confirmed their address.`);
    return;
  }
  const bonus = outcome.bonus?.created
    ? ` Granted ${outcome.bonus.entry.delta} sign-up credits.`
    : '';
  const listedAdmin = getEnv().ADMIN_EMAILS.includes(user.email) && user.role !== 'admin';
  const role = listedAdmin
    ? ' The address is listed in ADMIN_EMAILS but its role is unchanged: run set-role if you trust whoever holds the account.'
    : '';
  context.io.out(`Confirmed ${user.email}.${bonus}${role}`);
}

export async function deleteUser(context: CommandContext): Promise<void> {
  const user = findUserByEmailOrId(context);
  const db = getDb();
  const content = db
    .select({ total: count() })
    .from(generations)
    .where(eq(generations.userId, user.id))
    .get();
  const files = db.select({ total: count() }).from(assets).where(eq(assets.userId, user.id)).get();
  if (context.values.yes !== true) {
    const payments = db
      .select({ total: count() })
      .from(orders)
      .where(and(eq(orders.userId, user.id), eq(orders.status, 'pending')))
      .get();
    const plan = db
      .select({ planId: subscriptions.planId, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, user.id),
          inArray(subscriptions.status, LIVE_SUBSCRIPTION_STATUSES),
        ),
      )
      .get();
    const openPages = payments?.total ?? 0;
    context.io.out(
      [
        `Would delete ${user.deletedAt === null ? user.email : `${user.id} (already deleted)`}:`,
        `  ${content?.total ?? 0} generations and ${files?.total ?? 0} stored files are removed,`,
        '  sessions and API keys end, the account is anonymized (credit and billing rows stay).',
        `  Billing: ${plan ? `the ${plan.status} plan "${plan.planId}" is ended at once (credits already granted stay)` : 'no running plan to end'}, ` +
          `and ${openPages === 1 ? '1 open payment page is' : `${openPages} open payment pages are`} withdrawn at the payment gateway first (if one cannot be, nothing is deleted).`,
        `  Remaining balance ${user.creditBalance} credits is forfeited.`,
        'Run again with --yes to do it.',
      ].join('\n'),
    );
    return;
  }
  const result = await deleteAccount(user.id, { force: context.values.force === true });
  await flushEmails();
  const state = result.alreadyDeleted ? 'was already deleted; cleaned up leftovers' : 'deleted';
  context.io.out(
    `Account ${user.id} ${state}: ${result.purge.assetsDeleted} files removed` +
      (result.purge.complete
        ? '.'
        : `, ${result.purge.assetsFailed} could not be removed yet (run purge-deleted later).`),
  );
}

export async function purgeDeleted(context: CommandContext): Promise<void> {
  const touched = await resumeAccountPurges();
  context.io.out(
    touched === 0
      ? 'Nothing to clean up.'
      : `Finished the clean-up of ${touched} deleted account${touched === 1 ? '' : 's'}.`,
  );
}
