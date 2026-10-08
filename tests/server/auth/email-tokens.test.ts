import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  EmailTokenError,
  MAX_OUTSTANDING_TOKENS,
  TOKEN_TTL_MS,
  consumeEmailToken,
  findEmailToken,
  hashEmailToken,
  issueEmailToken,
  latestTokenAt,
  revokeEmailTokens,
} from '@/server/auth/email-tokens';
import { hashToken } from '@/server/auth/tokens';
import { withTx } from '@/server/db';
import { emailTokens, users } from '@/server/db/schema';
import { freshDb } from '../../helpers/db';
import { createUser } from '../../helpers/factories';

const harness = freshDb();

const HOUR = 60 * 60 * 1000;

function reasonOf(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error instanceof EmailTokenError) return error.reason;
    throw error;
  }
  return 'ok';
}

const consume = (type: 'verify' | 'reset', secret: string, now?: number) =>
  withTx(harness.db, (tx) => consumeEmailToken(tx, type, secret, now));

describe('issuing', () => {
  it('stores only a keyed hash of the secret, with the lifetime of its kind', () => {
    const user = createUser(harness.db);
    const now = Date.now();
    const verify = issueEmailToken(harness.db, user.id, 'verify', now);
    const reset = issueEmailToken(harness.db, user.id, 'reset', now);

    expect(verify.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verify.expiresAt - now).toBe(24 * HOUR);
    expect(reset.expiresAt - now).toBe(HOUR);
    expect(TOKEN_TTL_MS).toEqual({ verify: 24 * HOUR, reset: HOUR });

    const rows = harness.db.select().from(emailTokens).all();
    expect(rows).toHaveLength(2);
    const row = rows.find((candidate) => candidate.type === 'verify');
    expect(row).toMatchObject({ id: verify.id, userId: user.id, usedAt: null, createdAt: now });
    expect(row?.id).toMatch(/^etk_/);
    expect(row?.tokenHash).toBe(hashEmailToken('verify', verify.secret));
    // The secret is nowhere in the database.
    expect(JSON.stringify(rows)).not.toContain(verify.secret);
    expect(JSON.stringify(rows)).not.toContain(reset.secret);
  });

  it('gives every link a different secret', () => {
    const user = createUser(harness.db);
    const secrets = new Set(
      Array.from({ length: 20 }, () => issueEmailToken(harness.db, user.id, 'verify').secret),
    );
    expect(secrets.size).toBe(20);
  });

  it('separates the kinds: one secret cannot be replayed as the other, nor as a session token', () => {
    const user = createUser(harness.db);
    const { secret } = issueEmailToken(harness.db, user.id, 'reset');
    expect(hashEmailToken('verify', secret)).not.toBe(hashEmailToken('reset', secret));
    expect(hashEmailToken('reset', secret)).not.toBe(hashToken(secret));
    expect(reasonOf(() => consume('verify', secret))).toBe('invalid');
    expect(reasonOf(() => consume('reset', secret))).toBe('ok');
  });
});

