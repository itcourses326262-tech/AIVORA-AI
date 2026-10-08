import 'server-only';
import { and, eq } from 'drizzle-orm';
import type {
  CreateGenerationRequest,
  GenerationDTO,
  Kind,
  ListGenerationsQuery,
  Page,
  UpdateGenerationRequest,
} from '@/lib/api-types';
import { AppError } from '@/lib/errors';
import { isValidId, newId } from '@/lib/id';
import { debitCredits } from '@/server/credits';
import { getDb, withTx, type Db } from '@/server/db';
import { assets, creditLedger, generations, type GenerationRow } from '@/server/db/schema';
import { validateGenerationRequest } from '@/lib/validation/generation';
import { getEnv, type Env } from '@/server/env';
import { wakeWorkers } from '@/server/jobs/wake';
import { getLogger } from '@/server/logger';
import { moderatePrompt } from '@/server/moderation';
import { isProviderAvailable } from '@/server/providers/registry';
import { deleteAssetObjects } from '@/server/uploads';
import {
  MAX_IDEMPOTENCY_KEY_CHARS,
  assertSameRequest,
  findByIdempotencyKey,
  isUniqueViolation,
  isValidIdempotencyKey,
  type RequestFingerprint,
} from './idempotency';
import { findPublicRow, selectOwnedRows, selectPublicRows } from './list';
import { markCanceled } from './lifecycle';
import {
  countActiveGenerations,
  findGenerationRow,
  findOwnedGenerationRow,
  hydrateGenerations,
} from './queries';

export interface CreateGenerationOptions {
  /** From the `Idempotency-Key` header: a replay returns the original generation. */
  idempotencyKey?: string;
}

export interface CreateGenerationResult {
  generation: GenerationDTO;
  /** False when the idempotency key matched an existing generation. */
  created: boolean;
}

export interface ListPublicGenerationsQuery {
  kind?: Kind;
  limit?: number;
  cursor?: string;
}

const notFound = () => AppError.of('not_found', 'Generation not found');

/**
 * A cancel refunds in full (section 8), including after the provider already accepted the job and
 * may bill us for it. That is the documented policy, so this does not change it; it makes the
 * pattern visible, because an account that creates and cancels in a loop shows up as a high ratio
 * of these lines to `Generation succeeded` ones. No prompt, only ids.
 */
function noteCancelAfterSubmit(row: GenerationRow): void {
  if (row.status !== 'processing' || row.providerJobId === null) return;
  getLogger().info('Canceled a generation after it was submitted to the provider', {
    component: 'generations',
    generationId: row.id,
    userId: row.userId,
    modelId: row.modelId,
    provider: row.provider,
    cost: row.cost,
  });
}

function ownedRow(db: Db, userId: string, id: string): GenerationRow {
  const row = isValidId(id, 'gen') ? findOwnedGenerationRow(db, userId, id) : undefined;
  if (!row) throw notFound();
  return row;
}

function toDTO(db: Db, row: GenerationRow): GenerationDTO {
  const [dto] = hydrateGenerations(db, [row]);
  if (!dto) throw AppError.of('internal', 'Could not build the generation');
  return dto;
}

/** The uploaded image must exist, be an input image and belong to the caller; no hint which failed. */
function assertOwnedInputImage(db: Db, userId: string, assetId: string): void {
  const asset = db
    .select({ id: assets.id })
    .from(assets)
    .where(
      and(
        eq(assets.id, assetId),
        eq(assets.userId, userId),
        eq(assets.role, 'input'),
        eq(assets.kind, 'image'),
      ),
    )
    .get();
  if (!asset) {
    throw new AppError('not_found', 404, 'Input image not found', { path: 'inputAssetId' });
  }
}

interface QueuedInsert {
  row: GenerationRow;
  created: boolean;
}

/**
 * The one transaction of `createGeneration`. `BEGIN IMMEDIATE` makes the active-generation count,
 * the debit and the insert a single unit, so two simultaneous requests cannot both slip under the
 * limit or both spend the last credits, and a duplicate idempotency key is seen by whoever comes
 * second. Synchronous on purpose: nothing may be awaited while the write lock is held.
 */
