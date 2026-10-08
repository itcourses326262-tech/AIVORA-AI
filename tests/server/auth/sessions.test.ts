import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { freshDb } from '../../helpers/db';
import { sessions, users } from '@/server/db/schema';
import { hashToken, generateToken } from '@/server/auth/tokens';
import {
  MAX_SESSIONS_PER_USER,
  SESSION_ABSOLUTE_MAX_MS,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
  logout,
  logoutAll,
  openSession,
  resolveSession,
  revokeOtherSessions,
  sessionCookieExpiry,
} from '@/server/auth/sessions';
import {
  clearSessionCookie,
  sessionCookie,
  sessionTokenFromCookieHeader,
} from '@/server/auth/cookies';
import { stubEnv, cleanSecurityState } from './support';

const harness = freshDb();
cleanSecurityState();

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('openSession', () => {
  it('stores only the hash of an opaque 32-byte token', () => {
    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id, { ip: '203.0.113.9', userAgent: 'vitest' });

    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const rows = harness.db.select().from(sessions).all();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.tokenHash).toBe(hashToken(session.token));
    expect(JSON.stringify(rows)).not.toContain(session.token);
    expect(row).toMatchObject({ userId: user.id, ip: '203.0.113.9', userAgent: 'vitest' });
    expect(session.expiresAt - (row?.createdAt ?? 0)).toBe(SESSION_TTL_MS);
    expect(SESSION_TTL_MS).toBe(30 * DAY);
  });

  it('truncates client details and gives every session a different token', () => {
    const user = createUser(harness.db);
    const a = openSession(harness.db, user.id, { userAgent: 'x'.repeat(1000) });
    const b = openSession(harness.db, user.id);
    expect(a.token).not.toBe(b.token);
    const stored = harness.db.select().from(sessions).where(eq(sessions.id, a.id)).get();
    expect(stored?.userAgent).toHaveLength(256);
  });

  it('keeps at most MAX_SESSIONS_PER_USER, dropping the least recently used', () => {
    const user = createUser(harness.db);
    const now = Date.now();
    const opened = Array.from({ length: MAX_SESSIONS_PER_USER + 3 }, (_, index) =>
      openSession(harness.db, user.id, {}, now + index),
    );
    const left = harness.db.select().from(sessions).where(eq(sessions.userId, user.id)).all();
    expect(left).toHaveLength(MAX_SESSIONS_PER_USER);
    const ids = new Set(left.map((row) => row.id));
    expect(opened.slice(0, 3).every((session) => !ids.has(session.id))).toBe(true);
    expect(opened.slice(3).every((session) => ids.has(session.id))).toBe(true);
  });

  it('purges expired sessions of everybody, at most once an hour', () => {
    const owner = createUser(harness.db);
    const other = createUser(harness.db);
    const old = openSession(harness.db, other.id, {}, 1_000);
    const farFuture = Date.now() + 400 * DAY;
    openSession(harness.db, owner.id, {}, farFuture); // triggers the purge: `old` expired long ago
    expect(harness.db.select().from(sessions).where(eq(sessions.id, old.id)).get()).toBeUndefined();
  });
});

