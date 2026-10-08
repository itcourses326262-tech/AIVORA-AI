import type { RateLimitOptions } from '@/server/http/route';

/**
 * Shared by `GET /models` and `GET /tools`: cheap in-memory reads that the studio fetches on
 * every page load, so the budget is generous, but kept apart from the general bucket so they can
 * neither be starved by nor starve the rest of the API. Anonymous callers are keyed by IP.
 */
export const CATALOG_RATE_LIMIT: RateLimitOptions = { name: 'catalog', limit: 240, windowSec: 60 };
