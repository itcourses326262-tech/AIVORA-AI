import { getTools } from '@/lib/tools';
import { ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { CATALOG_RATE_LIMIT } from '../models/rate-limit';

/** The four tools. Static and identical for everyone, so shared caches may keep it for a while. */
export const GET = route({ auth: 'optional', rateLimit: CATALOG_RATE_LIMIT }, async () =>
  ok(getTools(), { headers: { 'Cache-Control': 'public, max-age=300' } }),
);
