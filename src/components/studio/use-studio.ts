'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { toast } from '@/components/ui/toast';
import type { GenerationDTO } from '@/lib/api-types';
import type { Tool } from '@/lib/catalog/types';
import { FIELD_PATHS, type FieldPath } from '@/lib/generations/errors';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { requestFromGeneration } from '@/lib/generations/request';
import {
  useGenerationActions,
  type UseGenerationActionsResult,
} from '@/lib/generations/use-generation-actions';
import { useGenerationPolling } from '@/lib/generations/use-generation-polling';
import { useI18n } from '@/lib/i18n/client';
import { loginUrl } from '@/lib/next-path';
import { getTool, toolNeedsImage } from '@/lib/tools';
import { useUser } from '@/lib/user-context';
import {
  buildRequest,
  formProblems,
  pickModel,
  type FormProblem,
  type InputProgress,
} from './form';
import { isEmptyPrefill, type StudioPrefill } from './prefill';
import { FIELD_MESSAGE_KEYS, describeSubmitError } from './submit-errors';
import { PRICING_HREF, isShort } from './generate-bar';
import { useGenerate } from './use-generate';
import { useGenerationFeed, type GenerationFeed } from './use-generation-feed';
import { useImageInput, type ImageInput } from './use-image-input';
import { useModels, type ModelsState } from './use-models';
import { usePromptTools, type PromptTools } from './use-prompt-tools';
import { useStudioForm, type StudioFormController } from './use-studio-form';

export type FieldMessages = Partial<Record<FieldPath, string>>;

export interface StudioController {
  models: ModelsState & { reload: () => void };
  form: StudioFormController;
  image: ImageInput;
  promptTools: PromptTools;
  promptRef: RefObject<HTMLTextAreaElement | null>;
  /** Replaces the prompt (typing, an example, Undo) and forgets the server's complaint about it. */
  setPrompt: (prompt: string) => void;
  /** Why each field cannot be sent, as sentences. */
  messages: FieldMessages;
  balance: number;
  busy: boolean;
  /** Presses Generate. `keyboard` moves focus to the new card afterwards. */
  generate: (options?: { keyboard?: boolean }) => void;
  feed: GenerationFeed;
  handlers: GenerationHandlers;
  confirmation: UseGenerationActionsResult['confirmation'];
  confirm: () => void;
  dismiss: () => void;
  /** The card to move focus to (and scroll to) once it is on screen. */
  focusRequest: { key: string; focus: boolean } | null;
  focusHandled: () => void;
  viewer: { generation: GenerationDTO; index: number } | null;
  setViewerIndex: (index: number) => void;
  closeViewer: () => void;
  /** A sentence for the screen reader's polite live region. */
  announcement: string;
  modelLabel: (modelId: string) => { label: string; demo: boolean };
  /** Puts an example prompt in the box and moves focus there. */
  applyExample: (prompt: string) => void;
}

function problemMessageKey(problem: FormProblem) {
  switch (problem.code) {
    case 'required':
      return problem.field === 'inputAssetId' ? 'studio.image.required' : 'studio.prompt.required';
    case 'uploading':
      return 'studio.image.waiting';
    case 'too_long':
      return 'studio.prompt.tooLong';
    case 'invalid':
      return 'studio.advanced.seed.invalid';
  }
}

