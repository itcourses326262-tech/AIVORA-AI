import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as LoggerModule from '@/server/logger';
import { AppError } from '@/lib/errors';
import {
  deleteAccount,
  deleteAccountWithPassword,
  purgeAccountContent,
  resumeAccountPurges,
  tombstoneEmail,
} from '@/server/auth/account-deletion';
import {
  HOOK_TIMEOUT_MS,
  listAccountDeletedHooks,
  onAccountDeleted,
  runAccountDeletedHooks,
} from '@/server/auth/account-hooks';
import { createApiKey, resolveApiKey } from '@/server/auth/api-keys';
import { grantSignupBonus } from '@/server/auth/bonus';
import { issueEmailToken } from '@/server/auth/email-tokens';
import { resolveSession } from '@/server/auth/sessions';
import { loginUser } from '@/server/auth/users';
import { debitCredits, grantCredits } from '@/server/credits';
import { withTx } from '@/server/db';
import {
  apiKeys,
  assets,
  creditLedger,
  emailTokens,
  generations,
  sessions,
  signupBonusClaims,
  users,
} from '@/server/db/schema';
import { getOutbox } from '@/server/email';
import { setStorageOverride } from '@/server/storage';
import { expectConsistentLedger } from '../../helpers/credits';
import { freshDb } from '../../helpers/db';
import {
  createAsset,
  createGeneration,
  createSession,
  createUser,
  fakeStorage,
} from '../../helpers/factories';
import { GOOD_PASSWORD, mailTo, passwordFixture, trustTestState } from './trust-support';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/logger', async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return { ...original, getLogger: () => ({ ...log, level: 'debug', child: () => log }) };
});

const harness = freshDb();
const fixture = passwordFixture();
trustTestState();

let storage: ReturnType<typeof fakeStorage>;
const unregister: Array<() => void> = [];

beforeEach(() => {
  storage = fakeStorage();
  setStorageOverride(storage);
  for (const fn of Object.values(log)) fn.mockClear();
});
afterEach(() => {
  setStorageOverride(null);
  while (unregister.length) unregister.pop()?.();
});

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

/** A person with a history: sessions, keys, generations (all states), files, credits, links. */
async function populate(email: string, options: { prompt?: string } = {}) {
  const db = harness.db;
  const user = createUser(db, {
    email,
    name: 'Layla Hassan',
    locale: 'ar',
    passwordHash: fixture.hash,
    creditBalance: 0,
    signupIp: '203.0.113.7',
    emailVerifiedAt: Date.now(),
  });
  withTx(db, (tx) => grantSignupBonus(tx, user, 100));
  grantCredits(db, { userId: user.id, amount: 20, reason: 'purchase' });

  const prompt = options.prompt ?? `a secret prompt of ${email}`;
  const sessionsOf = [createSession(db, user.id), createSession(db, user.id)];
  const keys = [await createApiKey(user.id, 'ci'), await createApiKey(user.id, 'laptop')];

  const input = createAsset(db, { userId: user.id, role: 'input' });
  await storage.put(input.storageKey, new Uint8Array([1, 2, 3]), { mimeType: 'image/png' });

  const done = createGeneration(db, {
    userId: user.id,
    status: 'succeeded',
    prompt,
    cost: 10,
    inputAssetId: input.id,
  });
  debitCredits(db, { userId: user.id, amount: 10, generationId: done.id });
  const output = createAsset(db, {
    userId: user.id,
    role: 'output',
    generationId: done.id,
    thumbKey: `u/${user.id}/${done.id}/thumb.webp`,
  });
  await storage.put(output.storageKey, new Uint8Array([4, 5, 6]), { mimeType: 'image/png' });
  await storage.put(output.thumbKey as string, new Uint8Array([7]), { mimeType: 'image/webp' });

  const running = createGeneration(db, { userId: user.id, status: 'processing', prompt, cost: 5 });
  debitCredits(db, { userId: user.id, amount: 5, generationId: running.id });
  const queued = createGeneration(db, { userId: user.id, status: 'queued', prompt, cost: 3 });
  debitCredits(db, { userId: user.id, amount: 3, generationId: queued.id });

  const links = [issueEmailToken(db, user.id, 'verify'), issueEmailToken(db, user.id, 'reset')];
  return {
    user,
    sessionsOf,
    keys,
    input,
    output,
    generationsOf: [done, running, queued],
    links,
    prompt,
  };
}

