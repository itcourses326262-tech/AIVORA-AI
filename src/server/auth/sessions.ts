import 'server-only';
import { and, asc, eq, lt, ne } from 'drizzle-orm';
import { newId } from '@/lib/id';
import { getDb, type Db, type DbOrTx } from '@/server/db';
import { sessions, users, type UserRow } from '@/server/db/schema';
import { generateToken, hashToken } from './tokens';
import { isSessionTokenShape } from './cookies';
import type { SessionMeta } from './users';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A session lives this long after its last refresh. */
export const SESSION_TTL_MS = 30 * DAY_MS;
/** However active, a session ends this long after login: a stolen cookie cannot live forever. */
export const SESSION_ABSOLUTE_MAX_MS = 180 * DAY_MS;
/** `lastSeenAt` and the expiry are rewritten at most this often per session. */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 60 * 1000;
/** Opening a session beyond this many drops the least recently used ones. */
export const MAX_SESSIONS_PER_USER = 20;

const USER_AGENT_MAX = 256;
const IP_MAX = 64;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

export interface OpenedSession {
  id: string;
  /** The cookie value. Only its hash is stored. */
  token: string;
  expiresAt: number;
}

/**
 * Inserts a session for `userId` and returns the cookie value. Synchronous, so registration can
 * run it inside its transaction. The oldest sessions beyond {@link MAX_SESSIONS_PER_USER} and, at
 * most hourly, all expired sessions of every user are deleted on the way.
 */
export function openSession(
  db: DbOrTx,
  userId: string,
  meta: SessionMeta = {},
  now: number = Date.now(),
): OpenedSession {
  const token = generateToken();
  const id = newId('ses', now);
  const expiresAt = now + SESSION_TTL_MS;
  db.insert(sessions)
    .values({
      id,
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: now,
      lastSeenAt: now,
      userAgent: meta.userAgent ? meta.userAgent.slice(0, USER_AGENT_MAX) : null,
      ip: meta.ip ? meta.ip.slice(0, IP_MAX) : null,
    })
    .run();
  pruneSessions(db, userId, now);
  return { id, token, expiresAt };
}

let lastPurgeAt = 0;

function pruneSessions(db: DbOrTx, userId: string, now: number): void {
  const rows = db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, userId))
    .orderBy(asc(sessions.lastSeenAt), asc(sessions.id))
    .all();
  const excess = rows.length - MAX_SESSIONS_PER_USER;
  for (const row of rows.slice(0, Math.max(0, excess))) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run();
  }
  if (now - lastPurgeAt >= PURGE_INTERVAL_MS) {
    lastPurgeAt = now;
    db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  }
}

export interface ResolvedSession {
  sessionId: string;
  user: UserRow;
  expiresAt: number;
  /** True when this call extended the session (the cookie should be re-sent with the new expiry). */
  refreshed: boolean;
}

/**
 * The live session behind a cookie token with its user, or null when the token is unknown, the
 * session expired or the account is disabled. Sliding expiry: a session that is used again after
 * {@link SESSION_TOUCH_INTERVAL_MS} gets a fresh {@link SESSION_TTL_MS}, capped by
 * {@link SESSION_ABSOLUTE_MAX_MS}; the write is throttled so a busy page does not hit the disk on
 * every request.
 *
 * The lookup key is an HMAC of the token under a server secret, so the index comparison reveals
 * nothing an attacker can use to guess a valid token (no timing oracle on the secret itself).
 */
export function resolveSession(
  token: string,
  db: Db = getDb(),
  now: number = Date.now(),
): ResolvedSession | null {
  if (!isSessionTokenShape(token)) return null;
  const row = db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .get();
  if (!row) return null;

  const { session, user } = row;
  if (session.expiresAt <= now) {
    db.delete(sessions).where(eq(sessions.id, session.id)).run();
    return null;
  }
  if (user.disabledAt !== null) return null;

  if (now - session.lastSeenAt < SESSION_TOUCH_INTERVAL_MS) {
    return { sessionId: session.id, user, expiresAt: session.expiresAt, refreshed: false };
  }
  const expiresAt = Math.min(now + SESSION_TTL_MS, session.createdAt + SESSION_ABSOLUTE_MAX_MS);
  db.update(sessions)
    .set({ lastSeenAt: now, expiresAt: Math.max(expiresAt, session.expiresAt) })
    .where(eq(sessions.id, session.id))
    .run();
  return {
    sessionId: session.id,
    user,
    expiresAt: Math.max(expiresAt, session.expiresAt),
    refreshed: true,
  };
}

/** Revokes the session that belongs to `token` (the cookie value). Unknown tokens are ignored. */
export async function logout(token: string): Promise<void> {
  if (!isSessionTokenShape(token)) return;
  getDb()
    .delete(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)))
    .run();
}

/** Revokes every session of a user. */
export async function logoutAll(userId: string): Promise<void> {
  getDb().delete(sessions).where(eq(sessions.userId, userId)).run();
}

/** Revokes every session of a user except one (the caller's own). */
export function revokeOtherSessions(db: DbOrTx, userId: string, keepSessionId?: string): void {
  db.delete(sessions)
    .where(
      keepSessionId === undefined
        ? eq(sessions.userId, userId)
        : and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)),
    )
    .run();
}
