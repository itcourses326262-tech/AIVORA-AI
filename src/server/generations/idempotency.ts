import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { GenerationParams, Tool } from '@/lib/catalog/types';
import { AppError } from '@/lib/errors';
import type { DbOrTx } from '@/server/db';
import { generations, type GenerationRow } from '@/server/db/schema';

export const MAX_IDEMPOTENCY_KEY_CHARS = 128;

/** Visible ASCII only: keys travel in a header and are compared byte for byte. */
const KEY_PATTERN = /^[\x21-\x7e]+$/;

export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 1 && key.length <= MAX_IDEMPOTENCY_KEY_CHARS && KEY_PATTERN.test(key);
}

export function findByIdempotencyKey(
  db: DbOrTx,
  userId: string,
  key: string,
): GenerationRow | undefined {
  return db
    .select()
    .from(generations)
    .where(and(eq(generations.userId, userId), eq(generations.idempotencyKey, key)))
    .get();
}

/** What identifies a request: everything the user chose that decides what is generated. */
export interface RequestFingerprint {
  tool: Tool;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  params: GenerationParams;
  inputAssetId?: string;
}

function canonical(params: GenerationParams): string {
  return JSON.stringify(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * A key may only be replayed with the request that first used it. Anything else is a client bug
 * (one key reused for two different generations) and returning the first generation would hide it.
 */
export function assertSameRequest(existing: GenerationRow, request: RequestFingerprint): void {
  const same =
    existing.tool === request.tool &&
    existing.modelId === request.modelId &&
    existing.prompt === request.prompt &&
    (existing.negativePrompt ?? undefined) === request.negativePrompt &&
    // The upload may have been deleted since (the column is then null); that is still the same request.
    (existing.inputAssetId === null || existing.inputAssetId === request.inputAssetId) &&
    canonical(existing.params) === canonical(request.params);
  if (!same) {
    throw AppError.of(
      'conflict',
      'This Idempotency-Key was already used with a different request',
      { reason: 'idempotency_key_reused' },
    );
  }
}

/** True for a violated UNIQUE constraint, whether better-sqlite3 or drizzle's wrapper is thrown. */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string' && code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) return true;
    current = cause;
  }
  return false;
}
