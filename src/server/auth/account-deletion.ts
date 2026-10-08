import 'server-only';
import { and, count, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '@/lib/errors';
import { getDb, withTx, type Db } from '@/server/db';
import {
  apiKeys,
  assets,
  creditLedger,
  emailTokens,
  generations,
  sessions,
  users,
  type UserRow,
} from '@/server/db/schema';
import { markCanceled } from '@/server/generations/lifecycle';
import { getLogger } from '@/server/logger';
import { getStorage } from '@/server/storage';
import { runAccountDeletedHooks } from './account-hooks';
import { queueAccountDeletedEmail } from './notifications';
import { verifyPassword } from './password';
import { fieldError } from './validation';

/**
 * Account deletion (GDPR-style erasure with the accounting exception).
 *
 * What goes: sessions, API keys, email links, every generation (prompts included), every asset row
 * and its stored files, and everything personal on the user row: the email becomes a tombstone
 * (`<id>@deleted.invalid`, which can never receive mail or sign in), the name is cleared, the
 * password hash is destroyed, the sign-up address is erased and `disabledAt`/`deletedAt` are set.
 *
 * What stays, on purpose: the user row itself (id, role reset to `user`, balance, timestamps), the
 * credit ledger and, in the billing module, payment records. Accounting needs the money trail,
 * and the row is what those records point at. After deletion nothing in them names a person. One
 * keyed hash of the mailbox also stays in `signup_bonus_claims`, so delete-and-register-again
 * cannot claim the free sign-up bonus a second time.
 *
 * The order makes it resumable: hooks (e.g. cancel the subscription) run first and may veto; one
 * transaction then tombstones the row, cancels running generations and revokes credentials, so
 * the account is dead at once; only then are files and rows removed in batches. A crash or a
 * storage outage in that last phase leaves a tombstoned user with some leftovers, which
 * `purgeAccountContent` / `resumeAccountPurges` (CLI: `purge-deleted`) finish later.
 */

const TOMBSTONE_DOMAIN = 'deleted.invalid';
/** Not a valid hash: `verifyPassword` is false for it. The row is disabled anyway. */
const DESTROYED_PASSWORD_HASH = 'deleted';
const PURGE_BATCH = 50;

export function tombstoneEmail(userId: string): string {
  return `${userId}@${TOMBSTONE_DOMAIN}`;
}

export interface PurgeResult {
  assetsDeleted: number;
  /** Files that could not be removed (their rows stay, so a later run retries them). */
  assetsFailed: number;
  generationsDeleted: number;
  /** Nothing of the user's content is left. */
  complete: boolean;
}

/**
 * Removes the user's stored files and the rows describing them, then the generations. Safe to run
 * again and again: a file that is already gone counts as deleted (the storage contract makes
 * `delete` idempotent), a file that fails keeps its row and generation for the next run.
 */
export async function purgeAccountContent(userId: string): Promise<PurgeResult> {
  const db = getDb();
  const storage = getStorage();
  const log = getLogger();
  let assetsDeleted = 0;
  let assetsFailed = 0;
  let after = '';

  for (;;) {
    const batch = db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, userId), gt(assets.id, after)))
      .orderBy(assets.id)
      .limit(PURGE_BATCH)
      .all();
    const last = batch.at(-1);
    if (!last) break;
    after = last.id;

    const removed: string[] = [];
    await Promise.all(
      batch.map(async (asset) => {
        try {
          await storage.delete(asset.storageKey);
          if (asset.thumbKey) await storage.delete(asset.thumbKey);
          removed.push(asset.id);
        } catch (err) {
          assetsFailed += 1;
          log.warn('Could not delete a stored object of a deleted account', {
            component: 'auth',
            userId,
            assetId: asset.id,
            err,
          });
        }
      }),
    );
    if (removed.length > 0) db.delete(assets).where(inArray(assets.id, removed)).run();
    assetsDeleted += removed.length;
  }

  // A generation whose files could not be removed keeps its asset rows (deleting it would cascade
  // them away together with the only record of the file names), so it waits for the next run.
  const generationsDeleted = withTx(db, (tx) => {
    const removedGenerations = tx
      .delete(generations)
      .where(
        and(
          eq(generations.userId, userId),
          sql`not exists (select 1 from ${assets} where ${assets.generationId} = ${generations.id})`,
        ),
      )
      .run().changes;
    // The ledger stays; it just no longer points at generations that do not exist.
    tx.update(creditLedger)
      .set({ generationId: null })
      .where(
        and(
          eq(creditLedger.userId, userId),
          isNotNull(creditLedger.generationId),
          sql`${creditLedger.generationId} not in (select ${generations.id} from ${generations} where ${generations.userId} = ${userId})`,
        ),
      )
      .run();
    return removedGenerations;
  });

  const leftovers = db
    .select({ total: count() })
    .from(generations)
    .where(eq(generations.userId, userId))
    .get();
  const leftoverAssets = db
    .select({ total: count() })
    .from(assets)
    .where(eq(assets.userId, userId))
    .get();
  return {
    assetsDeleted,
    assetsFailed,
    generationsDeleted,
    complete: (leftovers?.total ?? 0) === 0 && (leftoverAssets?.total ?? 0) === 0,
  };
}

