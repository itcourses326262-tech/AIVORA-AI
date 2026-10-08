import 'server-only';
import { and, count, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { UserRole } from '@/lib/api-types';
import { USER_ROLES } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { LOCALES, isLocale, type Locale } from '@/lib/i18n/locales';
import { MAX_CREDIT_AMOUNT, grantCredits } from '@/server/credits';
import { getDb, withTx } from '@/server/db';
import { sessions, users, type UserRow } from '@/server/db/schema';
import { assertPasswordPolicy, hashPassword } from '../password';
import { provisionUser } from '../users';
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
      .set({ passwordHash, updatedAt: Date.now() })
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
