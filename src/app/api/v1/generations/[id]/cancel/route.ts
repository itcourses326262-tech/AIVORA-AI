import { cancelGeneration } from '@/server/generations/service';
import { route } from '@/server/http/route';
import { GENERATION_WRITE_LIMIT } from '../../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cancels a queued or running generation and refunds its credits. Canceling again is harmless;
 * 409 once the generation has already succeeded or failed.
 */
export const POST = route<{ id: string }>(
  { auth: 'required', rateLimit: GENERATION_WRITE_LIMIT },
  (ctx) => cancelGeneration(ctx.auth.user.id, ctx.params.id),
);
