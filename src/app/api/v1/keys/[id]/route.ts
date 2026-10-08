import { AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { revokeApiKey } from '@/server/auth/api-keys';
import { requireSession } from '@/server/auth/http';
import { noContent } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { KEYS_WRITE_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `DELETE /api/v1/keys/:id` -> 204. 404 for a key that does not exist or belongs to someone else
 * (indistinguishable on purpose). Revoking twice is fine. Session only.
 */
export const DELETE = route<{ id: string }>(
  { auth: 'required', rateLimit: KEYS_WRITE_RATE_LIMIT },
  async (ctx) => {
    requireSession(ctx.auth);
    if (!isValidId(ctx.params.id, 'key')) throw AppError.of('not_found', 'API key not found');
    await revokeApiKey(ctx.auth.user.id, ctx.params.id);
    return noContent();
  },
);