const userRow = (id: string) => harness.db.select().from(users).where(eq(users.id, id)).get();

describe('deleteAccount', () => {
  it('ends the account at once and removes every trace of what the person made', async () => {
    const a = await populate('layla@example.com');
    const b = await populate('omar@example.com');
    const ledgerBefore = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, a.user.id))
      .all().length;

    const result = await deleteAccount(a.user.id);

    expect(result).toMatchObject({
      alreadyDeleted: false,
      purge: { complete: true, assetsFailed: 0 },
    });

    // The user row is an anonymous tombstone.
    const row = userRow(a.user.id);
    expect(row).toMatchObject({
      email: tombstoneEmail(a.user.id),
      emailCanonical: tombstoneEmail(a.user.id),
      name: '',
      passwordHash: 'deleted',
      role: 'user',
      emailVerifiedAt: null,
    });
    // The address is gone; a keyed digest stays for the rest of the day (see signup-cap-deletion.test.ts).
    expect(row?.signupIp).toMatch(/^h:[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
    expect(row?.deletedAt).toBeGreaterThan(0);
    expect(row?.disabledAt).toBe(row?.deletedAt);
    expect(row?.email).toMatch(/@deleted\.invalid$/);
    expect(JSON.stringify(row)).not.toContain('layla');
    expect(JSON.stringify(row)).not.toContain('Hassan');

    // Credentials are dead.
    for (const session of a.sessionsOf)
      expect(resolveSession(session.token, harness.db)).toBeNull();
    expect(harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all()).toEqual(
      [],
    );
    for (const key of a.keys) expect(resolveApiKey(key.key, harness.db)).toBeNull();
    expect(
      harness.db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.userId, a.user.id))
        .all()
        .every((k) => k.revokedAt !== null),
    ).toBe(true);
    expect(
      harness.db.select().from(emailTokens).where(eq(emailTokens.userId, a.user.id)).all(),
    ).toEqual([]);

    // Content and files are gone, prompts included.
    expect(
      harness.db.select().from(generations).where(eq(generations.userId, a.user.id)).all(),
    ).toEqual([]);
    expect(harness.db.select().from(assets).where(eq(assets.userId, a.user.id)).all()).toEqual([]);
    expect(await storage.head(a.input.storageKey)).toBeNull();
    expect(await storage.head(a.output.storageKey)).toBeNull();
    expect(await storage.head(a.output.thumbKey as string)).toBeNull();
    expect(JSON.stringify(harness.db.select().from(generations).all())).not.toContain(a.prompt);

    // The money trail stays, consistent, and no longer points at generations that do not exist.
    const ledger = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, a.user.id))
      .all();
    expect(ledger.length).toBeGreaterThanOrEqual(ledgerBefore);
    expect(ledger.every((entry) => entry.generationId === null)).toBe(true);
    expectConsistentLedger(harness.db, a.user.id, 0);
    expect(
      harness.db
        .select()
        .from(signupBonusClaims)
        .all()
        .map((claim) => claim.userId),
    ).toContain(a.user.id);

    // Somebody else's data is untouched.
    expect(userRow(b.user.id)?.email).toBe('omar@example.com');
    expect(
      harness.db.select().from(generations).where(eq(generations.userId, b.user.id)).all(),
    ).toHaveLength(3);
    expect(harness.db.select().from(assets).where(eq(assets.userId, b.user.id)).all()).toHaveLength(
      2,
    );
    expect(await storage.head(b.output.storageKey)).not.toBeNull();
    expect(await storage.head(b.input.storageKey)).not.toBeNull();
    expect(resolveSession(b.sessionsOf[0]?.token ?? '', harness.db)?.user.id).toBe(b.user.id);
    expect(resolveApiKey(b.keys[0]?.key ?? '', harness.db)).not.toBeNull();
    expect(
      harness.db.select().from(emailTokens).where(eq(emailTokens.userId, b.user.id)).all(),
    ).toHaveLength(2);
  });

  it('cancels running work and refunds it, so the ledger still adds up', async () => {
    const a = await populate('layla@example.com');
    await deleteAccount(a.user.id);
    const refunds = harness.db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, a.user.id))
      .all()
      .filter((entry) => entry.reason === 'refund');
    // The processing (5) and queued (3) generations were refunded; the finished one (10) was not.
    expect(refunds.map((entry) => entry.delta).sort()).toEqual([3, 5]);
    expect(userRow(a.user.id)?.creditBalance).toBe(120 - 10);
  });

  it('can no longer be signed in to, under any address', async () => {
    const a = await populate('layla@example.com');
    await deleteAccount(a.user.id);
    for (const email of ['layla@example.com', tombstoneEmail(a.user.id)]) {
      await expect(loginUser({ email, password: GOOD_PASSWORD })).rejects.toMatchObject({
        code: 'unauthorized',
      });
    }
  });

  it('tells the owner, at the old address and in their language', async () => {
    const a = await populate('layla@example.com');
    await deleteAccount(a.user.id);
    const mail = await mailTo('layla@example.com');
    expect(mail).toMatchObject({ kind: 'account_deleted', subject: 'تم حذف حسابك في AIVORE' });
    expect(mail?.html).toContain('dir="rtl"');
    // It names no tombstone, and nothing in it can be used to act on the account.
    expect(mail?.text).not.toContain('deleted.invalid');
  });

  it('is idempotent: deleting again does nothing, mails nothing and breaks nothing', async () => {
    const a = await populate('layla@example.com');
    await deleteAccount(a.user.id);
    await mailTo('layla@example.com');
    const mailsAfterFirst = getOutbox().length;
    const rowAfterFirst = userRow(a.user.id);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(deleteAccount(a.user.id)).resolves.toMatchObject({
        alreadyDeleted: true,
        purge: { complete: true },
      });
    }
    await mailTo('layla@example.com');
    expect(getOutbox()).toHaveLength(mailsAfterFirst);
    expect(userRow(a.user.id)).toEqual(rowAfterFirst);
    expectConsistentLedger(harness.db, a.user.id, 0);
  });

  it('is "not found" for an unknown id', async () => {
    expect((await failure(deleteAccount('usr_00000000000000000000000000'))).code).toBe('not_found');
  });

  describe('when files cannot be removed (resumable)', () => {
    it('kills the account anyway, keeps what it could not clean, and finishes later', async () => {
      const a = await populate('layla@example.com');
      const realDelete = storage.delete.bind(storage);
      let outage = true;
      storage.delete = async (key: string) => {
        if (outage && key === a.output.storageKey) throw new Error('storage unreachable');
        await realDelete(key);
      };

      const first = await deleteAccount(a.user.id);
      expect(first.alreadyDeleted).toBe(false);
      expect(first.purge).toMatchObject({ complete: false, assetsFailed: 1 });
      // Dead at once: credentials gone, identity erased.
      expect(userRow(a.user.id)?.deletedAt).not.toBeNull();
      expect(
        harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all(),
      ).toEqual([]);
      expect(userRow(a.user.id)?.email).toBe(tombstoneEmail(a.user.id));
      // What could be removed was; the failing file's row (and its generation) stays as the to-do list.
      expect(await storage.head(a.input.storageKey)).toBeNull();
      expect(await storage.head(a.output.storageKey)).not.toBeNull();
      expect(
        harness.db
          .select()
          .from(assets)
          .where(eq(assets.userId, a.user.id))
          .all()
          .map((asset) => asset.id),
      ).toEqual([a.output.id]);
      expect(
        harness.db
          .select()
          .from(generations)
          .where(eq(generations.userId, a.user.id))
          .all()
          .map((g) => g.id),
      ).toEqual([a.generationsOf[0]?.id]);
      expect(log.warn).toHaveBeenCalledWith(
        'Could not delete a stored object of a deleted account',
        expect.objectContaining({ userId: a.user.id, assetId: a.output.id }),
      );

      // Still failing: still incomplete, nothing is lost or duplicated.
      expect((await purgeAccountContent(a.user.id)).complete).toBe(false);

      // The outage ends; the sweep (CLI: purge-deleted) finishes the job.
      outage = false;
      await expect(resumeAccountPurges()).resolves.toBe(1);
      expect(await storage.head(a.output.storageKey)).toBeNull();
      expect(await storage.head(a.output.thumbKey as string)).toBeNull();
      expect(harness.db.select().from(assets).where(eq(assets.userId, a.user.id)).all()).toEqual(
        [],
      );
      expect(
        harness.db.select().from(generations).where(eq(generations.userId, a.user.id)).all(),
      ).toEqual([]);
      await expect(resumeAccountPurges()).resolves.toBe(0);
    });

    it('is also finished by deleting the already-deleted account again', async () => {
      const a = await populate('layla@example.com');
      const realDelete = storage.delete.bind(storage);
      let outage = true;
      storage.delete = async (key) => {
        if (outage) throw new Error('storage unreachable');
        await realDelete(key);
      };
      expect((await deleteAccount(a.user.id)).purge.complete).toBe(false);
      outage = false;
      await expect(deleteAccount(a.user.id)).resolves.toMatchObject({
        alreadyDeleted: true,
        purge: { complete: true },
      });
      expect(storage.objects.size).toBe(0);
    });
  });

  describe('the last administrator', () => {
    it('cannot delete their own account, unless an operator forces it', async () => {
      const admin = createUser(harness.db, { role: 'admin', passwordHash: fixture.hash });
      expect((await failure(deleteAccount(admin.id))).code).toBe('conflict');
      expect(userRow(admin.id)?.deletedAt).toBeNull();
      await expect(deleteAccount(admin.id, { force: true })).resolves.toMatchObject({
        alreadyDeleted: false,
      });
      expect(userRow(admin.id)).toMatchObject({ role: 'user' });
    });

    it('may leave when another active administrator remains (disabled ones do not count)', async () => {
      const first = createUser(harness.db, { role: 'admin' });
      createUser(harness.db, { role: 'admin', disabledAt: Date.now() });
      expect((await failure(deleteAccount(first.id))).code).toBe('conflict');
      createUser(harness.db, { role: 'admin' });
      await expect(deleteAccount(first.id)).resolves.toMatchObject({ alreadyDeleted: false });
    });
  });
});

