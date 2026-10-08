import 'server-only';
import type { ProviderId } from '@/lib/catalog/types';

/**
 * The one provider whose requests cost nothing upstream: the Demo provider. It is what lets the
 * engine submit its jobs again after a crash and keeps it out of the daily upstream budget. SQL
 * that needs "paid" compares `generations.provider` with this constant.
 */
export const FREE_PROVIDER = 'mock' satisfies ProviderId;

/** Whether a request to this provider costs real money upstream. */
export function isPaidProvider(provider: ProviderId): boolean {
  return provider !== FREE_PROVIDER;
}
