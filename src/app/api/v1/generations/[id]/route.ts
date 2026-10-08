import { z } from 'zod';
import { deleteGeneration, getGeneration, updateGeneration } from '@/server/generations/service';
import { route } from '@/server/http/route';
import { GENERATION_READ_LIMIT, GENERATION_WRITE_LIMIT } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Only these two flags can be changed; anything else in the body is an error, not ignored. */
const updateSchema = z
  .object({ isPublic: z.boolean().optional(), isFavorite: z.boolean().optional() })
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, 'Send isPublic and/or isFavorite');

/** One of the caller's generations; 404 for anything else, including other users' ids. */
export const GET = route<Params>({ auth: 'required', rateLimit: GENERATION_READ_LIMIT }, (ctx) =>
  getGeneration(ctx.auth.user.id, ctx.params.id),
);

/** Share or favorite a generation. */
export const PATCH = route<Params>(
  { auth: 'required', rateLimit: GENERATION_WRITE_LIMIT, maxBodyBytes: 4 * 1024 },
  async (ctx) => {
    const patch = await ctx.body(updateSchema);
    return updateGeneration(ctx.auth.user.id, ctx.params.id, patch);
  },
);

/**
 * Deletes a generation and its files (204). One that is still running is canceled and refunded
 * first.
 */
export const DELETE = route<Params>(
  { auth: 'required', rateLimit: GENERATION_WRITE_LIMIT },
  async (ctx) => {
    await deleteGeneration(ctx.auth.user.id, ctx.params.id);
  },
);
