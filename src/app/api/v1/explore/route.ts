import { z } from 'zod';
import { KINDS } from '@/lib/catalog/types';
import { addressRoute } from '@/server/auth/address-route';
import { listPublicGenerations } from '@/server/generations/service';
import { page } from '@/server/http/respond';
import { EXPLORE_LIMIT, EXPLORE_SHARED_LIMIT } from '../generations/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const exploreQuerySchema = z.object({
  kind: z.enum(KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().min(1).max(512).optional(),
});

/**
 * The public feed: succeeded generations their owners chose to share, newest first. No account
 * is needed and credentials are not even read, so the answer is the same for everyone and a
 * browser or CDN may keep it for a few seconds. Limited per client address; when the address is
 * unknown (no trusted proxy) everybody shares one larger budget instead, see `EXPLORE_SHARED_LIMIT`.
 */
export const GET = addressRoute(
  { auth: 'none' },
  { perAddress: EXPLORE_LIMIT, sharedAddress: EXPLORE_SHARED_LIMIT },
  async (ctx) => {
    const result = await listPublicGenerations(ctx.query(exploreQuerySchema));
    return page(result.data, result.nextCursor, {
      headers: { 'Cache-Control': 'public, max-age=15, stale-while-revalidate=45' },
    });
  },
);
