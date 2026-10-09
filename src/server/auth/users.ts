import 'server-only';
import { and, eq, or } from 'drizzle-orm';
import type { UserRole } from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';
import { getDb, withTx, type Tx } from '@/server/db';
import { users, type UserRow } from '@/server/db/schema';
import { isSmtpConfigured } from '@/server/email/transport';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { getRateLimiter } from '@/server/security/rate-limit';
import { grantSignupBonus } from './bonus';
import type { SessionUser } from './context';
import { toSessionUser } from './dto';
import { canonicalizeEmail } from './email-canonical';
import { isEmailVerificationRequired } from './email-policy';
import { issueEmailToken } from './email-tokens';
import { queueVerificationEmail, queueWelcomeEmail } from './notifications';
import {
  assertPasswordPolicy,
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from './password';
import { openSession, revokeOtherSessions } from './sessions';
import { assertEmailAllowed, assertSignupsWithinCap, signupAddress } from './signup-guard';
import { fieldError, normalizeEmail, parseEmail, parseName } from './validation';
import { pendingSignupBonus } from './verification';

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
  locale: Locale;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** Client details stored with the session. */
export interface SessionMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  user: SessionUser;
  /** The session cookie value. Shown to the client once; only its hash is stored. */
  token: string;
  /** Epoch ms. */
  expiresAt: number;
}

/** Failed and successful logins per client address and email, in a sliding minute. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10;

// ---- Errors ----------------------------------------------------------------------------------

/**
 * Registration with a taken email is a 409 whose message does not name a field. The status itself
 * says "taken", which cannot be hidden without email verification, so enumeration is made
 * expensive instead: 5 registrations per hour and address, the password is always hashed before
 * the duplicate check (a taken email costs the same time as a new one) and nothing else in the
 * response differs.
 */
function accountUnavailable(): AppError {
  return AppError.of('conflict', 'This account could not be created with these details');
}

/** Every login failure looks like this, whatever the cause. */
function invalidCredentials(): AppError {
  return AppError.of('unauthorized', 'Invalid email or password');
}

function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 4; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT_')) {
      return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
    }
    current = cause;
  }
  return false;
}

// ---- Accounts --------------------------------------------------------------------------------

export interface NewAccount {
  email: string;
  name: string;
  passwordHash: string;
  locale: Locale;
  role: UserRole;
  /**
   * Credits granted as `signup_bonus` in the same transaction. 0 grants nothing: when emails must
   * be confirmed the bonus waits for the confirmation (`markEmailVerified`).
   */
  bonusCredits: number;
  /** Client address of the registration (counts towards the daily cap); null for operator-made accounts. */
  signupIp: string | null;
  /** Set for accounts whose address nobody needs to confirm (operator-made). */
  verifiedAt: number | null;
}

