import { z } from 'zod';
import { GENERATION_STATUSES } from '@/lib/api-types';
import { KINDS } from '@/lib/catalog/types';
import { AppError } from '@/lib/errors';
import { isValidId } from '@/lib/id';
import { createGenerationRequestSchema } from '@/lib/validation/generation';
import { MAX_BATCH_IDS } from '@/server/generations/list';
import { isValidIdempotencyKey } from '@/server/generations/idempotency';
import { createGeneration, listGenerations } from '@/server/generations/service';
import { created, ok, page } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { GENERATION_CREATE_LIMIT, GENERATION_READ_LIMIT, enforceSearchLimit } from './limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Generous for a JSON body: prompts are capped at 4000 characters (up to 4 bytes each in UTF-8). */
const MAX_CREATE_BODY_BYTES = 64 * 1024;

function idempotencyKeyOf(req: Request): string | undefined {
  const header = req.headers.get('idempotency-key');
  if (header === null) return undefined;
  const key = header.trim();
  if (!isValidIdempotencyKey(key)) {
    throw new AppError('validation_failed', 422, 'Request validation failed', {
      issues: [
        {
          path: 'Idempotency-Key',
          message: 'Must be 1 to 128 visible ASCII characters without spaces',
        },
      ],
    });
  }
  return key;
}

/**
 * Starts a generation: 201 with the queued `GenerationDTO`. With an `Idempotency-Key` header a
 * retry of the same request returns the original generation with 200 and charges nothing more.
 */
export const POST = route(
  { auth: 'required', rateLimit: GENERATION_CREATE_LIMIT, maxBodyBytes: MAX_CREATE_BODY_BYTES },
  async (ctx) => {
    const body = await ctx.body(createGenerationRequestSchema);
    const idempotencyKey = idempotencyKeyOf(ctx.req);
    const { generation, created: isNew } = await createGeneration(ctx.auth.user.id, body, {
      idempotencyKey,
    });
    return isNew
      ? created(generation)
      : ok(generation, { headers: { 'Idempotent-Replayed': 'true' } });
  },
);

const flag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** `ids=a,b,c` and `ids=a&ids=b` both work. */
const idList = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((part) => part.split(','))
      .map((id) => id.trim())
      .filter((id) => id !== ''),
  )
  .pipe(
    z
      .array(z.string().refine((id) => isValidId(id, 'gen'), 'Not a generation id'))
      .min(1)
      .max(MAX_BATCH_IDS, `At most ${MAX_BATCH_IDS} ids per request`),
  );

const listQuerySchema = z.object({
  kind: z.enum(KINDS).optional(),
  status: z.enum(GENERATION_STATUSES).optional(),
  favorite: flag.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  ids: idList.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});

/**
 * The caller's generations, newest first, with keyset pagination (`nextCursor`). `?ids=` returns
 * exactly those generations (up to 50) for cheap batch polling.
 */
export const GET = route({ auth: 'required', rateLimit: GENERATION_READ_LIMIT }, async (ctx) => {
  const query = ctx.query(listQuerySchema);
  if (query.q !== undefined) enforceSearchLimit(ctx.auth.user.id);
  const result = await listGenerations(ctx.auth.user.id, query);
  return page(result.data, result.nextCursor);
});
