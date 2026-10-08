'use client';

import { ArrowRight } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { GenerationCard, Masonry } from '@/components/generations';
import { estimateCardHeight } from '@/lib/generations/media';
import { usePrefersReducedMotion } from '@/lib/generations/use-media-query';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { ErrorState } from '../ui/error-state';
import { Directional } from '../ui/icon';
import { Skeleton } from '../ui/skeleton';
import { EmptyCanvas } from './empty-canvas';
import type { StudioController } from './use-studio';

export interface CanvasProps {
  studio: StudioController;
  className?: string;
}

function CanvasSkeleton() {
  const { t } = useI18n();
  return (
    <div role="status" aria-busy="true" className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      <span className="sr-only">{t('studio.canvas.loading')}</span>
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-border bg-surface">
          <Skeleton className="aspect-square rounded-none" />
          <div className="grid gap-2 p-3">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The results: newest first, with the states of loading, nothing yet, failure and "load more". */
export function Canvas({ studio, className }: CanvasProps) {
  const { t } = useI18n();
  const { state, reload, loadMore } = studio.feed;
  const reducedMotion = usePrefersReducedMotion();
  const cards = useRef(new Map<string, HTMLElement>());
  const { focusRequest, focusHandled } = studio;

  // A card that was just created comes into view, and keyboard users land on it.
  useEffect(() => {
    if (!focusRequest) return;
    const card = cards.current.get(focusRequest.key);
    if (!card) return;
    if (focusRequest.focus) card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    focusHandled();
  }, [focusRequest, focusHandled, reducedMotion, state.items]);

  return (
    <div className={cn('grid grid-cols-1 gap-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t('studio.canvas.title')}</h2>
        <Button
          href="/gallery"
          variant="ghost"
          size="sm"
          endIcon={
            <Directional>
              <ArrowRight className="size-4" />
            </Directional>
          }
        >
          {t('studio.canvas.gallery')}
        </Button>
      </div>

      {state.status === 'loading' && state.items.length === 0 ? <CanvasSkeleton /> : null}

      {state.status === 'error' && state.items.length === 0 ? (
        <ErrorState
          title={t('studio.canvas.loadFailed')}
          error={state.error}
          onRetry={reload}
          headingLevel={3}
        />
      ) : null}

      {state.status === 'ready' && state.items.length === 0 ? (
        <EmptyCanvas examples={studio.promptTools.examples} onPick={studio.applyExample} />
      ) : null}

      {state.items.length > 0 ? (
        <Masonry
          items={state.items}
          getKey={(item) => item.key}
          estimateHeight={(item, width) => estimateCardHeight(item.generation, width)}
          renderItem={(item) => {
            const { label, demo } = studio.modelLabel(item.generation.modelId);
            return (
              <GenerationCard
                ref={(node) => {
                  if (node) cards.current.set(item.key, node);
                  else cards.current.delete(item.key);
                }}
                generation={item.generation}
                modelLabel={label}
                demo={demo}
                pending={item.pending}
                handlers={studio.handlers}
              />
            );
          }}
        />
      ) : null}

      {state.cursor !== null && state.items.length > 0 ? (
        <div className="flex flex-col items-center gap-3 pt-2">
          {state.moreError !== undefined ? (
            <ErrorState
              title={t('studio.canvas.loadFailed')}
              error={state.moreError}
              headingLevel={3}
              className="w-full py-6"
            />
          ) : null}
          <Button variant="secondary" loading={state.loadingMore} onClick={loadMore}>
            {state.loadingMore ? t('studio.canvas.loadingMore') : t('studio.canvas.loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
