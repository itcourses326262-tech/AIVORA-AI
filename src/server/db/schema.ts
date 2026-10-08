import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';
import { ASSET_ROLES, GENERATION_STATUSES, LEDGER_REASONS, USER_ROLES } from '@/lib/api-types';
import { KINDS, PROVIDER_IDS, TOOLS, type GenerationParams } from '@/lib/catalog/types';
import { LOCALES } from '@/lib/i18n/locales';

/**
 * Database schema (docs/ARCHITECTURE.md section 4). Ids are text primary keys from `newId`;
 * timestamps are integer milliseconds since the epoch. After changing this file run
 * `npm run db:generate` and commit the new SQL in `drizzle/`.
 */

/** `column IN ('a', 'b')` built from a constant list, so TS unions and SQL CHECKs cannot drift. */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => sql.raw(`'${value.replace(/'/g, "''")}'`));
  return sql`${column} in (${sql.join(literals, sql`, `)})`;
}

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('user'),
    locale: text('locale', { enum: LOCALES }).notNull().default('ar'),
    /** Cached balance; the ledger is the audit trail. Never negative. */
    creditBalance: integer('credit_balance').notNull().default(0),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    disabledAt: integer('disabled_at'),
  },
  (t) => [
    check('users_credit_balance_nonnegative', sql`${t.creditBalance} >= 0`),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_role_valid', oneOf(t.role, USER_ROLES)),
    check('users_locale_valid', oneOf(t.locale, LOCALES)),
  ],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the cookie token (+ pepper); the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: integer('expires_at').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const apiKeys = sqliteTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display prefix such as `avk_ab12cd34`. */
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull().unique(),
    lastUsedAt: integer('last_used_at'),
    revokedAt: integer('revoked_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('api_keys_user_idx').on(t.userId)],
);

export const creditLedger = sqliteTable(
  'credit_ledger',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    delta: integer('delta').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    reason: text('reason', { enum: LEDGER_REASONS }).notNull(),
    /** Deliberately not a foreign key: ledger rows outlive the generation they refer to. */
    generationId: text('generation_id'),
    note: text('note'),
    /** Globally unique when set (NULLs do not collide), which makes grants and refunds replayable. */
    idempotencyKey: text('idempotency_key'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('credit_ledger_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('credit_ledger_generation_idx').on(t.generationId),
    uniqueIndex('credit_ledger_idempotency_uq').on(t.idempotencyKey),
    check('credit_ledger_delta_nonzero', sql`${t.delta} <> 0`),
    check('credit_ledger_balance_nonnegative', sql`${t.balanceAfter} >= 0`),
    check('credit_ledger_reason_valid', oneOf(t.reason, LEDGER_REASONS)),
  ],
);

export const generations = sqliteTable(
  'generations',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tool: text('tool', { enum: TOOLS }).notNull(),
    kind: text('kind', { enum: KINDS }).notNull(),
    modelId: text('model_id').notNull(),
    provider: text('provider', { enum: PROVIDER_IDS }).notNull(),
    status: text('status', { enum: GENERATION_STATUSES }).notNull().default('queued'),
    prompt: text('prompt').notNull(),
    negativePrompt: text('negative_prompt'),
    params: text('params', { mode: 'json' }).$type<GenerationParams>().notNull(),
    inputAssetId: text('input_asset_id').references((): AnySQLiteColumn => assets.id, {
      onDelete: 'set null',
    }),
    cost: integer('cost').notNull(),
    progress: integer('progress').notNull().default(0),
    providerJobId: text('provider_job_id'),
    providerMeta: text('provider_meta', { mode: 'json' }).$type<Record<string, unknown>>(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    workerId: text('worker_id'),
    leaseUntil: integer('lease_until'),
    idempotencyKey: text('idempotency_key'),
    isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
  },
  (t) => [
    index('generations_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    index('generations_status_lease_idx').on(t.status, t.leaseUntil),
    index('generations_public_created_idx').on(t.isPublic, sql`${t.createdAt} desc`),
    uniqueIndex('generations_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    check('generations_status_valid', oneOf(t.status, GENERATION_STATUSES)),
    check('generations_tool_valid', oneOf(t.tool, TOOLS)),
    check('generations_kind_valid', oneOf(t.kind, KINDS)),
    check('generations_provider_valid', oneOf(t.provider, PROVIDER_IDS)),
    check('generations_progress_range', sql`${t.progress} between 0 and 100`),
    check('generations_cost_nonnegative', sql`${t.cost} >= 0`),
    check('generations_attempts_nonnegative', sql`${t.attempts} >= 0`),
  ],
);

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    generationId: text('generation_id').references(() => generations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ASSET_ROLES }).notNull(),
    kind: text('kind', { enum: KINDS }).notNull(),
    /** Position among a generation's outputs. */
    index: integer('output_index').notNull().default(0),
    storageKey: text('storage_key').notNull(),
    thumbKey: text('thumb_key'),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    sha256: text('sha256'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    index('assets_generation_idx').on(t.generationId, t.index),
    index('assets_user_created_idx').on(t.userId, sql`${t.createdAt} desc`),
    check('assets_role_valid', oneOf(t.role, ASSET_ROLES)),
    check('assets_kind_valid', oneOf(t.kind, KINDS)),
    check('assets_bytes_nonnegative', sql`${t.bytes} >= 0`),
    check('assets_index_nonnegative', sql`${t.index} >= 0`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKeyRow = typeof apiKeys.$inferInsert;
export type LedgerEntry = typeof creditLedger.$inferSelect;
export type NewLedgerEntry = typeof creditLedger.$inferInsert;
export type GenerationRow = typeof generations.$inferSelect;
export type NewGenerationRow = typeof generations.$inferInsert;
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
