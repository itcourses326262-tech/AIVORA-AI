// OWNER: engine — replace this stub
import 'server-only';
import type {
  CreateGenerationRequest,
  GenerationDTO,
  Kind,
  ListGenerationsQuery,
  Page,
  UpdateGenerationRequest,
} from '@/lib/api-types';
import { NotImplementedError } from '@/lib/errors';

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

/**
 * Validates the request, moderates the prompt, checks the model is available, that the input asset
 * belongs to the user and the active-generation limit, then in ONE transaction debits the credits
 * and inserts the `queued` generation, and wakes the worker. Errors: `validation_failed`,
 * `moderation_blocked`, `insufficient_credits`, `too_many_active`, `not_found`, `bad_request`.
 */
export async function createGeneration(
  _userId: string,
  _request: CreateGenerationRequest,
  _options?: CreateGenerationOptions,
): Promise<CreateGenerationResult> {
  throw new NotImplementedError('generations.createGeneration');
}

/** `not_found` unless `userId` owns the generation. */
export async function getGeneration(_userId: string, _id: string): Promise<GenerationDTO> {
  throw new NotImplementedError('generations.getGeneration');
}

/** The user's own generations, newest first (keyset pagination). `ids` enables batch polling. */
export async function listGenerations(
  _userId: string,
  _query: ListGenerationsQuery,
): Promise<Page<GenerationDTO>> {
  throw new NotImplementedError('generations.listGenerations');
}

/** Succeeded public generations from all users with `owner.name`, newest first. */
export async function listPublicGenerations(
  _query: ListPublicGenerationsQuery,
): Promise<Page<GenerationDTO>> {
  throw new NotImplementedError('generations.listPublicGenerations');
}

/** Toggles `isPublic` / `isFavorite`. `not_found` unless `userId` owns the generation. */
export async function updateGeneration(
  _userId: string,
  _id: string,
  _patch: UpdateGenerationRequest,
): Promise<GenerationDTO> {
  throw new NotImplementedError('generations.updateGeneration');
}

/** Deletes the generation, its asset rows and (best effort) their stored files. Ledger rows stay. */
export async function deleteGeneration(_userId: string, _id: string): Promise<void> {
  throw new NotImplementedError('generations.deleteGeneration');
}

/** `queued` or `processing` -> `canceled` with a refund; `conflict` when already terminal. */
export async function cancelGeneration(_userId: string, _id: string): Promise<GenerationDTO> {
  throw new NotImplementedError('generations.cancelGeneration');
}

/** A succeeded generation with `isPublic`, for `/s/[id]`; null for anything else. */
export function getPublicGeneration(_id: string): GenerationDTO | null {
  throw new NotImplementedError('generations.getPublicGeneration');
}
