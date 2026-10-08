import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createUser } from '../../helpers/factories';
import { expectConsistentLedger, ledgerInOrder } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import { AppError } from '@/lib/errors';
import { creditLedger, sessions, users } from '@/server/db/schema';
import { hashPassword, needsRehash, verifyPassword } from '@/server/auth/password';
import { resolveSession } from '@/server/auth/sessions';
import {
  changePassword,
  getUserById,
  loginUser,
  provisionUser,
  registerUser,
  updateAccount,
} from '@/server/auth/users';
import { getRateLimiter } from '@/server/security/rate-limit';
import { GOOD_PASSWORD, stubEnv, useCleanSecurityState, usePasswordFixture } from './support';

const harness = freshDb();
const fixture = usePasswordFixture();
useCleanSecurityState();

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

function input(overrides: Partial<Parameters<typeof registerUser>[0]> = {}) {
  return {
    email: 'Lina.Hassan@Example.com',
    password: GOOD_PASSWORD,
    name: 'Lina Hassan',
    locale: 'ar' as const,
    ...overrides,
  };
}

describe('registerUser', () => {
  it('creates the account, grants the signup bonus and opens a session in one go', async () => {
    const result = await registerUser(input(), { ip: '203.0.113.5', userAgent: 'vitest' });

    expect(result.user).toMatchObject({
      email: 'lina.hassan@example.com',
      name: 'Lina Hassan',
      role: 'user',
      locale: 'ar',
      creditBalance: 50,
    });
    const row = getUserById(result.user.id);
    expect(row?.creditBalance).toBe(50);
    expect(row?.passwordHash).toMatch(/^scrypt\$/);
    expect(row?.passwordHash).not.toContain(GOOD_PASSWORD);

    const ledger = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, result.user.id))
      .all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: 50, balanceAfter: 50, reason: 'signup_bonus' });
    expectConsistentLedger(harness.db, result.user.id, 0);

    const session = resolveSession(result.token, harness.db);
    expect(session?.user.id).toBe(result.user.id);
    expect(session?.expiresAt).toBe(result.expiresAt);
    const stored = harness.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, result.user.id))
      .get();
    expect(stored).toMatchObject({ ip: '203.0.113.5', userAgent: 'vitest' });
  });

  it('honours SIGNUP_BONUS_CREDITS, including zero (no ledger row at all)', async () => {
    stubEnv({ SIGNUP_BONUS_CREDITS: '120' });
    const rich = await registerUser(input({ email: 'rich@example.com' }));
    expect(rich.user.creditBalance).toBe(120);

    stubEnv({ SIGNUP_BONUS_CREDITS: '0' });
    const none = await registerUser(input({ email: 'none@example.com' }));
    expect(none.user.creditBalance).toBe(0);
    expect(ledgerInOrder(harness.db, none.user.id)).toEqual([]);
  });

  it('stores the locale and falls back to ar for an unknown one', async () => {
    expect((await registerUser(input({ email: 'en@example.com', locale: 'en' }))).user.locale).toBe(
      'en',
    );
    const odd = await registerUser(input({ email: 'odd@example.com', locale: 'fr' as 'ar' }));
    expect(odd.user.locale).toBe('ar');
  });

  it('makes ADMIN_EMAILS addresses admins, whatever their case, and nobody else', async () => {
    stubEnv({ ADMIN_EMAILS: 'Boss@Example.com, other@example.com' });
    expect((await registerUser(input({ email: 'BOSS@example.COM' }))).user.role).toBe('admin');
    expect((await registerUser(input({ email: 'boss2@example.com' }))).user.role).toBe('user');
    expect((await registerUser(input({ email: 'bosss@example.com' }))).user.role).toBe('user');
  });

  it('is closed with SIGNUP_ENABLED=false (403 signup_disabled) and writes nothing', async () => {
    stubEnv({ SIGNUP_ENABLED: 'false' });
    const error = await failure(registerUser(input()));
    expect(error).toMatchObject({ code: 'signup_disabled', status: 403 });
    expect(harness.db.select().from(users).all()).toHaveLength(0);
  });

  it('reports a taken email as a generic 409 whatever its case or spacing', async () => {
    await registerUser(input());
    for (const email of ['lina.hassan@example.com', '  LINA.HASSAN@EXAMPLE.COM ']) {
      const error = await failure(registerUser(input({ email, name: 'Impostor' })));
      expect(error).toMatchObject({ code: 'conflict', status: 409 });
      expect(error.message).not.toMatch(/email|exists|taken|registered/i);
      expect(error.details).toBeUndefined();
    }
    expect(harness.db.select().from(users).all()).toHaveLength(1);
  });

  it('hashes the password before it looks for a duplicate, so a taken email costs the same', async () => {
    const taken = createUser(harness.db, {
      email: 'taken@example.com',
      passwordHash: fixture.hash,
    });
    const started = Date.now();
    await failure(registerUser(input({ email: taken.email })));
    // A real scrypt run takes well over 20 ms; an early return after the lookup would not.
    expect(Date.now() - started).toBeGreaterThan(20);
  });

  it('rejects bad input with field errors and creates nothing', async () => {
    const cases: Array<[Partial<Parameters<typeof registerUser>[0]>, string]> = [
      [{ email: 'not-an-email' }, 'email'],
      [{ email: '' }, 'email'],
      [{ email: `${'a'.repeat(250)}@example.com` }, 'email'],
      [{ password: 'short' }, 'password'],
      [{ password: 'password123' }, 'password'],
      [{ password: 'lina.hassan@example.com' }, 'password'],
      [{ name: '' }, 'name'],
      [{ name: '   ' }, 'name'],
      [{ name: 'x'.repeat(81) }, 'name'],
      [{ name: 'evil‮name' }, 'name'],
    ];
    for (const [overrides, path] of cases) {
      const error = await failure(registerUser(input(overrides)));
      expect(error.code, JSON.stringify(overrides)).toBe('validation_failed');
      expect(error.details).toMatchObject({ issues: [{ path }] });
    }
    expect(harness.db.select().from(users).all()).toHaveLength(0);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(0);
  });

  it('keeps a normal name, collapses spaces and accepts Arabic', async () => {
    const result = await registerUser(input({ name: '  ليلى   أحمد ' }));
    expect(result.user.name).toBe('ليلى أحمد');
  });

  it('survives concurrent registrations of one email: exactly one account', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => registerUser(input({ email: 'race@example.com' }))),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect((r.reason as AppError).code).toBe('conflict');
    }
    expect(harness.db.select().from(users).all()).toHaveLength(1);
    expect(harness.db.select().from(creditLedger).all()).toHaveLength(1);
  });
});

