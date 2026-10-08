// OWNER: engine — replace this stub
import 'server-only';
import type { GenerationDTO } from '@/lib/api-types';
import { NotImplementedError } from '@/lib/errors';
import type { DbOrTx } from '@/server/db';
import type { GenerationRow } from '@/server/db/schema';

/** A generation by id, whoever owns it. Undefined when it does not exist. */
export function findGenerationRow(_db: DbOrTx, _id: string): GenerationRow | undefined {
  throw new NotImplementedError('generations.findGenerationRow');
}

/** A generation only if `userId` owns it, so callers answer `not_found` for other people's ids. */
export function findOwnedGenerationRow(
  _db: DbOrTx,
  _userId: string,
  _id: string,
): GenerationRow | undefined {
  throw new NotImplementedError('generations.findOwnedGenerationRow');
}

/** Number of the user's generations that are queued or processing (for `MAX_ACTIVE_PER_USER`). */
export function countActiveGenerations(_db: DbOrTx, _userId: string): number {
  throw new NotImplementedError('generations.countActiveGenerations');
}

/**
 * Turns rows into DTOs with two batched asset queries (outputs and inputs), not one per row.
 * `withOwner` adds `owner.name` for public feeds.
 */
export function hydrateGenerations(
  _db: DbOrTx,
  _rows: readonly GenerationRow[],
  _options?: { withOwner?: boolean },
): GenerationDTO[] {
  throw new NotImplementedError('generations.hydrateGenerations');
}