/** Everything the studio page does, in one place; the components only draw it. */
export function useStudio(prefill: StudioPrefill): StudioController {
  const { t, locale } = useI18n();
  const router = useRouter();
  const { creditBalance, refresh } = useUser();

  const models = useModels();
  const formCtl = useStudioForm(prefill, models);
  const { form, model, cost, patch, reuse, setTool } = formCtl;
  const image = useImageInput();
  const feed = useGenerationFeed();
  const { submit, busy } = useGenerate(feed);

  const [serverMessages, setServerMessages] = useState<FieldMessages>({});
  const [attempted, setAttempted] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [focusRequest, setFocusRequest] = useState<StudioController['focusRequest']>(null);
  const [viewerState, setViewerState] = useState<{ id: string; index: number } | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const announce = useCallback((text: string) => {
    // A changed string is what makes a live region speak again.
    setAnnouncement((previous) => (previous === text ? `${text}​` : text));
  }, []);

  const clearMessages = useCallback((...fields: FieldPath[]) => {
    setServerMessages((previous) => {
      const next = { ...previous };
      for (const field of fields.length > 0 ? fields : FIELD_PATHS) delete next[field];
      return next;
    });
  }, []);

  const setPrompt = useCallback(
    (prompt: string) => {
      patch({ prompt });
      clearMessages('prompt');
    },
    [patch, clearMessages],
  );
  const kind = getTool(form.tool)?.kind ?? 'image';
  const promptTools = usePromptTools({
    tool: form.tool,
    kind,
    prompt: form.prompt,
    maxChars: model?.limits.maxPromptChars,
    setPrompt,
  });

  // ---- Field messages --------------------------------------------------------------------------
  const inputProgress: InputProgress =
    image.state.status === 'ready'
      ? 'ready'
      : image.state.status === 'uploading' || image.state.status === 'importing'
        ? 'busy'
        : 'none';
  const problems = useMemo(
    () => formProblems(form, model, inputProgress),
    [form, model, inputProgress],
  );
  const messages = useMemo<FieldMessages>(() => {
    const out: FieldMessages = { ...serverMessages };
    for (const problem of problems) {
      if (problem.field === 'modelId') continue;
      // A too-long prompt is flagged while typing; a missing one only after Generate was pressed.
      const immediate = problem.code === 'too_long' || problem.field === 'seed';
      if (!immediate && !attempted) continue;
      const key = problemMessageKey(problem);
      const field = problem.field;
      out[field] ??=
        problem.code === 'too_long'
          ? t(key, { max: problem.max })
          : problem.code === 'invalid'
            ? t(key, { max: 4_294_967_295 })
            : t(key);
    }
    return out;
  }, [problems, serverMessages, attempted, t]);

  // ---- The link from another page --------------------------------------------------------------
  const inputAssetId = prefill.inputAssetId;
  const adoptedFromUrl = useRef<string | undefined>(undefined);
  const { adopt } = image;
  useEffect(() => {
    if (!inputAssetId || adoptedFromUrl.current === inputAssetId) return;
    adoptedFromUrl.current = inputAssetId;
    adopt({ id: inputAssetId });
  }, [inputAssetId, adopt]);
  useEffect(() => {
    if (isEmptyPrefill(prefill)) adoptedFromUrl.current = undefined;
  }, [prefill]);

  // ---- Generate --------------------------------------------------------------------------------
  const failWith = useCallback(
    (error: unknown) => {
      const problem = describeSubmitError(t, locale, error);
      const fields: FieldMessages = {};
      for (const field of problem.fields) {
        fields[field] = field === 'prompt' ? problem.message : t(FIELD_MESSAGE_KEYS[field]);
      }
      if (problem.fields.length > 0) setServerMessages((previous) => ({ ...previous, ...fields }));

      switch (problem.kind) {
        case 'login':
          toast.error(problem.message, { id: 'studio-submit' });
          router.push(
            loginUrl(`${window.location.pathname}${window.location.search}` || '/studio'),
          );
          return;
        case 'credits':
          toast.error(t('studio.submit.failed'), {
            id: 'studio-submit',
            description: problem.message,
            action: {
              label: t('studio.cost.getCredits'),
              onClick: () => router.push(PRICING_HREF),
            },
          });
          void refresh();
          return;
        case 'model_unavailable':
          models.reload();
          break;
        default:
          break;
      }
      toast.error(t('studio.submit.failed'), { id: 'studio-submit', description: problem.message });
      if (problem.fields.includes('prompt')) promptRef.current?.focus();
    },
    [t, locale, router, refresh, models],
  );

  const imageAsset = image.state.status === 'ready' ? image.state : null;
  const generate = useCallback(
    (options: { keyboard?: boolean } = {}) => {
      if (busy || !model || cost === null) return;
      setAttempted(true);
      const blocking = problems.filter((problem) => problem.field !== 'modelId');
      const first = blocking[0];
      if (first) {
        announce(
          t(problemMessageKey(first), {
            max: first.code === 'too_long' ? first.max : 4_294_967_295,
          }),
        );
        if (first.field === 'prompt') promptRef.current?.focus();
        return;
      }
      if (isShort({ cost, balance: creditBalance })) return;
      clearMessages();
      void submit({
        request: buildRequest(form, model, imageAsset?.assetId),
        model,
        cost,
        input: imageAsset
          ? { url: imageAsset.previewUrl, width: imageAsset.width, height: imageAsset.height }
          : undefined,
        recoverInput: image.recover,
      }).then((result) => {
        if (result.ok) {
          setAttempted(false);
          announce(t('studio.submit.started'));
          setFocusRequest({ key: result.key, focus: options.keyboard === true });
        } else {
          failWith(result.error);
        }
      });
    },
    [
      busy,
      model,
      cost,
      problems,
      creditBalance,
      form,
      imageAsset,
      image.recover,
      submit,
      announce,
      t,
      clearMessages,
      failWith,
    ],
  );

  // ---- Cards -----------------------------------------------------------------------------------
  const { update: updateFeed, remove: removeFromFeed } = feed;
  const actions = useGenerationActions({
    onChange: useCallback((generation: GenerationDTO) => updateFeed([generation]), [updateFeed]),
    onRemove: useCallback(
      (generation: GenerationDTO) => removeFromFeed([generation.id]),
      [removeFromFeed],
    ),
  });

  const readyModels = models.status === 'ready' ? models.models : null;
  const allModels = useMemo(() => readyModels ?? [], [readyModels]);
  const modelLabel = useCallback(
    (modelId: string) => {
      const found = allModels.find((candidate) => candidate.id === modelId);
      return {
        label: found?.label ?? modelId,
        demo: found?.badges?.includes('demo') ?? false,
      };
    },
    [allModels],
  );

  const applyExample = useCallback(
    (prompt: string) => {
      setPrompt(prompt);
      promptRef.current?.focus();
    },
    [setPrompt],
  );

  const reuseSettings = useCallback(
    (generation: GenerationDTO) => {
      const wanted = pickModel(allModels, generation.tool, generation.modelId);
      reuse(generation);
      if (generation.input) image.adopt({ id: generation.input.id, asset: generation.input });
      else if (toolNeedsImage(generation.tool)) image.clear();
      setViewerState(null);
      if (wanted && wanted.id !== generation.modelId) toast.warning(t('studio.reuse.modelChanged'));
      else toast.info(t('studio.reuse.restored'), { id: 'studio-reuse' });
      promptRef.current?.focus();
    },
    [allModels, reuse, image, t],
  );

  const adoptResult = useCallback(
    (generation: GenerationDTO, outputIndex: number) => {
      const asset = generation.outputs[outputIndex];
      if (!asset) return;
      const target: Tool = toolNeedsImage(form.tool)
        ? form.tool
        : getTool(form.tool)?.kind === 'video'
          ? 'image-to-video'
          : 'image-to-image';
      setTool(target);
      image.adopt({ id: asset.id, asset });
      setViewerState(null);
      promptRef.current?.focus();
    },
    [form.tool, setTool, image],
  );

  const retry = useCallback(
    (generation: GenerationDTO) => {
      if (busy) return;
      const retryModel = allModels.find((candidate) => candidate.id === generation.modelId);
      if (!retryModel || !retryModel.available) {
        toast.warning(t('studio.submit.modelUnavailable'));
        return;
      }
      if (isShort({ cost: generation.cost, balance: creditBalance })) {
        toast.error(t('errors.insufficient_credits'), {
          id: 'studio-submit',
          action: { label: t('studio.cost.getCredits'), onClick: () => router.push(PRICING_HREF) },
        });
        return;
      }
      void submit({
        request: requestFromGeneration(generation),
        model: retryModel,
        cost: generation.cost,
        input: generation.input
          ? {
              url: generation.input.url,
              width: generation.input.width,
              height: generation.input.height,
            }
          : undefined,
      }).then((result) => {
        if (result.ok) {
          announce(t('studio.submit.started'));
          setFocusRequest({ key: result.key, focus: false });
        } else {
          failWith(result.error);
        }
      });
    },
    [busy, allModels, creditBalance, router, submit, announce, t, failWith],
  );

  const handlers = useMemo<GenerationHandlers>(
    () => ({
      ...actions.handlers,
      onOpen: (generation, index) => setViewerState({ id: generation.id, index }),
      onReuse: reuseSettings,
      onRetry: retry,
      onUseAsInput: adoptResult,
    }),
    [actions.handlers, reuseSettings, retry, adoptResult],
  );

  // ---- Keeping running generations fresh -------------------------------------------------------
  const generations = useMemo(
    () => feed.state.items.filter((item) => !item.pending).map((item) => item.generation),
    [feed.state.items],
  );
  useGenerationPolling({
    generations,
    onUpdate: updateFeed,
    onGone: removeFromFeed,
    onView: useCallback(
      (generation: GenerationDTO) => setViewerState({ id: generation.id, index: 0 }),
      [],
    ),
  });

  const viewer = useMemo(() => {
    if (!viewerState) return null;
    const found = generations.find((generation) => generation.id === viewerState.id);
    return found && found.outputs.length > 0
      ? { generation: found, index: viewerState.index }
      : null;
  }, [viewerState, generations]);

  return {
    models,
    form: formCtl,
    image,
    promptTools,
    promptRef,
    setPrompt,
    messages,
    balance: creditBalance,
    busy,
    generate,
    feed,
    handlers,
    confirmation: actions.confirmation,
    confirm: actions.confirm,
    dismiss: actions.dismiss,
    focusRequest,
    focusHandled: useCallback(() => setFocusRequest(null), []),
    viewer,
    setViewerIndex: useCallback(
      (index: number) => setViewerState((current) => (current ? { ...current, index } : current)),
      [],
    ),
    closeViewer: useCallback(() => setViewerState(null), []),
    announcement,
    modelLabel,
    applyExample,
  };
}
