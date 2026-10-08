import 'server-only';
import { z } from 'zod';
import type { Kind } from '@/lib/catalog/types';
import { ProviderError } from '../errors';
import { hash32, toSeed } from './random';

/** Substrings of the prompt that make the Demo provider misbehave on purpose (case-insensitive). */
export const MOCK_TRIGGERS = {
  /** The job runs for its normal time, then fails with `unavailable` (not retryable). */
  fail: '__fail__',
  /** The job runs for its normal time, then fails with `content_policy`. */
  content: '__content__',
  /** The job takes 25 seconds instead of the usual few. */
  slow: '__slow__',
  /** `submit` returns the outputs immediately (`mode: 'sync'`) instead of a job to poll. */
  sync: '__sync__',
} as const;

export interface Triggers {
  fail: boolean;
  content: boolean;
  slow: boolean;
  sync: boolean;
}

export function parseTriggers(prompt: string): Triggers {
  const text = prompt.toLowerCase();
  return {
    fail: text.includes(MOCK_TRIGGERS.fail),
    content: text.includes(MOCK_TRIGGERS.content),
    slow: text.includes(MOCK_TRIGGERS.slow),
    sync: text.includes(MOCK_TRIGGERS.sync),
  };
}

/** The prompt without the trigger words, so a trigger changes the behaviour but never the artwork. */
export function stripTriggers(prompt: string): string {
  return Object.values(MOCK_TRIGGERS)
    .reduce((text, trigger) => text.replaceAll(new RegExp(trigger, 'gi'), ' '), prompt)
    .replace(/\s+/g, ' ')
    .trim();
}

export const SLOW_LATENCY_MS = 25_000;
/** Simulated latency is `min + (0..spread)`, picked from the seed so a given request always takes as long. */
const LATENCY_MS = {
  image: { min: 2500, spread: 1500 },
  video: { min: 7000, spread: 3000 },
} as const;

export function latencyFor(kind: Kind, seed: number, triggers: Triggers): number {
  if (triggers.slow) return SLOW_LATENCY_MS;
  const { min, spread } = LATENCY_MS[kind];
  return min + (hash32('mock-latency', seed) % (spread + 1));
}

export type Outcome = 'ok' | 'fail' | 'content';

export function outcomeFor(triggers: Triggers): Outcome {
  if (triggers.content) return 'content';
  return triggers.fail ? 'fail' : 'ok';
}

/** The error a failure trigger produces; `message` is for logs, `userMessage` may reach the user. */
export function injectedError(outcome: Exclude<Outcome, 'ok'>): ProviderError {
  if (outcome === 'content') {
    return new ProviderError(
      'content_policy',
      `Demo provider content-policy rejection injected by "${MOCK_TRIGGERS.content}"`,
      { retryable: false },
    );
  }
  return new ProviderError(
    'unavailable',
    `Demo provider failure injected by "${MOCK_TRIGGERS.fail}"`,
    {
      retryable: false,
      userMessage: 'The demo provider simulated a failure because the prompt asked for one.',
    },
  );
}

/**
 * Everything `poll` needs, stored by the engine next to the job id (`providerMeta`). With it a
 * poll works from the clock alone, so a job survives a worker restart.
 */
const jobMetaSchema = z.object({
  v: z.literal(1),
  /** Epoch milliseconds of the submit call. */
  startedAt: z.number().int().nonnegative(),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .max(10 * 60_000),
  seed: z.number().int().min(0).max(0xffff_ffff),
  outcome: z.enum(['ok', 'fail', 'content']),
});
export type MockJobMeta = z.infer<typeof jobMetaSchema>;

export function createJobMeta(
  startedAt: number,
  durationMs: number,
  seed: number,
  outcome: Outcome,
): MockJobMeta {
  return { v: 1, startedAt, durationMs, seed: toSeed(seed), outcome };
}

export function parseJobMeta(meta: unknown): MockJobMeta | undefined {
  const parsed = jobMetaSchema.safeParse(meta);
  return parsed.success ? parsed.data : undefined;
}

/** Percent done while running: linear in elapsed time, never 100 (that is the succeeded result). */
export function progressAt(meta: MockJobMeta, now: number): number {
  if (meta.durationMs <= 0) return 0;
  const elapsed = Math.max(0, now - meta.startedAt);
  return Math.min(99, Math.floor((elapsed / meta.durationMs) * 100));
}

export function isFinished(meta: MockJobMeta, now: number): boolean {
  return now - meta.startedAt >= meta.durationMs;
}
