'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelDTO } from '@/lib/api-types';
import { fetchModels } from '@/lib/generations/api';

export type ModelsState =
  | { status: 'loading' }
  | { status: 'ready'; models: ModelDTO[] }
  | { status: 'error'; error: unknown };

/** Coming back to the tab asks again at most this often. */
const REFRESH_MIN_GAP_MS = 5_000;

/** What the picker shows: which models exist and which can run. */
function availabilityKey(models: readonly ModelDTO[]): string {
  return models.map((model) => `${model.id}:${model.available ? 1 : 0}`).join('|');
}

/**
 * The model catalog with availability (`GET /api/v1/models`); `reload` tries again from scratch.
 * Once loaded it is also checked again, quietly, whenever the tab becomes visible: a provider key
 * added while the page was open (`npm run setup:fal`) turns its models on without a manual reload.
 * The list is only replaced when availability actually changed, so nothing flickers.
 */
export function useModels(): ModelsState & { reload: () => void } {
  const [state, setState] = useState<ModelsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const lastCheck = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    lastCheck.current = Date.now();
    fetchModels(controller.signal).then(
      (models) => {
        if (!controller.signal.aborted) setState({ status: 'ready', models });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', error });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastCheck.current < REFRESH_MIN_GAP_MS) return;
      lastCheck.current = now;
      controller?.abort();
      const own = new AbortController();
      controller = own;
      fetchModels(own.signal, { fresh: true }).then(
        (models) => {
          if (own.signal.aborted) return;
          setState((current) =>
            current.status === 'ready' &&
            availabilityKey(current.models) === availabilityKey(models)
              ? current
              : { status: 'ready', models },
          );
        },
        () => undefined, // a failed quiet check keeps the list that is already shown
      );
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      controller?.abort();
    };
  }, [ready]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { ...state, reload };
}
