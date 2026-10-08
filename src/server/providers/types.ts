// OWNER: providers-mock — contract types (real). Extend additively only.
import 'server-only';
import type { GenerationParams, Kind, ModelSpec, ProviderId, Tool } from '@/lib/catalog/types';
import type { Env } from '@/server/env';
import type { Logger } from '@/server/logger';
import type { ProviderError } from './errors';

/** Everything an adapter needs for one generation. Adapters never see the database or storage. */
export interface ProviderInput {
  generationId: string;
  tool: Tool;
  model: ModelSpec;
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  /** Present for the `image-to-*` tools; already validated, normalized and decoded by the engine. */
  inputImage?: { bytes: Uint8Array; mimeType: string; width?: number; height?: number };
}

/**
 * One generated file. Adapters return either `bytes` (the engine stores them as is) or a `url`
 * (the engine downloads it through `safeFetch` and stores it).
 */
export interface ProviderOutput {
  kind: Kind;
  url?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  seed?: number;
  thumbUrl?: string;
}

export type SubmitResult =
  | { mode: 'sync'; outputs: ProviderOutput[] }
  | { mode: 'async'; providerJobId: string; meta?: Record<string, unknown> };

export type PollResult =
  | { status: 'pending' | 'running'; progress?: number }
  | { status: 'succeeded'; outputs: ProviderOutput[] }
  | { status: 'failed'; error: ProviderError };

export interface ProviderContext {
  /** Aborted on cancel or timeout; every `fetch` an adapter makes must pass it. */
  signal: AbortSignal;
  env: Env;
  /** Injected so adapter tests can stub the network. */
  fetch: typeof fetch;
  log: Logger;
}

export interface GenerationProvider {
  id: ProviderId;
  /** Whether the credentials this provider needs are present. Never touches the network. */
  isConfigured(env: Env): boolean;
  submit(input: ProviderInput, ctx: ProviderContext): Promise<SubmitResult>;
  poll(
    providerJobId: string,
    input: ProviderInput,
    ctx: ProviderContext,
    meta?: Record<string, unknown>,
  ): Promise<PollResult>;
  cancel?(
    providerJobId: string,
    ctx: ProviderContext,
    meta?: Record<string, unknown>,
  ): Promise<void>;
}
