import 'server-only';
import { and, eq, or } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { newId } from '@/lib/id';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/lib/i18n/locales';
import { getDb, withTx, type Tx } from '@/server/db';
import { authIdentities, users, type UserRow } from '@/server/db/schema';
import { isSmtpConfigured } from '@/server/email/transport';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logger';
import { revokeAllApiKeys } from './api-keys';
import { toSessionUser } from './dto';
import { canonicalizeEmail } from './email-canonical';
import { isFirebaseAuthEnabled, verifyFirebaseIdToken, type FirebaseIdentity } from './firebase';
import { queuePasswordChangedEmail, queueWelcomeEmail } from './notifications';
import { unusablePasswordHash } from './password';
import { openSession, revokeOtherSessions, type OpenedSession } from './sessions';
import { assertEmailAllowed, assertSignupsWithinCap, signupAddress } from './signup-guard';
import { insertAccount, isUniqueViolation, type AuthResult, type SessionMeta } from './users';
import { NAME_MAX_LENGTH, parseEmail, parseName } from './validation';
import { markEmailVerified, toRecipient } from './verification';

/*
 * Signing in with Google, after the browser handed over a Firebase ID token. The token only says
 * "Google vouches that this person controls this mailbox"; everything else is this app's own
 * account model, so the session that comes out is the ordinary session cookie of password login.
 *
 * Which account the person gets, in order:
 *   1. the account already linked to this Google identity (even if the Google address changed since);
 *   2. the account that owns the mailbox (`emailCanonical`, so `a.b+x@gmail.com` is `ab@gmail.com`),
 *      unless that account is linked to a DIFFERENT Google account already;
 *   3. a new account, created through the same code as registration.
 * All state changes of one sign-in happen in a single transaction, so two simultaneous first
 * sign-ins of one Google account end up as one user, one bonus and two sessions.
 */

const PROVIDER = 'google';

export interface FirebaseSignInInput {
  idToken: string;
  /** The language the visitor is using; applies to a new account only. */
  locale?: Locale;
}

export interface FirebaseSignInResult extends AuthResult {
  /** True when this sign-in created the account. */
  created: boolean;
}

/** What the route may hook into; see {@link signInWithFirebase}. */
export interface FirebaseSignInHooks {
  /**
   * Called inside the sign-in transaction, right before a NEW account is created (never for a
   * returning or a linked one) and after every other refusal. Throwing refuses the sign-up and
   * nothing is stored: the route spends the shared sign-up budget of an unknown address here.
   */
  admitNewAccount?: () => void;
}

interface Outcome {
  user: UserRow;
  session: OpenedSession;
  created: boolean;
  linked: boolean;
  /** The account had a password: it, every session and every API key ended in this sign-in. */
  passwordEnded: boolean;
  keysRevoked: number;
  /** The address of the account became confirmed in this sign-in. */
  confirmedNow: boolean;
  at: number;
}

/** Same refusals as a password login after the right password: a disabled account gets 403. */
function assertCanSignIn(user: UserRow): void {
  if (user.deletedAt !== null) throw AppError.of('unauthorized', 'Sign-in is not possible');
  if (user.disabledAt !== null) throw AppError.of('forbidden', 'This account is disabled');
}

/**
 * A display name from Google, or the part of the address before the `@`, cut to the length the
 * registration form allows. Falls back to a fixed word so the account always has a name that
 * passes the same rules as a registered one.
 */
function accountName(tokenName: string | null, email: string, locale: Locale): string {
  const local = email.slice(0, email.lastIndexOf('@'));
  for (const candidate of [tokenName, local]) {
    if (candidate === null) continue;
    const cut = [...candidate.normalize('NFC').replace(/\s+/gu, ' ').trim()]
      .slice(0, NAME_MAX_LENGTH)
      .join('')
      .trim();
    try {
      return parseName(cut);
    } catch {
      // Unprintable or empty: try the next candidate.
    }
  }
  return locale === 'ar' ? 'مستخدم' : 'User';
}

function findByMailbox(tx: Tx, email: string): UserRow | undefined {
  const canonical = canonicalizeEmail(email);
  const rows = tx
    .select()
    .from(users)
    .where(
      or(
        eq(users.email, email),
        eq(users.emailCanonical, canonical),
        // Rows from before the canonical column hold the address as typed.
        eq(users.email, canonical),
      ),
    )
    .all();
  return rows.find((row) => row.email === email) ?? rows[0];
}