function insertQueued(
  db: Db,
  input: {
    id: string;
    userId: string;
    idempotencyKey?: string;
    cost: number;
    maxActive: number;
    values: typeof generations.$inferInsert;
    fingerprint: RequestFingerprint;
  },
): QueuedInsert {
  const { userId, idempotencyKey } = input;
  const replay = (): QueuedInsert | undefined => {
    const existing =
      idempotencyKey === undefined ? undefined : findByIdempotencyKey(db, userId, idempotencyKey);
    if (!existing) return undefined;
    assertSameRequest(existing, input.fingerprint);
    return { row: existing, created: false };
  };

  try {
    return withTx(db, (tx) => {
      const existing =
        idempotencyKey === undefined ? undefined : findByIdempotencyKey(tx, userId, idempotencyKey);
      if (existing) {
        assertSameRequest(existing, input.fingerprint);
        return { row: existing, created: false };
      }
      if (countActiveGenerations(tx, userId) >= input.maxActive) {
        throw AppError.of(
          'too_many_active',
          'Too many generations are running. Wait for one to finish.',
          { limit: input.maxActive },
        );
      }
      debitCredits(tx, { userId, amount: input.cost, generationId: input.id });
      return { row: tx.insert(generations).values(input.values).returning().get(), created: true };
    });
  } catch (error) {
    // The unique (userId, idempotencyKey) index is the backstop if the lookup above ever missed.
    if (idempotencyKey !== undefined && isUniqueViolation(error)) {
      const winner = replay();
      if (winner) return winner;
    }
    throw error;
  }
}

/**
 * Validates the request, moderates the prompt, checks the model is available, that the input asset
 * belongs to the user and the active-generation limit, then in ONE transaction debits the credits
 * and inserts the `queued` generation, and wakes the worker. Errors: `validation_failed`,
 * `moderation_blocked`, `insufficient_credits`, `too_many_active`, `not_found` (input image),
 * `conflict` (model unavailable, or an idempotency key reused with a different request).
 */
export async function createGeneration(
  userId: string,
  request: CreateGenerationRequest,
  options: CreateGenerationOptions = {},
): Promise<CreateGenerationResult> {
  const env = getEnv();
  const db = getDb();
  const { idempotencyKey } = options;
  if (idempotencyKey !== undefined && !isValidIdempotencyKey(idempotencyKey)) {
    throw new AppError('validation_failed', 422, 'Request validation failed', {
      issues: [
        {
          path: 'Idempotency-Key',
          message: `Must be 1 to ${MAX_IDEMPOTENCY_KEY_CHARS} visible ASCII characters`,
        },
      ],
    });
  }

  const checked = validateRequest(request, env);
  const { model, params, prompt, negativePrompt, cost } = checked;
  const fingerprint: RequestFingerprint = {
    tool: request.tool,
    modelId: model.id,
    prompt,
    ...(negativePrompt === undefined ? {} : { negativePrompt }),
    params,
    ...(request.inputAssetId === undefined ? {} : { inputAssetId: request.inputAssetId }),
  };

  // A replay answers with the original even if the user is at their limit or the model went away.
  if (idempotencyKey !== undefined) {
    const existing = findByIdempotencyKey(db, userId, idempotencyKey);
    if (existing) {
      assertSameRequest(existing, fingerprint);
      return { generation: toDTO(db, existing), created: false };
    }
  }

  if (!isProviderAvailable(model.provider, env)) {
    throw AppError.of('conflict', 'This model is not available right now', {
      reason: 'model_unavailable',
      modelId: model.id,
    });
  }
  if (request.inputAssetId !== undefined) assertOwnedInputImage(db, userId, request.inputAssetId);

  // Only the prompt is moderated like a prompt: a negative prompt such as "nsfw, nude" is exactly
  // what users should be able to write. The moderation module still gets it, and whether the request
  // edits an uploaded photo, for the two cases it judges in context: a negative prompt that steers
  // toward nudity by excluding clothing, and nudity or undress words applied to a real photo.
  const verdict = await moderatePrompt(prompt, {
    negativePrompt,
    hasInputImage: request.inputAssetId !== undefined,
  });
  if (!verdict.allowed) {
    throw AppError.of('moderation_blocked', verdict.reason ?? 'This prompt is not allowed', {
      category: verdict.category,
    });
  }

  const now = Date.now();
  const id = newId('gen', now);
  const { row, created } = insertQueued(db, {
    id,
    userId,
    idempotencyKey,
    cost,
    maxActive: env.MAX_ACTIVE_PER_USER,
    fingerprint,
    values: {
      id,
      userId,
      tool: request.tool,
      kind: model.kind,
      modelId: model.id,
      provider: model.provider,
      status: 'queued',
      prompt,
      negativePrompt: negativePrompt ?? null,
      params,
      inputAssetId: request.inputAssetId ?? null,
      cost,
      idempotencyKey: idempotencyKey ?? null,
      isPublic: request.isPublic ?? false,
      createdAt: now,
      updatedAt: now,
    },
  });
  if (created) wakeWorkers();
  return { generation: toDTO(db, row), created };
}

