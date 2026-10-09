'use client';

import { useCallback, useRef, useState } from 'react';
import { isApiError } from '@/lib/api-client';
import type { AssetDTO, CreateGenerationRequest, GenerationDTO, ModelDTO } from '@/lib/api-types';
import { createGeneration } from '@/lib/generations/api';
import { newIdempotencyKey } from '@/lib/generations/request';
import { isRecord } from '@/lib/utils';
import { useUser } from '@/lib/user-context';
import type { GenerationFeed } from './use-generation-feed';
import { outcomeIsUnknown } from './submit-errors';

export interface GenerateInput {
  request: CreateGenerationRequest;
  model: ModelDTO;
  /** Credits it will cost, as shown on the button. */
  cost: number;
  /** Only for the placeholder card (its size follows the picture). */
  input?: Pick<AssetDTO, 'width' | 'height' | 'url'>;
  /** Called when the engine refuses the input asset; resolves to a usable replacement id. */
  recoverInput?: () => Promise<string | null>;
}

export type GenerateResult =
  { ok: true; key: string; generation: GenerationDTO } | { ok: false; error: unknown };

/** The card shown the instant Generate is pressed, until the server answers. */
export function optimisticGeneration(
  id: string,
  request: CreateGenerationRequest,
  model: ModelDTO,
  cost: number,
  input: GenerateInput['input'],
): GenerationDTO {
  const defaults = {
    aspectRatio: model.limits.defaultAspectRatio,
    count: model.limits.defaultCount,
  };
  return {
    id,
    tool: request.tool,
    kind: model.kind,
    modelId: model.id,
    prompt: request.prompt,
    ...(request.negativePrompt ? { negativePrompt: request.negativePrompt } : {}),
    params: { ...defaults, ...request.params },
    status: 'queued',
    progress: 0,
    cost,
    outputs: [],
    ...(input
      ? {
          input: {
            id: request.inputAssetId ?? '',
            kind: 'image' as const,
            mimeType: 'image/webp',
            bytes: 0,
            url: input.url,
            width: input.width,
            height: input.height,
          },
        }
      : {}),
    isPublic: request.isPublic ?? false,
    isFavorite: false,
    createdAt: Date.now(),
  };
}

function refusedInput(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.status === 404 &&
    isRecord(error.details) &&
    error.details.path === 'inputAssetId'
  );
}

/**
 * Sends a request and keeps the canvas honest while it is on its way: the card appears at once, is
 * swapped for the real generation when the server answers, and disappears if it is refused.
 *
 * Idempotency: every click gets its own `Idempotency-Key`. When the outcome is unknown (the
 * connection broke, the server failed) the key is kept, so pressing Generate again with the same
 * request cannot charge twice, and the balance and the history are read again in case the request
 * did go through; any other answer is final and the next click starts afresh.
 */
export function useGenerate({
  add,
  settle,
  drop,
  sync,
}: Pick<GenerationFeed, 'add' | 'settle' | 'drop' | 'sync'>) {
  const { refresh } = useUser();
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  const counter = useRef(0);

  const submit = useCallback(
    async ({
      request,
      model,
      cost,
      input,
      recoverInput,
    }: GenerateInput): Promise<GenerateResult> => {
      counter.current += 1;
      const key = `local-${counter.current}`;
      add({
        key,
        pending: true,
        generation: optimisticGeneration(key, request, model, cost, input),
      });
      setBusy(true);

      let current = request;
      for (let tries = 0; ; tries += 1) {
        const fingerprint = JSON.stringify(current);
        const idempotencyKey =
          attempt.current?.fingerprint === fingerprint ? attempt.current.key : newIdempotencyKey();
        attempt.current = { fingerprint, key: idempotencyKey };
        try {
          const generation = await createGeneration(current, idempotencyKey);
          attempt.current = null;
          settle(key, generation);
          void refresh();
          setBusy(false);
          return { ok: true, key, generation };
        } catch (error) {
          if (tries === 0 && recoverInput && refusedInput(error)) {
            const replacement = await recoverInput();
            if (replacement) {
              current = { ...current, inputAssetId: replacement };
              continue;
            }
          }
          drop(key);
          if (outcomeIsUnknown(error)) {
            // The server may have taken the request and the answer got lost: the balance and the
            // history say what really happened, so the screen does not keep the old picture.
            void refresh();
            sync();
          } else {
            attempt.current = null;
          }
          setBusy(false);
          return { ok: false, error };
        }
      }
    },
    [add, settle, drop, sync, refresh],
  );

  return { submit, busy };
}
