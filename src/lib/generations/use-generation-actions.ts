'use client';

/**
 * The actions every list of generations shares: favorite, share and copy the link, cancel and
 * delete. It talks to the API, keeps the list in step (`onChange` replaces a generation, `onRemove`
 * drops one), raises the toasts and refreshes the credit balance when credits moved.
 *
 * Favorite and share are optimistic: the change shows at once and is undone if the request fails.
 * Cancel (while running) and delete ask first: the hook exposes `confirmation`, which
 * `<GenerationConfirm>` renders as a dialog.
 */
import { useCallback, useRef, useState } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/components/ui/error-message';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { cancelGeneration, deleteGeneration, updateGeneration } from './api';
import type { GenerationHandlers } from './handlers';
import { isActive, shareHref } from './media';

export interface GenerationConfirmation {
  kind: 'cancel' | 'delete';
  generation: GenerationDTO;
  /** The request is running; the dialog shows a spinner and ignores further clicks. */
  busy: boolean;
}

export interface UseGenerationActionsOptions {
  /** Replace a generation in the list with this newer copy. */
  onChange: (generation: GenerationDTO) => void;
  /** Take a generation out of the list. */
  onRemove: (generation: GenerationDTO) => void;
}

export interface UseGenerationActionsResult {
  handlers: Required<
    Pick<
      GenerationHandlers,
      'onToggleFavorite' | 'onTogglePublic' | 'onCopyLink' | 'onCancel' | 'onDelete'
    >
  >;
  confirmation: GenerationConfirmation | null;
  /** Runs the action the dialog asked about. */
  confirm: () => void;
  /** Closes the dialog without doing anything. */
  dismiss: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function useGenerationActions({
  onChange,
  onRemove,
}: UseGenerationActionsOptions): UseGenerationActionsResult {
  const { t } = useI18n();
  const { refresh } = useUser();
  const [confirmation, setConfirmation] = useState<GenerationConfirmation | null>(null);
  // Ids with a request in flight: a double click must not send two toggles.
  const pending = useRef(new Set<string>());

  const fail = useCallback(
    (error: unknown) => {
      toast.error(t('studio.generations.toast.updateFailed'), {
        description: errorMessage(t, error),
      });
    },
    [t],
  );

  const copyLink = useCallback(
    async (generation: GenerationDTO) => {
      const copied = await copyText(shareHref(window.location.origin, generation.id));
      if (copied) toast.success(t('studio.generations.toast.linkCopied'));
      else toast.warning(t('studio.generations.toast.linkCopyFailed'));
    },
    [t],
  );

  const toggle = useCallback(
    async (generation: GenerationDTO, patch: { isFavorite: boolean } | { isPublic: boolean }) => {
      if (pending.current.has(generation.id)) return;
      pending.current.add(generation.id);
      onChange({ ...generation, ...patch });
      try {
        const saved = await updateGeneration(generation.id, patch);
        onChange(saved);
        if ('isPublic' in patch) {
          if (patch.isPublic) {
            toast.success(t('studio.generations.toast.shared'), {
              id: `share-${generation.id}`,
              action: {
                label: t('studio.generations.actions.copyLink'),
                onClick: () => void copyLink(saved),
              },
            });
          } else {
            toast.info(t('studio.generations.toast.unshared'), { id: `share-${generation.id}` });
          }
        }
      } catch (error) {
        onChange(generation);
        fail(error);
      } finally {
        pending.current.delete(generation.id);
      }
    },
    [onChange, copyLink, fail, t],
  );

  const runCancel = useCallback(
    async (generation: GenerationDTO) => {
      try {
        onChange(await cancelGeneration(generation.id));
        toast.info(t('studio.generations.cancel.done'));
        void refresh();
      } catch (error) {
        fail(error);
      }
    },
    [onChange, refresh, fail, t],
  );

  const runDelete = useCallback(
    async (generation: GenerationDTO) => {
      try {
        await deleteGeneration(generation.id);
        onRemove(generation);
        toast.success(t('studio.generations.toast.deleted'));
        if (isActive(generation)) void refresh();
      } catch (error) {
        fail(error);
      }
    },
    [onRemove, refresh, fail, t],
  );

  const handlers: UseGenerationActionsResult['handlers'] = {
    onToggleFavorite: (generation) =>
      void toggle(generation, { isFavorite: !generation.isFavorite }),
    onTogglePublic: (generation) => void toggle(generation, { isPublic: !generation.isPublic }),
    onCopyLink: (generation) => void copyLink(generation),
    onCancel: (generation) => {
      // A queued job has not started: canceling it costs nothing, so it needs no question.
      if (generation.status === 'queued') void runCancel(generation);
      else setConfirmation({ kind: 'cancel', generation, busy: false });
    },
    onDelete: (generation) => setConfirmation({ kind: 'delete', generation, busy: false }),
  };

  const confirm = useCallback(() => {
    if (!confirmation || confirmation.busy) return;
    setConfirmation({ ...confirmation, busy: true });
    const { kind, generation } = confirmation;
    void (kind === 'cancel' ? runCancel(generation) : runDelete(generation)).finally(() =>
      setConfirmation(null),
    );
  }, [confirmation, runCancel, runDelete]);

  const dismiss = useCallback(() => {
    setConfirmation((current) => (current?.busy ? current : null));
  }, []);

  return { handlers, confirmation, confirm, dismiss };
}
