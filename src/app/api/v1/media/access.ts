import { eq } from 'drizzle-orm';
import type { Db } from '@/server/db';
import { assets, generations, type AssetRow } from '@/server/db/schema';

export interface VisibleAsset {
  asset: AssetRow;
  /** `owner`: the caller owns it. `public`: someone else's output that its owner shared. */
  access: 'owner' | 'public';
}

/**
 * The asset if `viewerId` may see it, otherwise null, with no way to tell "does not exist" from
 * "not yours". Owners see everything of theirs. Everyone else sees an asset only when it is an
 * output of a generation marked public: uploaded inputs are never shared, even when the
 * generation made from them is.
 */
export function findVisibleAsset(
  db: Db,
  assetId: string,
  viewerId: string | null,
): VisibleAsset | null {
  const row = db
    .select({ asset: assets, generationIsPublic: generations.isPublic })
    .from(assets)
    .leftJoin(generations, eq(assets.generationId, generations.id))
    .where(eq(assets.id, assetId))
    .get();
  if (!row) return null;
  if (viewerId !== null && row.asset.userId === viewerId)
    return { asset: row.asset, access: 'owner' };
  if (row.asset.role === 'output' && row.generationIsPublic === true) {
    return { asset: row.asset, access: 'public' };
  }
  return null;
}