/** Finishes the purge of every deleted account that still has content. Returns how many it touched. */
export async function resumeAccountPurges(limit: number = 50): Promise<number> {
  const db = getDb();
  const pending = db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNotNull(users.deletedAt),
        sql`(exists (select 1 from ${assets} where ${assets.userId} = ${users.id}) or exists (select 1 from ${generations} where ${generations.userId} = ${users.id}))`,
      ),
    )
    .limit(limit)
    .all();
  for (const row of pending) await purgeAccountContent(row.id);
  return pending.length;
}

export interface DeletionResult {
  /** The account had been deleted before; only leftover content was cleaned up. */
  alreadyDeleted: boolean;
  purge: PurgeResult;
}

function activeAdminsOtherThan(db: Db, userId: string): number {
  return (
    db
      .select({ total: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'admin'),
          isNull(users.disabledAt),
          isNull(users.deletedAt),
          ne(users.id, userId),
        ),
      )
      .get()?.total ?? 0
  );
}

export interface DeleteOptions {
  /** Operators (the CLI) may remove the last administrator; a user may not. */
  force?: boolean;
}

/**
 * Deletes the account (see the module comment). Idempotent: deleting a deleted account only
 * finishes any leftover purge. `not_found` for an unknown id; `conflict` for the last active
 * administrator unless `force`; `provider_error` (nothing changed) when a registered
 * `onAccountDeleted` hook fails.
 */
export async function deleteAccount(
  userId: string,
  options: DeleteOptions = {},
): Promise<DeletionResult> {
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, userId)).get();
  if (!row) throw AppError.of('not_found', 'User not found');
  if (row.deletedAt !== null) {
    return { alreadyDeleted: true, purge: await purgeAccountContent(userId) };
  }
  if (row.role === 'admin' && !options.force && activeAdminsOtherThan(db, userId) === 0) {
    throw AppError.of('conflict', 'The only administrator cannot delete the account');
  }

  await runAccountDeletedHooks({ userId, email: row.email, locale: row.locale });

  const tombstoned = withTx(db, (tx): UserRow | null => {
    const now = Date.now();
    const current = tx.select().from(users).where(eq(users.id, userId)).get();
    if (!current || current.deletedAt !== null) return null;

    // Running jobs are canceled and refunded like any other cancel; the runner notices on its
    // next poll and stops (the row it would write to is gone by then).
    const running = tx
      .select({ id: generations.id })
      .from(generations)
      .where(
        and(eq(generations.userId, userId), inArray(generations.status, ['queued', 'processing'])),
      )
      .all();
    for (const generation of running) markCanceled(tx, userId, generation.id);

    tx.delete(sessions).where(eq(sessions.userId, userId)).run();
    tx.update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .run();
    tx.delete(emailTokens).where(eq(emailTokens.userId, userId)).run();
    const email = tombstoneEmail(userId);
    tx.update(users)
      .set({
        email,
        emailCanonical: email,
        name: '',
        passwordHash: DESTROYED_PASSWORD_HASH,
        role: 'user',
        signupIp: null,
        emailVerifiedAt: null,
        disabledAt: now,
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId))
      .run();
    return current;
  });

  const purge = await purgeAccountContent(userId);
  if (tombstoned) {
    getLogger().info('Account deleted', {
      component: 'auth',
      userId,
      assetsDeleted: purge.assetsDeleted,
      purgeComplete: purge.complete,
    });
    queueAccountDeletedEmail({
      email: tombstoned.email,
      name: tombstoned.name,
      locale: tombstoned.locale,
    });
  }
  return { alreadyDeleted: tombstoned === null, purge };
}

/**
 * The self-service path: the caller must re-enter the account password. A wrong password is a 422
 * at path `password` (the user is signed in, only this input is wrong).
 */
export async function deleteAccountWithPassword(
  userId: string,
  password: string,
): Promise<DeletionResult> {
  const row = getDb().select().from(users).where(eq(users.id, userId)).get();
  if (!row || row.deletedAt !== null) throw AppError.of('not_found', 'User not found');
  if (!(await verifyPassword(password, row.passwordHash))) {
    throw fieldError('password', 'Password is incorrect');
  }
  return deleteAccount(userId);
}
