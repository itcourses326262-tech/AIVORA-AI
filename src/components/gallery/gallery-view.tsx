'use client';

import { ListChecks, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GenerationConfirm, Masonry } from '@/components/generations';
import type { GenerationDTO } from '@/lib/api-types';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { estimateCardHeight, isActive } from '@/lib/generations/media';
import { useGenerationActions } from '@/lib/generations/use-generation-actions';
import { useGenerationPolling } from '@/lib/generations/use-generation-polling';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/error-state';
import { BulkDeleteDialog } from './bulk-delete-dialog';
import { galleryHref, isFiltered, type GalleryFilters } from './filters';
import { detailHref, inputHref, reuseHref } from './links';
import { LoadMore } from './load-more';
import { consumeRestore, readNavSnapshot, saveNavSnapshot } from './nav-snapshot';
import { INITIAL_SELECTION, selectionReducer } from './selection';
import { SelectionBar } from './selection-bar';
import { GallerySkeleton, NoCreations, NoResults } from './states';
import { Tile } from './tile';
import { Toolbar } from './toolbar';
import { useBulkActions } from './use-bulk-actions';
import { useGalleryFilters } from './use-gallery-filters';
import { useGalleryList } from './use-gallery-list';

export interface GalleryViewProps {
  /** The filters the address asked for. */
  initialFilters: GalleryFilters;
}

/** Where to scroll to, and how much to load, when the person comes back from a detail page. */
function readRestore(filters: GalleryFilters): { count: number; scrollY: number } | null {
  const snapshot = readNavSnapshot();
  if (!snapshot?.restore || snapshot.from !== galleryHref(filters)) return null;
  return { count: snapshot.ids.length, scrollY: snapshot.scrollY };
}

/**
 * The gallery: every creation of the signed-in user, newest first, in a masonry grid that keeps
 * loading as the page is scrolled. Filters and search reload it from the first page; creations still
 * being made update in place; multi-select mode favorites or deletes many at once.
 */
