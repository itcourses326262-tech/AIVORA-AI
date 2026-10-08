import { addressRoute } from '@/server/auth/address-route';
import { buildCatalog } from '@/server/billing/catalog';
import { ok } from '@/server/http/respond';
import { PLANS_LIMITS } from '../limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The price list (packs, plans, VAT, whether buying is possible). Public: the same answer for
 * everybody, so a browser or CDN may keep it for a few minutes. Prices are server configuration;
 * this is the only place the UI learns them.
 */
export const GET = addressRoute({ auth: 'none' }, PLANS_LIMITS, async () =>
  ok(buildCatalog(), {
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
  }),
);
