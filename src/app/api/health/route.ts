import { sql } from 'drizzle-orm';
import type { HealthDTO } from '@/lib/api-types';
import { APP_VERSION } from '@/lib/version';
import { getDb } from '@/server/db';
import { getEnv } from '@/server/env';
import { json } from '@/server/http/respond';
import { route } from '@/server/http/route';
import { getLogger } from '@/server/logger';
import { storageProblem } from '@/server/storage';

/**
 * Liveness and readiness probe for load balancers and Docker. The body is deliberately not
 * enveloped: `{ status, db, worker, version }`. A database that cannot answer `SELECT 1` is HTTP 503,
 * and so is storage that cannot be created (a service-account file that went missing), in which case
 * the body also says `storage: false`; the reason is in the log. Creating the driver is memoized and
 * touches no network, so probing it every few seconds costs nothing.
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
  const worker = getEnv().WORKER_MODE;
  const problem = storageProblem();
  if (problem) getLogger().error(`Health check: ${problem}`);
  const body: HealthDTO = {
    status: db && !problem ? 'ok' : 'error',
    db,
    worker,
    version: APP_VERSION,
    ...(problem ? { storage: false as const } : {}),
  };
  return json(body, { status: body.status === 'ok' ? 200 : 503 });
});
