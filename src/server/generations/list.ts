import 'server-only';
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { GenerationStatus } from '@/lib/api-types';
import type { Kind } from '@/lib/catalog/types';
import { AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { clamp, decodeCursor, encodeCursor } from '@/lib/utils';
import type { DbOrTx } from '@/server/db';
import { generations, users, type GenerationRow } from '@/server/db/schema';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
/** Most ids one batch-polling request may name. */
export const MAX_BATCH_IDS = 50;

interface KeysetCursor {
  createdAt: number;
  id: string;
}

export interface OwnedFilter {
  kind?: Kind;
  status?: GenerationStatus;
  favorite?: boolean;
  q?: string;
  ids?: readonly string[];
  limit?: number;
  cursor?: string;
}

export interface PublicFilter {
  kind?: Kind;
  limit?: number;
  cursor?: string;
}

/** A page of rows plus the cursor of the next page, or null on the last page. */
export interface RowPage {
  rows: GenerationRow[];
  nextCursor: string | null;
}

function pageSize(limit: number | undefined): number {
  return typeof limit === 'number' && Number.isFinite(limit)
    ? clamp(Math.trunc(limit), 1, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}

function parseCursor(cursor: string | undefined): KeysetCursor | undefined {
  if (cursor === undefined) return undefined;
  const [createdAt, id] = decodeCursor(cursor) ?? [];
  if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || typeof id !== 'string') {
    throw AppError.of('bad_request', 'Invalid cursor');
  }
  return { createdAt, id };
}

/** Rows strictly after `cursor` in (createdAt desc, id desc) order; the id breaks timestamp ties. */
function afterCursor(cursor: KeysetCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(generations.createdAt, cursor.createdAt),
    and(eq(generations.createdAt, cursor.createdAt), lt(generations.id, cursor.id)),
  );
}

/** Escapes LIKE wildcards so a search for `100%` finds "100%" and not everything. */
export function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function toPage(rows: GenerationRow[], limit: number): RowPage {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    rows: pageRows,
    nextCursor: hasMore && last ? encodeCursor([last.createdAt, last.id]) : null,
  };
}

/**
 * The user's own generations, newest first. With `ids` it is a batch lookup (at most
 * {@link MAX_BATCH_IDS} ids, no paging) for cheap polling of the generations still running.
 */
export function selectOwnedRows(db: DbOrTx, userId: string, filter: OwnedFilter): RowPage {
  if (filter.ids && filter.ids.length > MAX_BATCH_IDS) {
    throw new AppError('validation_failed', 422, 'Request validation failed', {
      issues: [{ path: 'ids', message: `At most ${MAX_BATCH_IDS} ids per request` }],
    });
  }
  // Ids that cannot be generation ids cannot match, so they are dropped instead of failing the batch.
  const batch = filter.ids && [...new Set(filter.ids.filter((id) => isValidId(id, 'gen')))];
  if (batch?.length === 0) return { rows: [], nextCursor: null };

  const text = filter.q?.trim();
  const limit = batch ? batch.length : pageSize(filter.limit);
  const rows = db
    .select()
    .from(generations)
    .where(
      and(
        eq(generations.userId, userId),
        batch ? inArray(generations.id, batch) : undefined,
        filter.kind ? eq(generations.kind, filter.kind) : undefined,
        filter.status ? eq(generations.status, filter.status) : undefined,
        filter.favorite === undefined ? undefined : eq(generations.isFavorite, filter.favorite),
        text ? sql`${generations.prompt} like ${likePattern(text)} escape '\\'` : undefined,
        batch ? undefined : afterCursor(parseCursor(filter.cursor)),
      ),
    )
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(limit + 1)
    .all();
  return batch ? { rows, nextCursor: null } : toPage(rows, limit);
}

/**
 * Succeeded generations their owners made public, newest first. Accounts that were disabled drop
 * out of the feed together with everything they shared.
 */
export function selectPublicRows(db: DbOrTx, filter: PublicFilter): RowPage {
  const limit = pageSize(filter.limit);
  const rows = db
    .select({ generation: generations })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .where(
      and(
        eq(generations.isPublic, true),
        eq(generations.status, 'succeeded'),
        isNull(users.disabledAt),
        filter.kind ? eq(generations.kind, filter.kind) : undefined,
        afterCursor(parseCursor(filter.cursor)),
      ),
    )
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(limit + 1)
    .all()
    .map((row) => row.generation);
  return toPage(rows, limit);
}

/** One public, succeeded generation of an enabled account, or undefined. */
export function findPublicRow(db: DbOrTx, id: string): GenerationRow | undefined {
  return db
    .select({ generation: generations })
    .from(generations)
    .innerJoin(users, eq(users.id, generations.userId))
    .where(
      and(
        eq(generations.id, id),
        eq(generations.isPublic, true),
        eq(generations.status, 'succeeded'),
        isNull(users.disabledAt),
      ),
    )
    .get()?.generation;
}
