import { sql } from 'drizzle-orm';
import type { HealthDTO } from '@/lib/api-types';
import { APP_VERSION } from '@/lib/version';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { json } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { getLogger } from '@/server/logger';

/**
 * Liveness and readiness probe for load balancers and Docker. The body is deliberately not
 * enveloped: `{ status, db, worker, version }`. A database that cannot answer `SELECT 1` is HTTP 503.
 * Probes arrive every few seconds from one address, so the general rate limit is switched off.
 */
export const GET = route({ auth: 'none', rateLimit: false }, async () => {
  let db = true;
  try {
    getDb().get(sql`select 1`);
  } catch (error) {
    db = false;
    getLogger().error('Health check: database is unreachable', { err: error });
  }
  const body: HealthDTO = {
    status: db ? 'ok' : 'error',
    db,
    worker: getEnv().WORKER_MODE,
    version: APP_VERSION,
  };
  return json(body, { status: db ? 200 : 503 });
});