describe('deleteAccountWithPassword', () => {
  it('needs the current password: a wrong one is a 422 at "password" and deletes nothing', async () => {
    const a = await populate('layla@example.com');
    const error = await failure(deleteAccountWithPassword(a.user.id, 'not my password at all'));
    expect(error).toMatchObject({ code: 'validation_failed', status: 422 });
    expect((error.details as { issues: Array<{ path: string }> }).issues[0]?.path).toBe('password');
    expect(userRow(a.user.id)?.deletedAt).toBeNull();
    expect(resolveSession(a.sessionsOf[0]?.token ?? '', harness.db)).not.toBeNull();
    expect(await storage.head(a.output.storageKey)).not.toBeNull();
    await mailTo('layla@example.com');
    expect(getOutbox()).toEqual([]);
  });

  it('deletes with the right password', async () => {
    const a = await populate('layla@example.com');
    await expect(deleteAccountWithPassword(a.user.id, GOOD_PASSWORD)).resolves.toMatchObject({
      alreadyDeleted: false,
    });
    expect(userRow(a.user.id)?.deletedAt).not.toBeNull();
  });

  it('refuses an unknown or already deleted account', async () => {
    expect(
      (await failure(deleteAccountWithPassword('usr_00000000000000000000000000', 'x'))).code,
    ).toBe('not_found');
    const a = await populate('layla@example.com');
    await deleteAccount(a.user.id);
    expect((await failure(deleteAccountWithPassword(a.user.id, GOOD_PASSWORD))).code).toBe(
      'not_found',
    );
  });
});

