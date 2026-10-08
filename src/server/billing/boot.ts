import 'server-only';
import { getEnv } from '@/server/env';
import type { Logger } from '@/server/logger';
import { getBillingMode } from './config';
import { startBillingScheduler } from './scheduler';

/**
 * Starts billing's background work (renewal links, reconciliation of unpaid checkouts) in this
 * process, from `instrumentation.ts`. Returns whether it was started: not with `WORKER_MODE=off`
 * (tests, tools that must not do background work) and not while billing is switched off. Starting
 * it in several processes is fine (`scheduler.ts` claims every unit of work).
 */
export function bootBillingScheduler(log: Logger): boolean {
  const env = getEnv();
  if (env.WORKER_MODE === 'off') return false;
  const gateway = getBillingMode(env);
  if (gateway === 'off') return false;
  startBillingScheduler();
  log.info('Billing scheduler started', { gateway });
  return true;
}