describe('provisionUser', () => {
  it('creates an account without a session, with the requested role and credits', async () => {
    const user = await provisionUser({
      email: 'ops@example.com',
      password: GOOD_PASSWORD,
      name: 'Ops',
      role: 'admin',
      bonusCredits: 7,
    });
    expect(user).toMatchObject({ role: 'admin', creditBalance: 7, locale: 'ar' });
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
    expectConsistentLedger(harness.db, user.id, 0);
    expect(
      (
        await failure(
          provisionUser({ email: 'ops@example.com', password: GOOD_PASSWORD, name: 'Again' }),
        )
      ).code,
    ).toBe('conflict');
  });
});

describe('loginUser', () => {
  async function account() {
    return createUser(harness.db, {
      email: 'member@example.com',
      name: 'Member',
      passwordHash: fixture.hash,
      creditBalance: 12,
    });
  }

  it('signs in with the right password, any email case, and opens a fresh session', async () => {
    const user = await account();
    const result = await loginUser(
      { email: ' MEMBER@Example.com', password: GOOD_PASSWORD },
      { ip: '198.51.100.4', userAgent: 'ua' },
    );
    expect(result.user).toMatchObject({ id: user.id, name: 'Member', creditBalance: 12 });
    expect(resolveSession(result.token, harness.db)?.user.id).toBe(user.id);

    const again = await loginUser({ email: user.email, password: GOOD_PASSWORD });
    expect(again.token).not.toBe(result.token);
  });

  it('answers wrong password, unknown email and malformed email with the identical 401', async () => {
    await account();
    const wrongPassword = await failure(
      loginUser({ email: 'member@example.com', password: 'nope-nope-nope' }),
    );
    const unknownEmail = await failure(
      loginUser({ email: 'ghost@example.com', password: GOOD_PASSWORD }),
    );
    const garbage = await failure(loginUser({ email: 'not an email', password: GOOD_PASSWORD }));
    const empty = await failure(loginUser({ email: '', password: '' }));
    for (const error of [wrongPassword, unknownEmail, garbage, empty]) {
      expect(error).toMatchObject({ code: 'unauthorized', status: 401 });
      expect(error.message).toBe(wrongPassword.message);
      expect(error.details).toBeUndefined();
    }
  });

  it('does not create a session on failure', async () => {
    await account();
    await failure(loginUser({ email: 'member@example.com', password: 'wrong-wrong-1' }));
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('blocks disabled users, but only reveals it to someone who knows the password', async () => {
    const user = await account();
    harness.db.update(users).set({ disabledAt: Date.now() }).where(eq(users.id, user.id)).run();
    const right = await failure(loginUser({ email: user.email, password: GOOD_PASSWORD }));
    expect(right).toMatchObject({ code: 'forbidden', status: 403 });
    const wrong = await failure(loginUser({ email: user.email, password: 'wrong-wrong-1' }));
    expect(wrong.code).toBe('unauthorized');
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);
  });

  it('rate limits per IP and email: the 11th attempt in a minute is 429 with Retry-After data', async () => {
    await account();
    const meta = { ip: '203.0.113.50' };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const error = await failure(
        loginUser({ email: 'member@example.com', password: 'wrong-wrong-1' }, meta),
      );
      expect(error.code).toBe('unauthorized');
    }
    const blocked = await failure(
      loginUser({ email: 'member@example.com', password: GOOD_PASSWORD }, meta),
    );
    expect(blocked).toMatchObject({ code: 'rate_limited', status: 429 });
    expect((blocked.details as { retryAfterSec: number }).retryAfterSec).toBeGreaterThan(0);
    // The correct password does not get through while blocked.
    expect(harness.db.select().from(sessions).all()).toHaveLength(0);

    // Another address, or another email from the same address, has its own budget.
    await expect(
      loginUser({ email: 'member@example.com', password: GOOD_PASSWORD }, { ip: '203.0.113.51' }),
    ).resolves.toBeDefined();
    const second = await failure(
      loginUser({ email: 'ghost@example.com', password: 'wrong-wrong-1' }, meta),
    );
    expect(second.code).toBe('unauthorized');
  });

  it('is not rate limited at all when RATE_LIMIT_DISABLED=true', async () => {
    stubEnv({ RATE_LIMIT_DISABLED: 'true' });
    await account();
    for (let attempt = 0; attempt < 14; attempt += 1) {
      const error = await failure(
        loginUser(
          { email: 'member@example.com', password: 'wrong-wrong-1' },
          { ip: '203.0.113.60' },
        ),
      );
      expect(error.code).toBe('unauthorized');
    }
  });

  it('upgrades an old password hash to the current parameters on login', async () => {
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const key = scryptSync(GOOD_PASSWORD.normalize('NFKC'), salt, 64, { N: 2 ** 14, r: 8, p: 1 });
    const legacy = [
      'scrypt',
      2 ** 14,
      8,
      1,
      salt.toString('base64url'),
      key.toString('base64url'),
    ].join('$');
    const user = createUser(harness.db, { email: 'old@example.com', passwordHash: legacy });
    expect(needsRehash(legacy)).toBe(true);

    await loginUser({ email: user.email, password: GOOD_PASSWORD });
    const upgraded = getUserById(user.id)?.passwordHash ?? '';
    expect(upgraded).not.toBe(legacy);
    expect(needsRehash(upgraded)).toBe(false);
    expect(await verifyPassword(GOOD_PASSWORD, upgraded)).toBe(true);
    // The password still works afterwards.
    await expect(loginUser({ email: user.email, password: GOOD_PASSWORD })).resolves.toBeDefined();
  });

  it('does not upgrade on a failed login', async () => {
    const hash = await hashPassword('x'.repeat(20)); // current params, nothing to upgrade either
    const user = createUser(harness.db, { email: 'same@example.com', passwordHash: hash });
    await failure(loginUser({ email: user.email, password: 'wrong-wrong-1' }));
    expect(getUserById(user.id)?.passwordHash).toBe(hash);
  });

  it('shares the limiter with the rest of the app (swappable store)', async () => {
    const hits: string[] = [];
    const { setRateLimiter } = await import('@/server/security/rate-limit');
    setRateLimiter({
      hit: (key, limit, windowSec) => {
        hits.push(`${key}|${limit}|${windowSec}`);
        return { allowed: true, remaining: limit - 1, resetAt: Date.now() + windowSec * 1000 };
      },
    });
    expect(getRateLimiter().hit('x', 1, 1).allowed).toBe(true);
    await failure(
      loginUser({ email: 'a@example.com', password: 'pw-pw-pw-pw' }, { ip: '192.0.2.1' }),
    );
    expect(hits).toContain('login:192.0.2.1:a@example.com|10|60');
  });
});