export function GalleryView({ initialFilters }: GalleryViewProps) {
  const { t, plural } = useI18n();
  const router = useRouter();
  const filters = useGalleryFilters(initialFilters);
  const { applied } = filters;
  const [restore] = useState(() => readRestore(initialFilters));
  const list = useGalleryList(applied, restore?.count);
  const { state } = list;
  const [selection, dispatchSelection] = useReducer(selectionReducer, INITIAL_SELECTION);

  const items = state.items;
  const order = useMemo(() => items.map((item) => item.id), [items]);
  const selected = useMemo(
    () => items.filter((item) => selection.ids.has(item.id)),
    [items, selection.ids],
  );

  // Coming back from a detail page: scroll to where the person was, once.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || state.status !== 'ready') return;
    restored.current = true;
    if (!restore) return;
    consumeRestore();
    requestAnimationFrame(() => window.scrollTo({ top: restore.scrollY, behavior: 'instant' }));
  }, [state.status, restore]);

  // The detail page offers previous / next inside this very list and scrolls back here afterwards.
  const remember = useCallback(() => {
    saveNavSnapshot({
      from: galleryHref(applied),
      ids: order,
      scrollY: window.scrollY,
      restore: true,
    });
  }, [applied, order]);

  const open = useCallback(
    (generation: GenerationDTO) => {
      remember();
      router.push(detailHref(generation.id));
    },
    [remember, router],
  );

  const { update, remove } = list;
  const onChange = useCallback((generation: GenerationDTO) => update([generation]), [update]);
  const onRemove = useCallback((generation: GenerationDTO) => remove([generation.id]), [remove]);
  const actions = useGenerationActions({ onChange, onRemove });

  useGenerationPolling({
    generations: items,
    onUpdate: update,
    onGone: remove,
    onView: open,
  });

  const bulk = useBulkActions({
    selected,
    onUpdate: update,
    onRemove: remove,
    onKeepSelected: (ids) => dispatchSelection({ type: 'keep', ids }),
  });

  const handlers: GenerationHandlers = {
    ...actions.handlers,
    onOpen: open,
    onReuse: (generation) => router.push(reuseHref(generation)),
    onRetry: (generation) => router.push(reuseHref(generation)),
    onUseAsInput: (generation, index) => {
      const asset = generation.outputs[index];
      if (asset) router.push(inputHref('image-to-image', asset.id));
    },
  };

  const select = useCallback(
    (id: string, range: boolean) =>
      dispatchSelection(range ? { type: 'range', id, order } : { type: 'toggle', id }),
    [order],
  );

  // Escape leaves multi-select mode, unless a dialog is open and has the key for itself.
  const choosing = selection.active;
  useEffect(() => {
    if (!choosing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      dispatchSelection({ type: 'exit' });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [choosing]);

  const favoritable = selected.filter((generation) => generation.status === 'succeeded');
  const loading = state.status === 'loading';
  const filtered = isFiltered(applied);

  return (
    <div className="mx-auto flex w-full max-w-[110rem] flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('gallery.title')}
          </h1>
          <p className="mt-1 text-sm text-muted">{t('gallery.list.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={choosing ? 'secondary' : 'outline'}
            aria-pressed={choosing}
            disabled={items.length === 0}
            startIcon={<ListChecks />}
            onClick={() => dispatchSelection({ type: choosing ? 'exit' : 'enter' })}
          >
            {t('gallery.select.mode')}
          </Button>
          <Button href="/studio" startIcon={<Plus />}>
            {t('gallery.list.new')}
          </Button>
        </div>
      </header>

      <Toolbar controls={filters} />

      {choosing ? (
        <SelectionBar
          className="sticky top-[calc(var(--topbar-height)+0.75rem)] z-20"
          count={selected.length}
          loaded={items.length}
          favoritable={favoritable.length}
          allFavorites={favoritable.length > 0 && favoritable.every((item) => item.isFavorite)}
          progress={bulk.progress}
          onSelectAll={() => dispatchSelection({ type: 'select-all', ids: order })}
          onClear={() => dispatchSelection({ type: 'clear' })}
          onFavorite={bulk.toggleFavorites}
          onDelete={bulk.askDelete}
          onExit={() => dispatchSelection({ type: 'exit' })}
        />
      ) : null}

      <section aria-label={t('gallery.list.results')} aria-busy={loading} className="grid gap-4">
        {state.status === 'ready' && items.length > 0 ? (
          <p role="status" className="text-sm text-muted tabular-nums">
            {plural(items.length, {
              zero: t('gallery.list.shown.zero'),
              one: t('gallery.list.shown.one'),
              two: t('gallery.list.shown.two'),
              few: t('gallery.list.shown.few'),
              many: t('gallery.list.shown.many'),
              other: t('gallery.list.shown.other'),
            })}
          </p>
        ) : null}

        {loading && items.length === 0 ? <GallerySkeleton /> : null}

        {state.status === 'error' ? (
          <ErrorState
            title={t('gallery.list.loadFailed')}
            error={state.error}
            onRetry={list.reload}
            headingLevel={2}
          />
        ) : null}

        {state.status === 'ready' && items.length === 0 ? (
          filtered ? (
            <NoResults onClear={filters.clearAll} />
          ) : (
            <NoCreations />
          )
        ) : null}

        {items.length > 0 ? (
          <div
            className={cn('transition-opacity duration-150', loading && 'opacity-60')}
            onClickCapture={(event) => {
              // A link inside a card (its prompt) leaves the page too.
              if ((event.target as Element).closest('a[href^="/gallery/"]')) remember();
            }}
          >
            <Masonry
              items={items}
              getKey={(item) => item.id}
              estimateHeight={estimateCardHeight}
              minColumnWidth={260}
              maxColumns={5}
              renderItem={(generation) => (
                <Tile
                  generation={generation}
                  handlers={handlers}
                  selecting={choosing}
                  selected={selection.ids.has(generation.id)}
                  onSelect={select}
                />
              )}
            />
          </div>
        ) : null}

        <LoadMore
          hasMore={state.cursor !== null && items.length > 0}
          loading={state.loadingMore}
          error={state.moreError}
          onLoadMore={list.loadMore}
        />
      </section>

      <GenerationConfirm
        confirmation={actions.confirmation}
        onConfirm={actions.confirm}
        onDismiss={actions.dismiss}
      />
      <BulkDeleteDialog
        open={bulk.confirming}
        count={selected.length}
        includesRunning={selected.some(isActive)}
        onConfirm={bulk.confirmDelete}
        onDismiss={bulk.dismissDelete}
      />
    </div>
  );
}
