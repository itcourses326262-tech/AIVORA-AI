import { eq } from 'drizzle-orm';
import type { Db } from '@/server/db';
import { assets, generations, users, type AssetRow } from '@/server/db/schema';

export interface VisibleAsset {
  asset: AssetRow;
  /** `owner`: the caller owns it. `public`: someone else's output that its owner shared. */
  access: 'owner' | 'public';
}

/**
 * The asset if `viewerId` may see it, otherwise null, with no way to tell "does not exist" from
 * "not yours". Owners see everything of theirs. Everyone else sees an asset only when it is an
 * output of a generation marked public whose owner's account is enabled (a disabled account's
 * shared results are offline everywhere, as in the public feed): uploaded inputs are never
 * shared, even when the generation made from them is.
 */
export function findVisibleAsset(
  db: Db,
  assetId: string,
  viewerId: string | null,
): VisibleAsset | null {
  const row = db
    .select({
      asset: assets,
      generationIsPublic: generations.isPublic,
      ownerDisabledAt: users.disabledAt,
    })
    .from(assets)
    .leftJoin(generations, eq(assets.generationId, generations.id))
    .leftJoin(users, eq(assets.userId, users.id))
    .where(eq(assets.id, assetId))
    .get();
  if (!row) return null;
  if (viewerId !== null && row.asset.userId === viewerId)
    return { asset: row.asset, access: 'owner' };
  if (
    row.asset.role === 'output' &&
    row.generationIsPublic === true &&
    row.ownerDisabledAt === null
  ) {
    return { asset: row.asset, access: 'public' };
  }
  return null;
}