describe('changePassword', () => {
  async function accountWithSessions() {
    const user = createUser(harness.db, { passwordHash: fixture.hash });
    const own = await loginUser({ email: user.email, password: GOOD_PASSWORD });
    const other = await loginUser({ email: user.email, password: GOOD_PASSWORD });
    const ownSessionId = resolveSession(own.token, harness.db)?.sessionId;
    return { user, own, other, ownSessionId };
  }

  it('changes the password and revokes every session but the caller own', async () => {
    const { user, own, other, ownSessionId } = await accountWithSessions();
    await changePassword(user.id, GOOD_PASSWORD, 'a brand new passphrase 42', ownSessionId);

    expect(resolveSession(own.token, harness.db)).not.toBeNull();
    expect(resolveSession(other.token, harness.db)).toBeNull();
    await failure(loginUser({ email: user.email, password: GOOD_PASSWORD }));
    await expect(
      loginUser({ email: user.email, password: 'a brand new passphrase 42' }),
    ).resolves.toBeDefined();
  });

  it('revokes every session when no session is kept', async () => {
    const { user, own, other } = await accountWithSessions();
    await changePassword(user.id, GOOD_PASSWORD, 'a brand new passphrase 42');
    expect(resolveSession(own.token, harness.db)).toBeNull();
    expect(resolveSession(other.token, harness.db)).toBeNull();
  });

  it('keeps other users sessions', async () => {
    const { user } = await accountWithSessions();
    const bystander = createUser(harness.db, { passwordHash: fixture.hash });
    const theirs = await loginUser({ email: bystander.email, password: GOOD_PASSWORD });
    await changePassword(user.id, GOOD_PASSWORD, 'a brand new passphrase 42');
    expect(resolveSession(theirs.token, harness.db)).not.toBeNull();
  });

  it('rejects a wrong current password as a field error (not 401) and changes nothing', async () => {
    const { user, other } = await accountWithSessions();
    const error = await failure(
      changePassword(user.id, 'wrong-wrong-1', 'a brand new passphrase 42'),
    );
    expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
    expect(error.details).toMatchObject({ issues: [{ path: 'currentPassword' }] });
    expect(getUserById(user.id)?.passwordHash).toBe(fixture.hash);
    expect(resolveSession(other.token, harness.db)).not.toBeNull();
  });

  it('applies the policy to the new password and refuses an unchanged one', async () => {
    const { user } = await accountWithSessions();
    expect((await failure(changePassword(user.id, GOOD_PASSWORD, 'short'))).details).toMatchObject({
      issues: [{ path: 'password' }],
    });
    expect((await failure(changePassword(user.id, GOOD_PASSWORD, 'password123'))).code).toBe(
      'validation_failed',
    );
    expect(
      (await failure(changePassword(user.id, GOOD_PASSWORD, GOOD_PASSWORD))).details,
    ).toMatchObject({ issues: [{ path: 'newPassword' }] });
    expect(getUserById(user.id)?.passwordHash).toBe(fixture.hash);
  });

  it('is 404 for an unknown user', async () => {
    expect((await failure(changePassword('usr_nobody', 'x', 'y'))).code).toBe('not_found');
  });

  it('refuses when the password changed concurrently', async () => {
    const { user } = await accountWithSessions();
    const first = changePassword(user.id, GOOD_PASSWORD, 'first new passphrase 1');
    const second = changePassword(user.id, GOOD_PASSWORD, 'second new passphrase 2');
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
  });
});

describe('updateAccount', () => {
  it('updates name and locale, normalizing the name', () => {
    const user = createUser(harness.db);
    const row = updateAccount(user.id, { name: '  New   Name ', locale: 'en' });
    expect(row).toMatchObject({ name: 'New Name', locale: 'en' });
    expect(updateAccount(user.id, { locale: 'ar' }).name).toBe('New Name');
  });

  it('rejects invalid values and unknown users', () => {
    const user = createUser(harness.db);
    expect(() => updateAccount(user.id, { name: '' })).toThrowError(/Request validation failed/);
    expect(() => updateAccount(user.id, { locale: 'de' as 'ar' })).toThrowError(
      /Request validation failed/,
    );
    expect(() => updateAccount('usr_nobody', { name: 'X' })).toThrowError(/not found/i);
  });
});