function validateRequest(request: CreateGenerationRequest, env: Env) {
  const result = validateGenerationRequest(request, env);
  if (!result.ok) {
    throw new AppError('validation_failed', 422, 'Request validation failed', {
      issues: result.errors,
    });
  }
  return result;
}

/** `not_found` unless `userId` owns the generation. */
export async function getGeneration(userId: string, id: string): Promise<GenerationDTO> {
  const db = getDb();
  return toDTO(db, ownedRow(db, userId, id));
}

/** The user's own generations, newest first (keyset pagination). `ids` enables batch polling. */
export async function listGenerations(
  userId: string,
  query: ListGenerationsQuery,
): Promise<Page<GenerationDTO>> {
  const db = getDb();
  const { rows, nextCursor } = selectOwnedRows(db, userId, query);
  return { data: hydrateGenerations(db, rows), nextCursor };
}

/** Succeeded public generations from all users with `owner.name`, newest first. */
export async function listPublicGenerations(
  query: ListPublicGenerationsQuery,
): Promise<Page<GenerationDTO>> {
  const db = getDb();
  const { rows, nextCursor } = selectPublicRows(db, query);
  return { data: hydrateGenerations(db, rows, { withOwner: true }), nextCursor };
}

/** Toggles `isPublic` / `isFavorite`; any other field of `patch` is ignored. */
export async function updateGeneration(
  userId: string,
  id: string,
  patch: UpdateGenerationRequest,
): Promise<GenerationDTO> {
  const db = getDb();
  const changes: Partial<Pick<GenerationRow, 'isPublic' | 'isFavorite'>> = {};
  if (typeof patch.isPublic === 'boolean') changes.isPublic = patch.isPublic;
  if (typeof patch.isFavorite === 'boolean') changes.isFavorite = patch.isFavorite;
  if (Object.keys(changes).length === 0) return toDTO(db, ownedRow(db, userId, id));

  const row = isValidId(id, 'gen')
    ? db
        .update(generations)
        .set({ ...changes, updatedAt: Date.now() })
        .where(and(eq(generations.id, id), eq(generations.userId, userId)))
        .returning()
        .get()
    : undefined;
  if (!row) throw notFound();
  return toDTO(db, row);
}

/**
 * Deletes the generation and its output assets, keeping the ledger rows but detaching them from
 * it. A generation that is still queued or processing is canceled and refunded in the same
 * transaction first, so deleting is never a way to keep a refund-less running job. The stored
 * files are removed afterwards, best effort.
 */
export async function deleteGeneration(userId: string, id: string): Promise<void> {
  const db = getDb();
  const { outputs, canceled } = withTx(db, (tx) => {
    const row = findOwnedGenerationRow(tx, userId, id);
    if (!row) throw notFound();
    const wasActive = row.status === 'queued' || row.status === 'processing';
    const canceled = wasActive && markCanceled(tx, userId, id) ? row : undefined;
    const stored = tx.select().from(assets).where(eq(assets.generationId, id)).all();
    tx.update(creditLedger)
      .set({ generationId: null })
      .where(eq(creditLedger.generationId, id))
      .run();
    tx.delete(generations).where(eq(generations.id, id)).run();
    return { outputs: stored, canceled };
  });
  if (canceled) noteCancelAfterSubmit(canceled);
  await deleteAssetObjects(outputs);
}

/**
 * `queued` or `processing` -> `canceled` with a full refund. Canceling twice is fine (the second
 * call just returns the canceled generation); `conflict` once it has succeeded or failed.
 */
export async function cancelGeneration(userId: string, id: string): Promise<GenerationDTO> {
  const db = getDb();
  const { row, canceled } = withTx(db, (tx) => {
    const current = findOwnedGenerationRow(tx, userId, id);
    if (!current) throw notFound();
    if (current.status === 'canceled') return { row: current, canceled: undefined };
    if (!markCanceled(tx, userId, id)) {
      throw AppError.of('conflict', `A ${current.status} generation cannot be canceled`, {
        status: current.status,
      });
    }
    return { row: findGenerationRow(tx, id) ?? current, canceled: current };
  });
  if (canceled) noteCancelAfterSubmit(canceled);
  return toDTO(db, row);
}

/** A succeeded generation with `isPublic`, for `/s/[id]`; null for anything else. */
export function getPublicGeneration(id: string): GenerationDTO | null {
  if (!isValidId(id, 'gen')) return null;
  const db = getDb();
  const row = findPublicRow(db, id);
  if (!row) return null;
  const [dto] = hydrateGenerations(db, [row], { withOwner: true });
  return dto ?? null;
}
