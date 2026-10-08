import 'server-only';
import type { ProviderId } from '@/lib/catalog/types';

/**
 * Whether a request to this provider costs real money upstream. Only the Demo provider is free,
 * which is what lets the engine submit its jobs again after a crash and keeps it out of the
 * daily upstream budget.
 */
export function isPaidProvider(provider: ProviderId): boolean {
  return provider !== 'mock';
}