describe('using a link', () => {
  it('works once: the second use says "used"', () => {
    const user = createUser(harness.db);
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const row = consume('verify', secret);
    expect(row.userId).toBe(user.id);
    expect(row.usedAt).not.toBeNull();
    expect(reasonOf(() => consume('verify', secret))).toBe('used');
    expect(reasonOf(() => consume('verify', secret))).toBe('used');
  });

  it('expires exactly at its deadline', () => {
    const user = createUser(harness.db);
    const now = Date.now();
    const { secret, expiresAt } = issueEmailToken(harness.db, user.id, 'reset', now);
    expect(reasonOf(() => consume('reset', secret, expiresAt))).toBe('expired');
    expect(reasonOf(() => consume('reset', secret, expiresAt + 5 * HOUR))).toBe('expired');
    // One millisecond earlier it still works, and an expired attempt did not burn it.
    expect(reasonOf(() => consume('reset', secret, expiresAt - 1))).toBe('ok');
  });

  it('refuses a tampered, truncated, extended or foreign secret as "invalid"', () => {
    const user = createUser(harness.db);
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    const flipped = `${secret.slice(0, -1)}${secret.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [
      flipped,
      secret.slice(0, -1),
      `${secret}x`,
      secret.toUpperCase() === secret ? secret.toLowerCase() : secret.toUpperCase(),
      '',
      ' ',
      `${secret} `,
      'x'.repeat(43),
      '../../etc/passwd',
      '\u0000'.repeat(43),
      secret.replace(/./, '%'),
    ]) {
      expect(
        reasonOf(() => consume('verify', bad)),
        JSON.stringify(bad),
      ).toBe('invalid');
    }
    // None of that harmed the real link.
    expect(reasonOf(() => consume('verify', secret))).toBe('ok');
  });

  it('is not fooled by non-string input', () => {
    expect(findEmailToken(harness.db, 'verify', undefined as unknown as string)).toBeUndefined();
    expect(findEmailToken(harness.db, 'verify', 42 as unknown as string)).toBeUndefined();
    expect(
      findEmailToken(harness.db, 'verify', { toString: () => 'x' } as unknown as string),
    ).toBeUndefined();
  });

  it('is not burned when the transaction around it fails', () => {
    const user = createUser(harness.db);
    const { secret } = issueEmailToken(harness.db, user.id, 'verify');
    expect(() =>
      withTx(harness.db, (tx) => {
        consumeEmailToken(tx, 'verify', secret);
        throw new Error('the work that follows failed');
      }),
    ).toThrow('the work that follows failed');
    expect(reasonOf(() => consume('verify', secret))).toBe('ok');
  });

  it('is a compare-and-set: a link already marked used by someone else cannot be used again', () => {
    const user = createUser(harness.db);
    const { secret, id } = issueEmailToken(harness.db, user.id, 'verify');
    // Another process wins between our read and our write (simulated by writing first).
    harness.db.update(emailTokens).set({ usedAt: Date.now() }).where(eq(emailTokens.id, id)).run();
    expect(reasonOf(() => consume('verify', secret))).toBe('used');
  });

  it('carries the reason in its details, as a 400', () => {
    const error = new EmailTokenError('expired');
    expect(error).toMatchObject({
      code: 'bad_request',
      status: 400,
      details: { reason: 'expired' },
    });
  });
});

describe('housekeeping', () => {
  it('keeps at most five live links per kind: asking again retires the oldest', () => {
    const user = createUser(harness.db);
    const base = Date.now();
    const issued = Array.from({ length: MAX_OUTSTANDING_TOKENS + 2 }, (_, index) =>
      issueEmailToken(harness.db, user.id, 'verify', base + index),
    );
    const outcomes = issued.map((token) =>
      reasonOf(() => consume('verify', token.secret, base + 100)),
    );
    expect(outcomes.slice(0, 2)).toEqual(['used', 'used']);
    expect(outcomes.slice(2)).toEqual(Array(MAX_OUTSTANDING_TOKENS).fill('ok'));
  });

  it('does not let one kind retire the other, or one user retire another', () => {
    const [a, b] = [createUser(harness.db), createUser(harness.db)];
    const reset = issueEmailToken(harness.db, a.id, 'reset');
    const other = issueEmailToken(harness.db, b.id, 'verify');
    for (let index = 0; index < MAX_OUTSTANDING_TOKENS + 2; index += 1) {
      issueEmailToken(harness.db, a.id, 'verify');
    }
    expect(reasonOf(() => consume('reset', reset.secret))).toBe('ok');
    expect(reasonOf(() => consume('verify', other.secret))).toBe('ok');
  });

  it('revokes every unused link of a kind, optionally sparing one', () => {
    const user = createUser(harness.db);
    const first = issueEmailToken(harness.db, user.id, 'reset');
    const second = issueEmailToken(harness.db, user.id, 'reset');
    const third = issueEmailToken(harness.db, user.id, 'reset');
    const verify = issueEmailToken(harness.db, user.id, 'verify');
    expect(revokeEmailTokens(harness.db, user.id, 'reset', Date.now(), third.id)).toBe(2);
    expect(reasonOf(() => consume('reset', first.secret))).toBe('used');
    expect(reasonOf(() => consume('reset', second.secret))).toBe('used');
    expect(reasonOf(() => consume('reset', third.secret))).toBe('ok');
    expect(revokeEmailTokens(harness.db, user.id, 'reset')).toBe(0);
    expect(reasonOf(() => consume('verify', verify.secret))).toBe('ok');
  });

  it('knows when the newest link of a kind was created', () => {
    const user = createUser(harness.db);
    expect(latestTokenAt(harness.db, user.id, 'verify')).toBeUndefined();
    const base = Date.now();
    issueEmailToken(harness.db, user.id, 'verify', base - 5000);
    issueEmailToken(harness.db, user.id, 'verify', base);
    expect(latestTokenAt(harness.db, user.id, 'verify')).toBe(base);
    expect(latestTokenAt(harness.db, user.id, 'reset')).toBeUndefined();
  });

  it('purges long-dead rows (used or expired a week ago) and keeps the recent ones', () => {
    const user = createUser(harness.db);
    const base = Date.now();
    const old = issueEmailToken(harness.db, user.id, 'verify', base - 10 * 24 * HOUR);
    const recent = issueEmailToken(harness.db, user.id, 'reset', base - HOUR);
    // The purge runs at most hourly per process; a call two hours on is sure to run it.
    issueEmailToken(harness.db, user.id, 'reset', base + 2 * HOUR);
    const ids = harness.db
      .select({ id: emailTokens.id })
      .from(emailTokens)
      .all()
      .map((row) => row.id);
    expect(ids).not.toContain(old.id);
    expect(ids).toContain(recent.id);
  });

  it('disappears with the user row', () => {
    const user = createUser(harness.db);
    issueEmailToken(harness.db, user.id, 'verify');
    harness.db.delete(users).where(eq(users.id, user.id)).run();
    expect(harness.db.select().from(emailTokens).all()).toEqual([]);
  });
});
