import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, vi } from 'vitest';
import { newId } from '@/lib/id';
import type { AuthContext } from '@/server/auth';
import { hashToken } from '@/server/auth/tokens';
import { getDb } from '@/server/db';
import {
  apiKeys,
  assets,
  generations,
  sessions,
  users,
  type AssetRow,
  type GenerationRow,
  type UserRow,
} from '@/server/db/schema';
import { SESSION_COOKIE_NAME } from '@/server/http/request';
import { setStorageOverride } from '@/server/storage';
import { createLocalStorage } from '@/server/storage/local';
import type { StorageDriver } from '@/server/storage/types';
import { createAsset, createGeneration } from '../../../../helpers/factories';

/**
 * What `authenticate` does for the routes under test, over the real tables: a session cookie or an
 * `avk_` bearer key resolves to its user; anything else (unknown, expired, revoked) to null.
 */
export async function authenticateFromDb(req: Request): Promise<AuthContext | null> {
  const db = getDb();
  const userContext = (row: UserRow | undefined) =>
    row && !row.disabledAt
      ? {
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          locale: row.locale,
          creditBalance: row.creditBalance,
        }
      : null;

  const bearer = /^Bearer (.+)$/i.exec(req.headers.get('authorization') ?? '')?.[1];
  if (bearer) {
    const key = db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, hashToken(bearer)), isNull(apiKeys.revokedAt)))
      .get();
    const user = key && userContext(db.select().from(users).where(eq(users.id, key.userId)).get());
    return key && user ? { user, via: 'api_key', apiKeyId: key.id } : null;
  }

  const cookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`).exec(
    req.headers.get('cookie') ?? '',
  )?.[1];
  if (!cookie) return null;
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(cookie)), gt(sessions.expiresAt, Date.now())))
    .get();
  const user =
    session && userContext(db.select().from(users).where(eq(users.id, session.userId)).get());
  return session && user ? { user, via: 'session', sessionId: session.id } : null;
}

/** An API key for `userId`; returns the raw key to send as `Authorization: Bearer …`. */
export function createApiKeyFor(userId: string): {
  key: string;
  headers: { authorization: string };
} {
  const key = `avk_${newId('key').slice(4, 12)}_${newId('key').slice(4)}`;
  getDb()
    .insert(apiKeys)
    .values({
      id: newId('key'),
      userId,
      name: 'test key',
      prefix: key.slice(0, 12),
      keyHash: hashToken(key),
      createdAt: Date.now(),
    })
    .run();
  return { key, headers: { authorization: `Bearer ${key}` } };
}

/** A local-disk storage in a throwaway directory, installed as the process-wide driver. */
export function withTempStorage(): { readonly storage: StorageDriver; readonly directory: string } {
  const holder = {} as { storage: StorageDriver; directory: string };
  beforeEach(() => {
    holder.directory = mkdtempSync(join(tmpdir(), 'aivore-media-route-'));
    holder.storage = createLocalStorage(holder.directory);
    setStorageOverride(holder.storage);
  });
  afterEach(() => {
    setStorageOverride(null);
    rmSync(holder.directory, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  return holder;
}

export interface StoredAssetOptions {
  userId: string;
  bytes: Uint8Array;
  mimeType?: string;
  role?: 'input' | 'output';
  kind?: 'image' | 'video';
  /** Create the asset as the output of a generation with this visibility. */
  generation?: { isPublic: boolean } | GenerationRow;
  thumb?: Uint8Array | null;
  extension?: string;
}

/** Writes the object(s) to `storage` and inserts the row, exactly as the engine / uploads do. */
export async function storeAsset(
  storage: StorageDriver,
  options: StoredAssetOptions,
): Promise<AssetRow> {
  const db = getDb();
  const generation =
    options.generation === undefined
      ? undefined
      : 'id' in options.generation
        ? options.generation
        : createGeneration(db, { userId: options.userId, isPublic: options.generation.isPublic });
  const id = newId('ast');
  const folder = generation?.id ?? 'uploads';
  const mimeType = options.mimeType ?? 'image/png';
  const extension = options.extension ?? (mimeType === 'video/mp4' ? 'mp4' : 'png');
  const storageKey = `u/${options.userId}/${folder}/${id}.${extension}`;
  const thumbKey = options.thumb === null ? null : `u/${options.userId}/${folder}/${id}.thumb.webp`;
  await storage.put(storageKey, options.bytes, { mimeType });
  if (thumbKey && options.thumb)
    await storage.put(thumbKey, options.thumb, { mimeType: 'image/webp' });
  return createAsset(db, {
    id,
    userId: options.userId,
    generationId: generation?.id ?? null,
    role: options.role ?? (generation ? 'output' : 'input'),
    kind: options.kind ?? 'image',
    storageKey,
    thumbKey: options.thumb ? thumbKey : null,
    mimeType,
    bytes: options.bytes.byteLength,
  });
}

export function setGenerationPublic(generationId: string, isPublic: boolean): void {
  getDb().update(generations).set({ isPublic }).where(eq(generations.id, generationId)).run();
}

export function tamperMimeType(assetId: string, mimeType: string): void {
  getDb().update(assets).set({ mimeType }).where(eq(assets.id, assetId)).run();
}
