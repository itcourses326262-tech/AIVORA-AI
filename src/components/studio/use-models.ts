'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ModelDTO } from '@/lib/api-types';
import { fetchModels } from '@/lib/generations/api';

export type ModelsState =
  | { status: 'loading' }
  | { status: 'ready'; models: ModelDTO[] }
  | { status: 'error'; error: unknown };

/** The model catalog with availability (`GET /api/v1/models`), loaded once; `reload` tries again. */
export function useModels(): ModelsState & { reload: () => void } {
  const [state, setState] = useState<ModelsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
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

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  return { ...state, reload };
}
