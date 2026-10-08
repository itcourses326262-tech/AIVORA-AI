// OWNER: providers-mock — real. Extend additively only.
import 'server-only';
import type { ProviderId } from '@/lib/catalog/types';
import { PROVIDER_IDS } from '@/lib/catalog/types';
import type { Env } from '@/server/env';
import { falProvider } from './fal';
import { mockProvider } from './mock';
import { openaiProvider } from './openai';
import { replicateProvider } from './replicate';
import type { GenerationProvider } from './types';

const BUILT_IN: Record<ProviderId, GenerationProvider> = {
  mock: mockProvider,
  openai: openaiProvider,
  fal: falProvider,
  replicate: replicateProvider,
};

let overrides: Partial<Record<ProviderId, GenerationProvider>> = {};

/**
 * Tests inject fakes here. Passing `null` (or `{}`) restores the built-in providers; ids that are
 * not mentioned keep their built-in implementation.
 */
export function setProviderOverrides(
  replacements: Partial<Record<ProviderId, GenerationProvider>> | null,
): void {
  overrides = { ...replacements };
}

/** The adapter for `id`. Cheap: adapters are plain objects resolved on every call. */
export function getProvider(id: ProviderId): GenerationProvider {
  return overrides[id] ?? BUILT_IN[id];
}

export function listProviders(): GenerationProvider[] {
  return PROVIDER_IDS.map(getProvider);
}

/** Whether models of provider `id` may be offered and run (its credentials are present). */
export function isProviderAvailable(id: ProviderId, env: Env): boolean {
  return getProvider(id).isConfigured(env);
}