describe('resolveSession', () => {
  it('returns the session and its user for a valid token', () => {
    const user = createUser(harness.db, { name: 'Lina' });
    const { token, id } = openSession(harness.db, user.id);
    const resolved = resolveSession(token, harness.db);
    expect(resolved?.sessionId).toBe(id);
    expect(resolved?.user.name).toBe('Lina');
    expect(resolved?.refreshed).toBe(false);
  });

  it('rejects unknown, malformed and tampered tokens', () => {
    const user = createUser(harness.db);
    const { token } = openSession(harness.db, user.id);
    expect(resolveSession(generateToken(), harness.db)).toBeNull();
    expect(resolveSession('', harness.db)).toBeNull();
    expect(resolveSession('short', harness.db)).toBeNull();
    expect(resolveSession(`${token}x`, harness.db)).toBeNull();
    expect(
      resolveSession(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), harness.db),
    ).toBeNull();
    // A hash is not a credential: presenting the stored hash must not authenticate.
    expect(resolveSession(hashToken(token), harness.db)).toBeNull();
  });

  it('rejects tokens hashed with another pepper (a stolen database is useless alone)', () => {
    const user = createUser(harness.db);
    const { token } = openSession(harness.db, user.id);
    stubEnv({ SESSION_SECRET: 'another-session-secret-0123456789abcdef0123456789' });
    expect(resolveSession(token, harness.db)).toBeNull();
  });

  it('ends an expired session and deletes its row', () => {
    const user = createUser(harness.db);
    const live = openSession(harness.db, user.id);
    // Just before the end it is still valid (and, being old, gets extended).
    expect(resolveSession(live.token, harness.db, live.expiresAt - 1)).not.toBeNull();

    const { token, id, expiresAt } = openSession(harness.db, user.id);
    expect(resolveSession(token, harness.db, expiresAt)).toBeNull();
    expect(harness.db.select().from(sessions).where(eq(sessions.id, id)).get()).toBeUndefined();
  });

  it('returns null for a disabled user and works again once re-enabled', () => {
    const user = createUser(harness.db);
    const { token } = openSession(harness.db, user.id);
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    expect(resolveSession(token, harness.db)).toBeNull();
    harness.db.update(users).set({ disabledAt: null }).where(eq(users.id, user.id)).run();
    expect(resolveSession(token, harness.db)).not.toBeNull();
  });

  describe('sliding expiry', () => {
    it('does not write within the touch interval', () => {
      const user = createUser(harness.db);
      const { token, id } = openSession(harness.db, user.id);
      const before = harness.db.select().from(sessions).where(eq(sessions.id, id)).get();
      const soon = (before?.lastSeenAt ?? 0) + SESSION_TOUCH_INTERVAL_MS - 1;
      const resolved = resolveSession(token, harness.db, soon);
      expect(resolved?.refreshed).toBe(false);
      expect(harness.db.select().from(sessions).where(eq(sessions.id, id)).get()).toEqual(before);
    });

    it('extends lastSeenAt and the expiry after the interval, and says so', () => {
      const user = createUser(harness.db);
      const { token, id } = openSession(harness.db, user.id);
      const before = harness.db.select().from(sessions).where(eq(sessions.id, id)).get();
      const later = (before?.createdAt ?? 0) + 10 * DAY;
      const resolved = resolveSession(token, harness.db, later);
      expect(resolved?.refreshed).toBe(true);
      expect(resolved?.expiresAt).toBe(later + SESSION_TTL_MS);
      const after = harness.db.select().from(sessions).where(eq(sessions.id, id)).get();
      expect(after).toMatchObject({ lastSeenAt: later, expiresAt: later + SESSION_TTL_MS });
    });

    it('lets an active session live on, but never beyond the absolute maximum', () => {
      const user = createUser(harness.db);
      const { token, id } = openSession(harness.db, user.id);
      const created =
        harness.db.select().from(sessions).where(eq(sessions.id, id)).get()?.createdAt ?? 0;
      let now = created;
      for (let step = 0; step < 6; step += 1) {
        now += 29 * DAY;
        const resolved = resolveSession(token, harness.db, now);
        expect(resolved, `step ${step}`).not.toBeNull();
        expect(resolved?.expiresAt ?? 0).toBeLessThanOrEqual(created + SESSION_ABSOLUTE_MAX_MS);
      }
      // 6 * 29 = 174 days in, the session now ends at the 180 day cap, whatever 30 days would say.
      const capped = harness.db.select().from(sessions).where(eq(sessions.id, id)).get();
      expect(capped?.expiresAt).toBe(created + SESSION_ABSOLUTE_MAX_MS);
      expect(resolveSession(token, harness.db, created + SESSION_ABSOLUTE_MAX_MS + 1)).toBeNull();
    });

    it('never shortens a session', () => {
      const user = createUser(harness.db);
      const { token, id } = openSession(harness.db, user.id);
      const created =
        harness.db.select().from(sessions).where(eq(sessions.id, id)).get()?.createdAt ?? 0;
      const now = created + SESSION_ABSOLUTE_MAX_MS - DAY;
      harness.db
        .update(sessions)
        .set({ expiresAt: now + 25 * DAY, lastSeenAt: created })
        .where(eq(sessions.id, id))
        .run();
      const resolved = resolveSession(token, harness.db, now);
      expect(resolved?.expiresAt).toBeGreaterThanOrEqual(now + 25 * DAY);
    });
  });
});

describe('logout, logoutAll, revokeOtherSessions', () => {
  it('logout revokes only the session of that token and ignores unknown tokens', async () => {
    const user = createUser(harness.db);
    const first = openSession(harness.db, user.id);
    const second = openSession(harness.db, user.id);
    await logout(first.token);
    await logout(generateToken());
    await logout('garbage');
    expect(resolveSession(first.token, harness.db)).toBeNull();
    expect(resolveSession(second.token, harness.db)).not.toBeNull();
  });

  it('logoutAll revokes every session of that user and nobody else', async () => {
    const user = createUser(harness.db);
    const other = createUser(harness.db);
    const mine = [openSession(harness.db, user.id), openSession(harness.db, user.id)];
    const theirs = openSession(harness.db, other.id);
    await logoutAll(user.id);
    for (const session of mine) expect(resolveSession(session.token, harness.db)).toBeNull();
    expect(resolveSession(theirs.token, harness.db)).not.toBeNull();
  });

  it('revokeOtherSessions keeps the given session', () => {
    const user = createUser(harness.db);
    const keep = openSession(harness.db, user.id);
    const drop = openSession(harness.db, user.id);
    revokeOtherSessions(harness.db, user.id, keep.id);
    expect(resolveSession(keep.token, harness.db)).not.toBeNull();
    expect(resolveSession(drop.token, harness.db)).toBeNull();
  });

  it('deleting a user removes their sessions (cascade)', () => {
    const user = createUser(harness.db);
    const session = openSession(harness.db, user.id);
    harness.db.delete(users).where(eq(users.id, user.id)).run();
    expect(resolveSession(session.token, harness.db)).toBeNull();
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });
});