function linkIdentity(tx: Tx, userId: string, google: FirebaseIdentity, now: number): void {
  tx.insert(authIdentities)
    .values({
      id: newId('idn', now),
      userId,
      provider: PROVIDER,
      subject: google.subject,
      email: google.email,
      createdAt: now,
      lastLoginAt: now,
    })
    .run();
}

/**
 * The first Google link of an account that has a password. Whoever created that account chose the
 * password and may hold sessions or API keys: when the address was never confirmed, that may well
 * be somebody who only typed the owner's address (a squatter); when it was confirmed later through
 * the emailed link, the squatter's password and sessions survived that too (the link proves the
 * mailbox, not who set the password). Google now proves the mailbox belongs to the person signing
 * in, so the account becomes theirs alone: the password is replaced by one nobody can use, every
 * session and API key ends. Data of the account (credits, generations) stays: it is the same
 * account, just no longer open to whoever created it. The owner gets a notice for it.
 */
function neutralizePassword(tx: Tx, user: UserRow, now: number): Outcome['keysRevoked'] {
  tx.update(users)
    .set({ passwordHash: unusablePasswordHash(), hasPassword: false, updatedAt: now })
    .where(eq(users.id, user.id))
    .run();
  revokeOtherSessions(tx, user.id);
  return revokeAllApiKeys(tx, user.id, now);
}

/** True when the account is tied to some Google account already (then it is not this one). */
function hasGoogleIdentity(tx: Tx, userId: string): boolean {
  return (
    tx
      .select({ id: authIdentities.id })
      .from(authIdentities)
      .where(and(eq(authIdentities.userId, userId), eq(authIdentities.provider, PROVIDER)))
      .get() !== undefined
  );
}

function signInInTransaction(
  tx: Tx,
  google: FirebaseIdentity,
  email: string,
  locale: Locale,
  meta: SessionMeta,
  hooks: FirebaseSignInHooks,
): Outcome {
  const now = Date.now();
  const env = getEnv();

  // 1. A Google account that signed in before.
  const identity = tx
    .select()
    .from(authIdentities)
    .where(and(eq(authIdentities.provider, PROVIDER), eq(authIdentities.subject, google.subject)))
    .get();
  if (identity) {
    const user = tx.select().from(users).where(eq(users.id, identity.userId)).get();
    if (!user) throw AppError.of('unauthorized', 'Sign-in is not possible');
    assertCanSignIn(user);
    tx.update(authIdentities)
      .set({ email: google.email, lastLoginAt: now })
      .where(eq(authIdentities.id, identity.id))
      .run();
    const session = openSession(tx, user.id, meta, now);
    return {
      user,
      session,
      created: false,
      linked: false,
      passwordEnded: false,
      keysRevoked: 0,
      confirmedNow: false,
      at: now,
    };
  }

  // 2. The account that owns this mailbox.
  const existing = findByMailbox(tx, email);
  if (existing) {
    assertCanSignIn(existing);
    // The step above did not know this Google account, so a Google identity found here is a
    // different one: a recycled or re-registered address (a lapsed domain, a reassigned Workspace
    // mailbox) must not open the previous owner's account. The binding to the first subject stays.
    if (hasGoogleIdentity(tx, existing.id)) {
      getLogger().warn('Google sign-in refused: the account is linked to another Google account', {
        component: 'auth',
        userId: existing.id,
      });
      throw AppError.of('unauthorized', 'Sign-in is not possible');
    }
    linkIdentity(tx, existing.id, google, now);
    let passwordEnded = false;
    let keysRevoked = 0;
    let confirmedNow = false;
    if (existing.hasPassword || existing.emailVerifiedAt === null) {
      keysRevoked = neutralizePassword(tx, existing, now);
      passwordEnded = true;
    }
    if (existing.emailVerifiedAt === null) {
      // Google confirmed the mailbox, so the sign-up bonus is paid now if it never was, and an
      // `ADMIN_EMAILS` address is promoted: the holder of the account is the owner of the mailbox.
      confirmedNow = markEmailVerified(tx, existing.id, now, { promoteAdmin: true }).changed;
    }
    // What the caller sees is the account as it is now, not as it was found.
    const user = tx.select().from(users).where(eq(users.id, existing.id)).get() ?? existing;
    const session = openSession(tx, user.id, meta, now);
    return {
      user,
      session,
      created: false,
      linked: true,
      passwordEnded,
      keysRevoked,
      confirmedNow,
      at: now,
    };
  }

  // 3. A new account, with every check registration has.
  if (!env.SIGNUP_ENABLED) throw AppError.of('signup_disabled', 'Registration is closed');
  assertEmailAllowed(email);
  assertSignupsWithinCap(tx, meta.ip, now);
  hooks.admitNewAccount?.();
  const user = insertAccount(
    tx,
    {
      email,
      name: accountName(google.name, email, locale),
      passwordHash: unusablePasswordHash(),
      hasPassword: false,
      locale,
      // The mailbox is confirmed by Google, which is what `ADMIN_EMAILS` promotion waits for.
      role: env.ADMIN_EMAILS.includes(email) ? 'admin' : 'user',
      bonusCredits: env.SIGNUP_BONUS_CREDITS,
      signupIp: signupAddress(meta.ip),
      verifiedAt: now,
    },
    now,
  );
  linkIdentity(tx, user.id, google, now);
  const session = openSession(tx, user.id, meta, now);
  return {
    user,
    session,
    created: true,
    linked: true,
    passwordEnded: false,
    keysRevoked: 0,
    confirmedNow: false,
    at: now,
  };
}

