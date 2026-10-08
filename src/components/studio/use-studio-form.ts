'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type { GenerationDTO, ModelDTO } from '@/lib/api-types';
import type { Tool } from '@/lib/catalog/types';
import {
  DEFAULT_TOOL,
  costOf,
  initialStudioState,
  modelsForTool,
  pickModel,
  settingsOf,
  studioReducer,
  type StudioForm,
} from './form';
import { prefillKey, type StudioPrefill } from './prefill';
import { loadStudioSettings, saveStudioSettings } from './settings-storage';
import type { ModelsState } from './use-models';

function initialState(prefill: StudioPrefill) {
  const stored = loadStudioSettings();
  const tool = prefill.tool ?? stored?.tool ?? DEFAULT_TOOL;
  const state = initialStudioState(tool, stored?.tools ?? {}, prefill.modelId ?? null);
  return prefill.prompt ? { ...state, form: { ...state.form, prompt: prefill.prompt } } : state;
}

/** Keeps `?tool=` and `?model=` in the address bar and drops the one-shot `prompt` and `input`. */
function syncUrl(tool: Tool, modelId: string | null): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('tool', tool);
    if (modelId) url.searchParams.set('model', modelId);
    else url.searchParams.delete('model');
    url.searchParams.delete('prompt');
    url.searchParams.delete('input');
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  } catch {
    // The address bar is a convenience; the studio works without it.
  }
}

export interface StudioFormController {
  form: StudioForm;
  /** The model that will run: chosen, configured and serving the tool. */
  model: ModelDTO | undefined;
  /** Every model of the tool, configured or not. */
  toolModels: ModelDTO[];
  /** Credits the form costs; null with no model or an unpriceable combination. */
  cost: number | null;
  setTool: (tool: Tool) => void;
  setModel: (modelId: string) => void;
  patch: (patch: Partial<Omit<StudioForm, 'tool'>>) => void;
  /** Puts a generation's settings back into the form. */
  reuse: (generation: GenerationDTO) => void;
}

/**
 * The form of the studio: the pure reducer from `./form`, plus what touches the outside world. The
 * models arrive later and reshape the form; the settings of each tool are remembered in
 * `localStorage`; the address bar follows the tool and the model; a changed `prefill` (a link from
 * the gallery while the studio is open) is applied once.
 */
export function useStudioForm(prefill: StudioPrefill, models: ModelsState): StudioFormController {
  const [state, dispatch] = useReducer(studioReducer, prefill, initialState);
  const { form } = state;

  const ready = models.status === 'ready' ? models.models : null;
  useEffect(() => {
    if (ready) dispatch({ type: 'models', models: ready });
  }, [ready]);

  const key = prefillKey(prefill);
  const applied = useRef(key);
  useEffect(() => {
    if (applied.current === key) return;
    applied.current = key;
    if (key !== '') {
      dispatch({
        type: 'prefill',
        tool: prefill.tool,
        modelId: prefill.modelId,
        prompt: prefill.prompt,
      });
    }
  }, [key, prefill]);

  const settingsKey = JSON.stringify(settingsOf(form));
  const { saved } = state;
  useEffect(() => {
    saveStudioSettings(form.tool, settingsOf(form), saved);
    // `form` is represented by `settingsKey`: typing a prompt must not rewrite storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.tool, settingsKey, saved]);

  useEffect(() => {
    if (ready) syncUrl(form.tool, form.modelId);
  }, [ready, form.tool, form.modelId]);

  const model = useMemo(
    () => pickModel(state.models, form.tool, form.modelId),
    [state.models, form.tool, form.modelId],
  );
  const toolModels = useMemo(
    () => modelsForTool(state.models, form.tool),
    [state.models, form.tool],
  );
  const cost = useMemo(() => costOf(form, model), [form, model]);

  return {
    form,
    model,
    toolModels,
    cost,
    setTool: useCallback((tool: Tool) => dispatch({ type: 'tool', tool }), []),
    setModel: useCallback((modelId: string) => dispatch({ type: 'model', modelId }), []),
    patch: useCallback((patch) => dispatch({ type: 'patch', patch }), []),
    reuse: useCallback((generation: GenerationDTO) => dispatch({ type: 'reuse', generation }), []),
  };
}