describe('session cookie', () => {
  const expiresAt = Date.UTC(2030, 0, 15, 12, 0, 0);

  it('lives until the absolute cap of its session, not the sliding 30 day expiry', () => {
    const createdAt = Date.UTC(2030, 0, 1);
    expect(sessionCookieExpiry(createdAt)).toBe(createdAt + SESSION_ABSOLUTE_MAX_MS);
    // The cookie can never be dropped by the browser before the server stops honouring it.
    const user = createUser(harness.db);
    const opened = openSession(harness.db, user.id, {}, createdAt);
    expect(sessionCookieExpiry(createdAt)).toBeGreaterThan(opened.expiresAt);
    for (let day = 0; day <= 180; day += 5) {
      const resolved = resolveSession(opened.token, harness.db, createdAt + day * DAY);
      if (resolved) expect(resolved.expiresAt).toBeLessThanOrEqual(sessionCookieExpiry(createdAt));
    }
  });

  it('is HttpOnly, SameSite=Lax, Path=/ with a matching Expires and Max-Age', () => {
    stubEnv({ NODE_ENV: 'development' });
    const cookie = sessionCookie('tok', expiresAt);
    const parts = cookie.split('; ');
    expect(parts[0]).toBe('aivore_session=tok');
    expect(parts).toContain('Path=/');
    expect(parts).toContain('HttpOnly');
    expect(parts).toContain('SameSite=Lax');
    expect(parts).toContain(`Expires=${new Date(expiresAt).toUTCString()}`);
    const maxAge = Number(parts.find((part) => part.startsWith('Max-Age='))?.slice(8));
    expect(Math.abs(maxAge - (expiresAt - Date.now()) / 1000)).toBeLessThan(5);
    expect(parts).not.toContain('Secure');
  });

  it('adds Secure in production only', () => {
    stubEnv({ NODE_ENV: 'production', SESSION_SECRET: 'p'.repeat(40) });
    expect(sessionCookie('tok', expiresAt).split('; ')).toContain('Secure');
    expect(clearSessionCookie().split('; ')).toContain('Secure');
  });

  it('clears with an expiry in the past and an empty value', () => {
    stubEnv({ NODE_ENV: 'development' });
    const parts = clearSessionCookie().split('; ');
    expect(parts[0]).toBe('aivore_session=');
    expect(parts).toContain('Max-Age=0');
    expect(parts).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    expect(parts).toContain('HttpOnly');
  });

  it('never sets a Max-Age below zero for a past expiry', () => {
    expect(sessionCookie('tok', Date.now() - 1000)).toContain('Max-Age=0');
  });

  describe('sessionTokenFromCookieHeader', () => {
    const token = generateToken();

    it('finds the token among other cookies', () => {
      expect(sessionTokenFromCookieHeader(`a=1; aivore_session=${token}; b=2`)).toBe(token);
      expect(sessionTokenFromCookieHeader(`aivore_session="${token}"`)).toBe(token);
    });

    it('ignores absent, malformed and look-alike cookies', () => {
      expect(sessionTokenFromCookieHeader(null)).toBeNull();
      expect(sessionTokenFromCookieHeader('')).toBeNull();
      expect(sessionTokenFromCookieHeader('a=1')).toBeNull();
      expect(sessionTokenFromCookieHeader('aivore_session=short')).toBeNull();
      expect(sessionTokenFromCookieHeader(`xaivore_session=${token}`)).toBeNull();
      expect(sessionTokenFromCookieHeader(`aivore_session=${token}x`)).toBeNull();
      expect(sessionTokenFromCookieHeader(`aivore_session=${token}'; DROP TABLE`)).toBeNull();
    });

    it('uses the first cookie of that name, so a later duplicate cannot override it', () => {
      const other = generateToken();
      expect(sessionTokenFromCookieHeader(`aivore_session=${token}; aivore_session=${other}`)).toBe(
        token,
      );
    });
  });
});
