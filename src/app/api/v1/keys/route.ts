import { createApiKey, listApiKeys } from '@/server/auth/api-keys';
import { requireSession } from '@/server/auth/http';
import { AUTH_BODY_LIMIT, createApiKeySchema } from '@/server/auth/schemas';
import { created, page } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { KEYS_READ_RATE_LIMIT, KEYS_WRITE_RATE_LIMIT } from './rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/v1/keys` -> the user's API keys (prefix only, never the secret). Session only. */
export const GET = route({ auth: 'required', rateLimit: KEYS_READ_RATE_LIMIT }, async (ctx) => {
  requireSession(ctx.auth);
  return page(await listApiKeys(ctx.auth.user.id), null);
});

/**
 * `POST /api/v1/keys` `{ name }` -> 201 `{ data: { key, record } }`. `key` is the only time the full
 * `avk_…` secret is ever visible. At most 20 active keys (409 beyond that). Session only.
 */
export const POST = route(
  { auth: 'required', rateLimit: KEYS_WRITE_RATE_LIMIT, maxBodyBytes: AUTH_BODY_LIMIT },
  async (ctx) => {
    requireSession(ctx.auth);
    const body = await ctx.body(createApiKeySchema);
    return created(await createApiKey(ctx.auth.user.id, body.name));
  },
);