describe('onAccountDeleted hooks (the billing seam)', () => {
  function register(name: string, handler: Parameters<typeof onAccountDeleted>[1]) {
    unregister.push(onAccountDeleted(name, handler));
  }

  it('run before anything is destroyed, with who is being deleted', async () => {
    const a = await populate('layla@example.com');
    const seen: Array<{ event: unknown; emailAtThatTime: string | undefined; sessions: number }> =
      [];
    register('billing', (event) => {
      seen.push({
        event,
        emailAtThatTime: userRow(a.user.id)?.email,
        sessions: harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all()
          .length,
      });
    });
    await deleteAccount(a.user.id);
    expect(seen).toEqual([
      {
        event: { userId: a.user.id, email: 'layla@example.com', locale: 'ar' },
        emailAtThatTime: 'layla@example.com',
        sessions: 2,
      },
    ]);
  });

  it('can veto: a failing hook stops the deletion with a 502 and leaves the account whole', async () => {
    const a = await populate('layla@example.com');
    let failing = true;
    register('billing', async () => {
      if (failing) throw new Error('moyasar is down');
    });
    const error = await failure(deleteAccount(a.user.id));
    expect(error).toMatchObject({ code: 'provider_error', status: 502 });
    expect(error.details).toBeUndefined();
    expect(userRow(a.user.id)).toMatchObject({
      email: 'layla@example.com',
      deletedAt: null,
      disabledAt: null,
    });
    expect(
      harness.db.select().from(sessions).where(eq(sessions.userId, a.user.id)).all(),
    ).toHaveLength(2);
    expect(await storage.head(a.output.storageKey)).not.toBeNull();
    expect(log.error).toHaveBeenCalledWith(
      'An account deletion hook failed',
      expect.objectContaining({ hook: 'billing', userId: a.user.id }),
    );
    await mailTo('layla@example.com');
    expect(getOutbox()).toEqual([]);

    // The user simply tries again once the service is back.
    failing = false;
    await expect(deleteAccount(a.user.id)).resolves.toMatchObject({ alreadyDeleted: false });
  });

  it('all run even when one fails, and every failure is logged by name', async () => {
    const calls: string[] = [];
    register('one', () => {
      calls.push('one');
      throw new Error('boom');
    });
    register('two', () => {
      calls.push('two');
    });
    register('three', async () => {
      calls.push('three');
      throw new Error('boom');
    });
    const error = await failure(
      runAccountDeletedHooks({ userId: 'usr_x', email: 'a@example.com', locale: 'en' }),
    );
    expect(error.code).toBe('provider_error');
    expect(calls).toEqual(['one', 'two', 'three']);
    expect(log.error.mock.calls.map(([, fields]) => (fields as { hook: string }).hook)).toEqual([
      'one',
      'three',
    ]);
  });

  it('treat a hook that never answers as failed', async () => {
    register('stuck', () => new Promise<void>(() => {}));
    const error = await failure(
      runAccountDeletedHooks({ userId: 'usr_x', email: 'a@example.com', locale: 'en' }, 20),
    );
    expect(error.code).toBe('provider_error');
    expect(log.error).toHaveBeenCalledWith(
      'An account deletion hook failed',
      expect.objectContaining({ hook: 'stuck' }),
    );
    expect(HOOK_TIMEOUT_MS).toBe(20_000);
  });

  it('replace one another by name, can be removed, and are listed in order', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = onAccountDeleted('billing', first);
    unregister.push(off);
    register('other', vi.fn());
    expect(listAccountDeletedHooks()).toEqual(['billing', 'other']);
    unregister.push(onAccountDeleted('billing', second));
    expect(listAccountDeletedHooks()).toEqual(['billing', 'other']);
    // The stale remover must not remove the replacement.
    off();
    expect(listAccountDeletedHooks()).toContain('billing');
  });

  it('are not needed: with none registered deletion simply proceeds', async () => {
    expect(listAccountDeletedHooks()).toEqual([]);
    const a = await populate('layla@example.com');
    await expect(deleteAccount(a.user.id)).resolves.toMatchObject({ alreadyDeleted: false });
  });
});