/**
 * Verifies the Firebase ID token and signs the person in, creating or claiming the account as
 * described at the top of this file. Errors: `unauthorized` (401) for any token problem and for a
 * mailbox whose account is linked to another Google account, `forbidden` (403) for a disabled
 * account, `signup_disabled`, `email_not_allowed` and `signup_limit` exactly as for registration,
 * `service_busy` (503) when Google's signing keys cannot be loaded.
 *
 * The first Google link of an account that still has a password ends that password, its sessions
 * and its API keys (see `neutralizePassword`), and mails the address on file where mail is
 * configured, like the welcome mail.
 */
export async function signInWithFirebase(
  input: FirebaseSignInInput,
  meta: SessionMeta = {},
  hooks: FirebaseSignInHooks = {},
): Promise<FirebaseSignInResult> {
  const env = getEnv();
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!isFirebaseAuthEnabled(env) || projectId === undefined) {
    throw AppError.of('not_found', 'Not found');
  }
  const google = await verifyFirebaseIdToken(input.idToken, { projectId });
  const email = parseEmail(google.email);
  const locale = isLocale(input.locale) ? input.locale : DEFAULT_LOCALE;

  const run = () =>
    withTx(getDb(), (tx) =>
      signInInTransaction(tx, { ...google, email }, email, locale, meta, hooks),
    );
  let outcome: Outcome;
  try {
    outcome = run();
  } catch (error) {
    // Only a writer in another process can get here (this one is serialised by the transaction).
    // The second attempt then finds what the first one created.
    if (!isUniqueViolation(error)) throw error;
    outcome = run();
  }

  const log = getLogger();
  log.info('Signed in with Google', {
    component: 'auth',
    userId: outcome.user.id,
    created: outcome.created,
    linked: outcome.linked,
  });
  if (outcome.passwordEnded) {
    log.warn(
      'An account with a password was linked to Google; its password and credentials ended',
      {
        component: 'auth',
        userId: outcome.user.id,
        keysRevoked: outcome.keysRevoked,
      },
    );
  }
  if (isSmtpConfigured(env)) {
    if (outcome.created || outcome.confirmedNow) {
      queueWelcomeEmail(toRecipient(outcome.user), outcome.user.creditBalance);
    }
    // The owner of the address learns that the password is gone, and why every key stopped working.
    if (outcome.passwordEnded) {
      queuePasswordChangedEmail(toRecipient(outcome.user), outcome.at, outcome.keysRevoked);
    }
  }
  return {
    user: toSessionUser(outcome.user),
    token: outcome.session.token,
    expiresAt: outcome.session.expiresAt,
    created: outcome.created,
  };
}
