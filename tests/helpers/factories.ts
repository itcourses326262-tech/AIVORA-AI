import { newId } from '@/lib/id';
import { getTool } from '@/lib/tools';
import type { DbOrTx } from '@/server/db';
import {
  assets,
  generations,
  sessions,
  type AssetRow,
  type GenerationRow,
  type NewAssetRow,
  type NewGenerationRow,
  type NewUserRow,
  type SessionRow,
  type UserRow,
} from '@/server/db/schema';
import { SESSION_COOKIE_NAME } from '@/server/http/request';
import { generateToken, hashToken } from '@/server/auth/tokens';
import { getEnv } from '@/server/env';
import { seedUser } from './db';

export { fakeProvider, fakeProviderContext, fakeStorage, tinyOutput } from './fakes';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Inserts a user (50 credits, locale `ar`, role `user`); emails are lowercased like the app does. */
export function createUser(db: DbOrTx, overrides: Partial<NewUserRow> = {}): UserRow {
  const email = overrides.email?.trim().toLowerCase();
  return seedUser(db, { ...overrides, ...(email === undefined ? {} : { email }) });
}

export interface TestSession {
  /** Row id (`ses_…`). */
  id: string;
  userId: string;
  /** The raw cookie value; only its hash is stored. */
  token: string;
  expiresAt: number;
  /** `aivore_session=<token>`, ready for a `Cookie` header. */
  cookie: string;
  /**
   * Headers of a browser request from this session: the cookie plus an `Origin` equal to
   * `APP_URL`, so mutating requests pass the same-origin (CSRF) check.
   */
  headers: { cookie: string; origin: string };
  row: SessionRow;
}

/**
 * Inserts a session for `userId` straight into the database, hashing the token exactly like
 * `server/auth` does (`hashToken`), so it authenticates once auth is implemented without going
 * through login. Expires in 30 days unless `expiresAt` is given.
 */
export function createSession(
  db: DbOrTx,
  userId: string,
  options: { expiresAt?: number; userAgent?: string; ip?: string } = {},
): TestSession {
  const now = Date.now();
  const token = generateToken();
  const expiresAt = options.expiresAt ?? now + 30 * DAY_MS;
  const row = db
    .insert(sessions)
    .values({
      id: newId('ses'),
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: now,
      lastSeenAt: now,
      userAgent: options.userAgent ?? null,
      ip: options.ip ?? null,
    })
    .returning()
    .get();
  const cookie = `${SESSION_COOKIE_NAME}=${token}`;
  return {
    id: row.id,
    userId,
    token,
    expiresAt,
    cookie,
    headers: { cookie, origin: getEnv().APP_URL },
    row,
  };
}

/** A user and a logged-in session in one call. */
export function createUserWithSession(
  db: DbOrTx,
  overrides: Partial<NewUserRow> = {},
): { user: UserRow; session: TestSession } {
  const user = createUser(db, overrides);
  return { user, session: createSession(db, user.id) };
}

/**
 * Inserts an asset row. Defaults to a PNG input image of the user; pass `role: 'output'` and a
 * `generationId` for outputs. It writes no file: pair it with `fakeStorage().put` when needed.
 */
export function createAsset(
  db: DbOrTx,
  overrides: Partial<NewAssetRow> & Pick<NewAssetRow, 'userId'>,
): AssetRow {
  const id = overrides.id ?? newId('ast');
  const role = overrides.role ?? 'input';
  const folder = overrides.generationId ?? 'uploads';
  return db
    .insert(assets)
    .values({
      id,
      role,
      kind: 'image',
      index: 0,
      storageKey: `u/${overrides.userId}/${folder}/${id}.png`,
      mimeType: 'image/png',
      bytes: 1024,
      width: 512,
      height: 512,
      createdAt: Date.now(),
      ...overrides,
    })
    .returning()
    .get();
}

/**
 * Inserts a `queued` text-to-image generation on the Demo image model (cost 1, one 1:1 image). The
 * kind follows `tool` unless given. It only inserts the row: it does not debit credits, so use
 * `debitCredits` too when a test is about money.
 */
export function createGeneration(
  db: DbOrTx,
  overrides: Partial<NewGenerationRow> & Pick<NewGenerationRow, 'userId'>,
): GenerationRow {
  const now = Date.now();
  const tool = overrides.tool ?? 'text-to-image';
  const isVideo = (overrides.kind ?? getTool(tool)?.kind) === 'video';
  return db
    .insert(generations)
    .values({
      id: newId('gen'),
      tool,
      kind: getTool(tool)?.kind ?? 'image',
      modelId: isVideo ? 'aivore-demo-video' : 'aivore-demo-image',
      provider: 'mock',
      status: 'queued',
      prompt: 'a red fox in a snowy forest',
      params: isVideo
        ? { aspectRatio: '16:9', count: 1, durationSec: 3, resolution: '480p' }
        : { aspectRatio: '1:1', count: 1 },
      cost: 1,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning()
    .get();
}
