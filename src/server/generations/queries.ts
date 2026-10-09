import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { GenerationDTO } from '@/lib/api-types';
import { firstNameOf } from '@/lib/public-name';
import type { DbOrTx } from '@/server/db';
import { assets, generations, users, type AssetRow, type GenerationRow } from '@/server/db/schema';
import { toGenerationDTO, toPublicGenerationDTO } from './dto';

/**
 * The roles an asset may have to serve as the input image of a generation: something the user
 * uploaded (`input`) or a picture one of their own generations produced (`output`).
 */
export const INPUT_ASSET_ROLES = ['input', 'output'] as const;

/** A generation by id, whoever owns it. Undefined when it does not exist. */
export function findGenerationRow(db: DbOrTx, id: string): GenerationRow | undefined {
  return db.select().from(generations).where(eq(generations.id, id)).get();
}

/** A generation only if `userId` owns it, so callers answer `not_found` for other people's ids. */
export function findOwnedGenerationRow(
  db: DbOrTx,
  userId: string,
  id: string,
): GenerationRow | undefined {
  return db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.userId, userId)))
    .get();
}

/** Number of the user's generations that are queued or processing (for `MAX_ACTIVE_PER_USER`). */
export function countActiveGenerations(db: DbOrTx, userId: string): number {
  const row = db
    .select({ total: sql<number>`count(*)` })
    .from(generations)
    .where(
      and(eq(generations.userId, userId), inArray(generations.status, ['queued', 'processing'])),
    )
    .get();
  return row?.total ?? 0;
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const list = groups.get(key(item));
    if (list) list.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/**
 * Turns rows into DTOs with batched queries (outputs, inputs, owners), not one per row.
 * `withOwner` produces the public view: it adds `owner.name` and leaves out what only the owner
 * may see (the input image and the favorite flag), so it is the only option feeds should use.
 */
export function hydrateGenerations(
  db: DbOrTx,
  rows: readonly GenerationRow[],
  options: { withOwner?: boolean } = {},
): GenerationDTO[] {
  if (rows.length === 0) return [];

  const outputs = groupBy(
    db
      .select()
      .from(assets)
      .where(
        and(
          inArray(
            assets.generationId,
            rows.map((row) => row.id),
          ),
          eq(assets.role, 'output'),
        ),
      )
      .orderBy(asc(assets.index), asc(assets.createdAt))
      .all(),
    (asset) => asset.generationId,
  );

  if (options.withOwner) {
    const ownerIds = [...new Set(rows.map((row) => row.userId))];
    const names = new Map(
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ownerIds))
        .all()
        .map((owner) => [owner.id, owner.name]),
    );
    return rows.map((row) =>
      toPublicGenerationDTO(row, {
        outputs: outputs.get(row.id) ?? [],
        // Public feeds show the first name only, whatever the account is called in full.
        owner: { name: firstNameOf(names.get(row.userId)) ?? '' },
      }),
    );
  }

  const inputIds = [
    ...new Set(rows.flatMap((row) => (row.inputAssetId ? [row.inputAssetId] : []))),
  ];
  const inputs = new Map<string, AssetRow>(
    inputIds.length === 0
      ? []
      : db
          .select()
          .from(assets)
          .where(inArray(assets.id, inputIds))
          .all()
          .map((asset) => [asset.id, asset]),
  );
  return rows.map((row) => {
    // The input (an upload, or an output of an earlier generation of the same user) belongs to the
    // generation's owner by construction; checking again keeps a hand-edited row from ever
    // surfacing someone else's file.
    const input = row.inputAssetId ? inputs.get(row.inputAssetId) : undefined;
    return toGenerationDTO(row, {
      outputs: outputs.get(row.id) ?? [],
      ...(input && input.userId === row.userId ? { input } : {}),
    });
  });
}
