import { getEnv } from '@/server/env';
import { ok } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { CATALOG_RATE_LIMIT } from './rate-limit';
import { listModelDTOs } from './dto';

/**
 * The model catalog with availability (is the provider's key configured?) and pricing. Anyone
 * may read it; nothing in it depends on the caller, so a short private cache is safe and keeps
 * the studio from refetching on every navigation.
 */
export const GET = route({ auth: 'optional', rateLimit: CATALOG_RATE_LIMIT }, async () => {
  const env = getEnv();
  // In development the answer changes when a provider key is added: do not let a reload show the old one.
  const cacheControl = env.NODE_ENV === 'development' ? 'private, no-cache' : 'private, max-age=30';
  return ok(listModelDTOs(env), { headers: { 'Cache-Control': cacheControl } });
});
