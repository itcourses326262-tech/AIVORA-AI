import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { getDb } from '@/server/db';
import { route, type RouteCtx } from '@/server/http/route';
import { getStorage } from '@/server/storage';
import { withMediaRateLimit } from '../rate-limit';
import { serveAsset } from '../serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  variant: z.enum(['thumb']).optional(),
  download: z.enum(['1', 'true', '0', 'false']).optional(),
});

function serve(ctx: RouteCtx<{ assetId: string }>, head: boolean): Promise<Response> {
  return withMediaRateLimit(ctx, async () => {
    const { assetId } = ctx.params;
    if (!isValidId(assetId, 'ast')) throw AppError.of('not_found', 'Asset not found');
    const query = ctx.query(querySchema);
    return serveAsset({
      req: ctx.req,
      db: getDb(),
      storage: getStorage(),
      assetId,
      viewerId: ctx.auth?.user.id ?? null,
      variant: query.variant ?? 'original',
      download: query.download === '1' || query.download === 'true',
      head,
    });
  });
}

// `rateLimit: false`: the media budget is spent inside `serve` (see `withMediaRateLimit`), because
// `route()`'s own limiter would put every anonymous viewer of a site without TRUST_PROXY in one
// bucket.
const options = { auth: 'optional', rateLimit: false } as const;

/**
 * Serves an asset (or its thumbnail with `?variant=thumb`, or as a download with `?download=1`) to
 * its owner or, for outputs of public generations, to anyone. See `serveAsset`.
 */
export const GET = route<{ assetId: string }>(options, (ctx) => serve(ctx, false));
export const HEAD = route<{ assetId: string }>(options, (ctx) => serve(ctx, true));
