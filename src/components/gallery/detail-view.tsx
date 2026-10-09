'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import { GenerationConfirm } from '@/components/generations';
import { ActiveBody, OutcomeBody } from '@/components/generations/card-bodies';
import type { GenerationDTO } from '@/lib/api-types';
import { clipText } from '@/lib/generations/format';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { boundedAspect, generationAspect } from '@/lib/generations/media';
import { useGenerationActions } from '@/lib/generations/use-generation-actions';
import { useGenerationPolling } from '@/lib/generations/use-generation-polling';
import { useI18n } from '@/lib/i18n/client';
import { DetailActions } from './detail-actions';
import { DetailPrompts, DetailSettings } from './detail-info';
import { DetailNav } from './detail-nav';
import { reuseHref } from './links';
import { MediaStage } from './media-stage';
import { forgetInSnapshot } from './nav-snapshot';
import { SharePanel } from './share-panel';
import { useHydrated } from './use-hydrated';
import { useNeighbors } from './use-nav-snapshot';

export interface DetailViewProps {
  /** The creation as the server read it. */
  initial: GenerationDTO;
}

/**
 * One creation of the signed-in user, large: the result (or the progress, or why it failed), its
 * prompt, the sharing switch, the settings and everything that can be done with it. A creation
 * still being made updates in place; leaving after a delete goes back to the list it came from.
 * Mount it with `key={id}`: another creation is another state.
 */
export function DetailView({ initial }: DetailViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const hydrated = useHydrated();
  const [generation, setGeneration] = useState(initial);
  const [index, setIndex] = useState(0);
  const { neighbors, backHref } = useNeighbors(initial.id);

  const leave = useCallback(() => {
    forgetInSnapshot(initial.id);
    router.replace(backHref);
  }, [initial.id, backHref, router]);

  const actions = useGenerationActions({ onChange: setGeneration, onRemove: leave });

  const watched = useMemo(() => [generation], [generation]);
  useGenerationPolling({
    generations: watched,
    onUpdate: (updated) => {
      const fresh = updated.find((candidate) => candidate.id === initial.id);
      if (fresh) setGeneration(fresh);
    },
    onGone: leave,
    notify: false,
  });

  const done = generation.status === 'succeeded' && generation.outputs.length > 0;
  const active = generation.status === 'queued' || generation.status === 'processing';
  const retry: GenerationHandlers['onRetry'] = (failed) => router.push(reuseHref(failed));

  return (
    <div className="mx-auto flex w-full max-w-[90rem] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-8">
      <h1 className="sr-only">{clipText(generation.prompt, 100)}</h1>
      <DetailNav backHref={backHref} neighbors={neighbors} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_28rem] xl:gap-8">
        <section
          aria-labelledby="detail-media"
          className="min-w-0 lg:sticky lg:top-[calc(var(--topbar-height)+1.25rem)]"
        >
          <h2 id="detail-media" className="sr-only">
            {t('gallery.detail.results')}
          </h2>
          {done ? (
            <MediaStage
              outputs={generation.outputs}
              kind={generation.kind}
              prompt={generation.prompt}
              index={index}
              onIndexChange={setIndex}
            />
          ) : (
            <div
              className="mx-auto overflow-hidden rounded-2xl border border-border"
              style={{
                maxWidth: `calc(min(70dvh, 40rem) * ${boundedAspect(generationAspect(generation))})`,
              }}
            >
              {active ? (
                hydrated ? (
                  <ActiveBody
                    generation={generation}
                    pending={false}
                    onCancel={actions.handlers.onCancel}
                  />
                ) : (
                  <div className="min-h-52" />
                )
              ) : (
                <OutcomeBody generation={generation} onRetry={retry} />
              )}
            </div>
          )}
        </section>

        <div className="grid min-w-0 grid-cols-1 gap-6">
          <DetailPrompts generation={generation} />
          <DetailActions
            generation={generation}
            outputIndex={index}
            handlers={{
              onToggleFavorite: actions.handlers.onToggleFavorite,
              onCancel: actions.handlers.onCancel,
              onDelete: actions.handlers.onDelete,
            }}
          />
          {done ? (
            <SharePanel generation={generation} onToggle={actions.handlers.onTogglePublic} />
          ) : null}
          <DetailSettings generation={generation} outputIndex={index} />
        </div>
      </div>

      <GenerationConfirm
        confirmation={actions.confirmation}
        onConfirm={actions.confirm}
        onDismiss={actions.dismiss}
      />
    </div>
  );
}
