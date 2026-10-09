'use client';

import { useCallback, useRef, useState } from 'react';
import { isApiError } from '@/lib/api-client';
import type { GenerationDTO } from '@/lib/api-types';
import { toast } from '@/components/ui/toast';
import { deleteGeneration, updateGeneration } from '@/lib/generations/api';
import { isActive } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { useUser } from '@/lib/user-context';
import { runBulk } from './bulk';
import { countForms } from './plural';
import type { BulkProgress } from './selection-bar';

export interface UseBulkActionsOptions {
  /** The chosen creations, in list order. */
  selected: readonly GenerationDTO[];
  /** Newer copies of creations that changed (a favorite flag). */
  onUpdate: (generations: readonly GenerationDTO[]) => void;
  /** Creations that were deleted. */
  onRemove: (ids: readonly string[]) => void;
  /** After a run: the ids that could not be handled stay chosen, the others are done with. */
  onKeepSelected: (ids: readonly string[]) => void;
}

export interface BulkActions {
  progress: BulkProgress | null;
  /** The delete question is open. */
  confirming: boolean;
  askDelete: () => void;
  dismissDelete: () => void;
  confirmDelete: () => void;
  /** Favorites every finished chosen creation, or removes them from favorites when all are. */
  toggleFavorites: () => void;
}

/** A creation that is already gone has nothing left to delete: it counts as done. */
async function deleteIfPresent(id: string): Promise<void> {
  try {
    await deleteGeneration(id);
  } catch (error) {
    if (isApiError(error) && error.code === 'not_found') return;
    throw error;
  }
}

/** The bulk actions of multi-select mode: delete (after a question) and favorite. */
export function useBulkActions({
  selected,
  onUpdate,
  onRemove,
  onKeepSelected,
}: UseBulkActionsOptions): BulkActions {
  const { t, plural } = useI18n();
  const { refresh } = useUser();
  const [progress, setProgress] = useState<BulkProgress | null>(null);
  const [confirming, setConfirming] = useState(false);
  const running = useRef(false);

  const track = useCallback(
    (kind: BulkProgress['kind'], total: number) => ({
      onProgress: (done: number) => setProgress({ kind, done, total, waiting: false }),
      onWaiting: (waiting: boolean) =>
        setProgress((current) => (current ? { ...current, waiting } : current)),
    }),
    [],
  );

  const confirmDelete = useCallback(async () => {
    if (running.current || selected.length === 0) return;
    running.current = true;
    setConfirming(false);
    const targets = selected;
    setProgress({ kind: 'delete', done: 0, total: targets.length, waiting: false });
    try {
      const result = await runBulk(
        targets.map((generation) => generation.id),
        deleteIfPresent,
        track('delete', targets.length),
      );
      onRemove(result.succeeded);
      onKeepSelected(result.failed.map((failure) => failure.id));
      const gone = new Set(result.succeeded);
      // Deleting something still running cancels it and gives the credits back.
      if (targets.some((generation) => gone.has(generation.id) && isActive(generation))) {
        void refresh();
      }
      if (result.failed.length === 0) {
        toast.success(plural(result.succeeded.length, countForms(t, 'gallery.select.deleted')));
      } else {
        toast.error(
          t('gallery.select.deletedSome', {
            done: result.succeeded.length,
            total: targets.length,
          }),
        );
      }
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [selected, onRemove, onKeepSelected, refresh, t, plural, track]);

  const toggleFavorites = useCallback(async () => {
    if (running.current) return;
    const targets = selected.filter((generation) => generation.status === 'succeeded');
    if (targets.length === 0) return;
    const favorite = !targets.every((generation) => generation.isFavorite);
    const changes = targets.filter((generation) => generation.isFavorite !== favorite);
    if (changes.length === 0) return;
    running.current = true;
    setProgress({ kind: 'favorite', done: 0, total: changes.length, waiting: false });
    const updated: GenerationDTO[] = [];
    try {
      const result = await runBulk(
        changes.map((generation) => generation.id),
        async (id) => {
          updated.push(await updateGeneration(id, { isFavorite: favorite }));
        },
        track('favorite', changes.length),
      );
      onUpdate(updated);
      onKeepSelected(result.failed.map((failure) => failure.id));
      if (result.failed.length === 0) {
        toast.success(
          plural(
            result.succeeded.length,
            countForms(t, favorite ? 'gallery.select.favorited' : 'gallery.select.unfavorited'),
          ),
        );
      } else {
        toast.error(
          t('gallery.select.updatedSome', {
            done: result.succeeded.length,
            total: changes.length,
          }),
        );
      }
    } finally {
      running.current = false;
      setProgress(null);
    }
  }, [selected, onUpdate, onKeepSelected, t, plural, track]);

  return {
    progress,
    confirming,
    askDelete: useCallback(() => setConfirming(selected.length > 0), [selected.length]),
    dismissDelete: useCallback(() => setConfirming(false), []),
    confirmDelete: () => void confirmDelete(),
    toggleFavorites: () => void toggleFavorites(),
  };
}