/** Inserts the user and its signup bonus. Synchronous: call it inside `withTx`. */
function insertAccount(tx: Tx, account: NewAccount, now: number): UserRow {
  const emailCanonical = canonicalizeEmail(account.email);
  // The canonical form catches `a.b+x@gmail.com` after `ab@gmail.com`; comparing it with `email`
  // as well covers rows that predate the column.
  const taken = tx
    .select({ id: users.id })
    .from(users)
    .where(
      or(
        eq(users.email, account.email),
        eq(users.emailCanonical, emailCanonical),
        eq(users.email, emailCanonical),
      ),
    )
    .get();
  if (taken) throw accountUnavailable();

  const id = newId('usr', now);
  tx.insert(users)
    .values({
      id,
      email: account.email,
      name: account.name,
      passwordHash: account.passwordHash,
      role: account.role,
      locale: account.locale,
      creditBalance: 0,
      emailCanonical,
      emailVerifiedAt: account.verifiedAt,
      signupIp: account.signupIp,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  grantSignupBonus(tx, { id, email: account.email, emailCanonical }, account.bonusCredits, now);
  const row = tx.select().from(users).where(eq(users.id, id)).get();
  if (!row) throw new Error('User row missing right after insert');
  return row;
}

/**
 * Creates the account and opens a session. Without mandatory email confirmation the signup bonus
 * is granted in the same transaction and the first `ADMIN_EMAILS` match becomes admin; with it, the
 * account starts with no credits and no privileges, a confirmation link is mailed, and bonus and
 * admin role follow the confirmation (`markEmailVerified`).
 *
 * `conflict` for a taken address (also an alias of a taken mailbox), `signup_disabled` when
 * registration is closed, `email_not_allowed` for a throwaway-mail domain, `signup_limit` when the
 * client address created its share of accounts today, `validation_failed` for a bad email or
 * password.
 */
export async function registerUser(
  input: RegisterInput,
  meta: SessionMeta = {},
): Promise<AuthResult> {
  const env = getEnv();
  if (!env.SIGNUP_ENABLED) throw AppError.of('signup_disabled', 'Registration is closed');

  const email = parseEmail(input.email);
  const name = parseName(input.name);
  assertPasswordPolicy(input.password, { email });
  // Before the expensive hash, and independent of whether the address is taken.
  assertEmailAllowed(email);
  const locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;
  const passwordHash = await hashPassword(input.password);
  const confirmFirst = isEmailVerificationRequired(env);

  try {
    const result = withTx(getDb(), (tx) => {
      const now = Date.now();
      assertSignupsWithinCap(tx, meta.ip, now);
      const user = insertAccount(
        tx,
        {
          email,
          name,
          passwordHash,
          locale,
          // Admin only for an address that proved it owns the mailbox: when confirmation is
          // required the promotion happens at confirmation. Otherwise whoever registers an
          // ADMIN_EMAILS address first owns it (docs/ARCHITECTURE.md section 16).
          role: !confirmFirst && env.ADMIN_EMAILS.includes(email) ? 'admin' : 'user',
          bonusCredits: confirmFirst ? 0 : env.SIGNUP_BONUS_CREDITS,
          signupIp: signupAddress(meta.ip),
          verifiedAt: null,
        },
        now,
      );
      const session = openSession(tx, user.id, meta, now);
      const confirmation = confirmFirst ? issueEmailToken(tx, user.id, 'verify', now) : null;
      // What the email may promise: nothing for a mailbox that already got its bonus once.
      const promisedBonus = confirmation ? pendingSignupBonus(tx, user) : 0;
      return { user, session, confirmation, promisedBonus };
    });
    getLogger().info('User registered', { userId: result.user.id, role: result.user.role });
    const recipient = { email, name: result.user.name, locale: result.user.locale };
    if (result.confirmation) {
      queueVerificationEmail(recipient, result.confirmation.secret, result.promisedBonus);
    } else if (isSmtpConfigured(env)) {
      queueWelcomeEmail(recipient, result.user.creditBalance);
    }
    return {
      user: toSessionUser(result.user),
      token: result.session.token,
      expiresAt: result.session.expiresAt,
    };
  } catch (error) {
    // Two registrations for one email that race past the pre-check meet at the unique index.
    if (isUniqueViolation(error)) throw accountUnavailable();
    throw error;
  }
}

export interface ProvisionInput {
  email: string;
  password: string;
  name: string;
  locale?: Locale;
  role?: UserRole;
  /** Defaults to SIGNUP_BONUS_CREDITS. */
  bonusCredits?: number;
}

/** Creates an account without a session (operator tooling). Same checks as {@link registerUser}. */
export async function provisionUser(input: ProvisionInput): Promise<SessionUser> {
  const email = parseEmail(input.email);
  const name = parseName(input.name);
  assertPasswordPolicy(input.password, { email });
  const passwordHash = await hashPassword(input.password);
  const now = Date.now();
  try {
    const user = withTx(getDb(), (tx) =>
      insertAccount(
        tx,
        {
          email,
          name,
          passwordHash,
          locale: isLocale(input.locale) ? input.locale : DEFAULT_LOCALE,
          role: input.role ?? 'user',
          bonusCredits: input.bonusCredits ?? getEnv().SIGNUP_BONUS_CREDITS,
          // The operator vouches for the address, so there is nothing to confirm or to cap.
          signupIp: null,
          verifiedAt: now,
        },
        now,
      ),
    );
    return toSessionUser(user);
  } catch (error) {
    if (isUniqueViolation(error)) throw accountUnavailable();
    throw error;
  }
}

// ---- Login -----------------------------------------------------------------------------------

function enforceLoginLimit(ip: string, email: string): void {
  const result = getRateLimiter().hit(`login:${ip}:${email}`, LOGIN_ATTEMPTS_PER_MINUTE, 60);
  if (result.allowed) return;
  const retryAfterSec = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  throw AppError.of('rate_limited', 'Too many sign-in attempts, try again later', {
    retryAfterSec,
  });
}

/**
 * Constant-time-ish, with one generic `unauthorized` error for every failure. Rate limited per
 * IP+email. An unknown email still runs a full password verification against a dummy hash, so
 * the response time does not tell "no such account" from "wrong password". A disabled account
 * gets a distinct `forbidden`, but only after the password was right, so it reveals nothing to
 * someone who does not already hold the credentials.
 */
export async function loginUser(input: LoginInput, meta: SessionMeta = {}): Promise<AuthResult> {
  const email = normalizeEmail(input.email).slice(0, 254);
  const password = typeof input.password === 'string' ? input.password : '';
  enforceLoginLimit(meta.ip ?? 'unknown', email);

  const db = getDb();
  const row = email ? db.select().from(users).where(eq(users.email, email)).get() : undefined;
  if (!row) {
    await verifyAgainstDummy(password);
    throw invalidCredentials();
  }
  if (!(await verifyPassword(password, row.passwordHash))) throw invalidCredentials();
  if (row.disabledAt !== null) throw AppError.of('forbidden', 'This account is disabled');

  if (needsRehash(row.passwordHash)) await upgradeHash(row, password);
  const session = openSession(db, row.id, meta);
  return { user: toSessionUser(row), token: session.token, expiresAt: session.expiresAt };
}

/** Re-hashes with the current parameters. Best effort: a failure must not fail the login. */
async function upgradeHash(row: UserRow, password: string): Promise<void> {
  try {
    const passwordHash = await hashPassword(password);
    getDb()
      .update(users)
      .set({ passwordHash, updatedAt: Date.now() })
      .where(and(eq(users.id, row.id), eq(users.passwordHash, row.passwordHash)))
      .run();
  } catch (error) {
    getLogger().warn('Password rehash failed', { userId: row.id, err: error });
  }
}

// ---- Password and profile --------------------------------------------------------------------

export function getUserById(userId: string): UserRow | undefined {
  return getDb().select().from(users).where(eq(users.id, userId)).get();
}

/**
 * Verifies `current`, applies the password policy to `next` and stores the new hash. Every session
 * of the user except `keepSessionId` (the caller's own) is revoked. API keys are separate
 * credentials and stay valid.
 */
export async function changePassword(
  userId: string,
  current: string,
  next: string,
  keepSessionId?: string,
): Promise<void> {
  const row = getUserById(userId);
  if (!row) throw AppError.of('not_found', 'User not found');
  assertPasswordPolicy(next, { email: row.email });
  // 422 on the field rather than 401: the user is signed in, only this input is wrong.
  if (!(await verifyPassword(current, row.passwordHash))) {
    throw fieldError('currentPassword', 'Current password is incorrect');
  }
  if (current === next) {
    throw fieldError('newPassword', 'New password must differ from the current one');
  }

  const passwordHash = await hashPassword(next);
  withTx(getDb(), (tx) => {
    const updated = tx
      .update(users)
      .set({ passwordHash, updatedAt: Date.now() })
      .where(and(eq(users.id, userId), eq(users.passwordHash, row.passwordHash)))
      .returning({ id: users.id })
      .get();
    if (!updated) throw AppError.of('conflict', 'The password was changed in the meantime');
    revokeOtherSessions(tx, userId, keepSessionId);
  });
}

export interface AccountPatch {
  name?: string;
  locale?: Locale;
}

/** Updates the profile fields that were given. `not_found` for an unknown user. */
export function updateAccount(userId: string, patch: AccountPatch): UserRow {
  const changes: { name?: string; locale?: Locale; updatedAt: number } = { updatedAt: Date.now() };
  if (patch.name !== undefined) changes.name = parseName(patch.name);
  if (patch.locale !== undefined) {
    if (!isLocale(patch.locale)) throw fieldError('locale', 'Unsupported language');
    changes.locale = patch.locale;
  }
  const row = getDb().update(users).set(changes).where(eq(users.id, userId)).returning().get();
  if (!row) throw AppError.of('not_found', 'User not found');
  return row;
}
