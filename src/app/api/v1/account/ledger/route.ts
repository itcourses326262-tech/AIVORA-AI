import { getDb } from '@/server/db';
import { listLedger } from '@/server/credits';
import { pageQuerySchema } from '@/server/http/request';
import { page } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { ACCOUNT_READ_RATE_LIMIT } from '../rate-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `GET /api/v1/account/ledger?limit=&cursor=` -> the user's credit history, newest first. */
export const GET = route({ auth: 'required', rateLimit: ACCOUNT_READ_RATE_LIMIT }, async (ctx) => {
  const { limit, cursor } = ctx.query(pageQuerySchema);
  const result = listLedger(getDb(), ctx.auth.user.id, { limit, cursor });
  return page(result.data, result.nextCursor);
});
