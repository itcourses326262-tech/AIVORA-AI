'use client';

/**
 * The three faces of a generation card's media area: the placeholder of work in progress, the
 * results, and the explanation of a failure or a cancellation. Internal to `GenerationCard`.
 */
import { Ban, Clock, Expand, Globe, Play, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { formatElapsed, isolateLtr } from '@/lib/generations/format';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import {
  assetAspect,
  boundedAspect,
  generationAspect,
  presentationOf,
  promptLabel,
} from '@/lib/generations/media';
import { failureReason } from '@/lib/generations/errors';
import { useNow } from '@/lib/generations/use-now';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber, formatSeconds } from '@/lib/utils';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { SpinnerIcon } from '../ui/spinner-icon';
import { MediaPreview } from './media-preview';

const GLOW =
  '[background-image:radial-gradient(70%_60%_at_50%_38%,color-mix(in_oklab,var(--brand-from)_24%,transparent),transparent_75%),radial-gradient(50%_45%_at_85%_90%,color-mix(in_oklab,var(--brand-to)_16%,transparent),transparent_75%)]';

/** Work in progress: a glowing placeholder in the shape of the result, with progress and Cancel. */
export function ActiveBody({
  generation,
  pending,
  onCancel,
}: {
  generation: GenerationDTO;
  pending: boolean;
  onCancel?: GenerationHandlers['onCancel'];
}) {
  const { t, locale } = useI18n();
  const now = useNow(true);
  const queued = generation.status === 'queued';
  const percent = Math.max(0, Math.min(100, Math.round(generation.progress)));
  const status = queued
    ? t('studio.generations.progress.queued')
    : generation.kind === 'video'
      ? t('studio.generations.progress.video')
      : generation.params.count > 1
        ? t('studio.generations.progress.images')
        : t('studio.generations.progress.image');

  return (
    <div
      style={{ aspectRatio: String(boundedAspect(generationAspect(generation))) }}
      className="relative isolate flex min-h-60 w-full flex-col items-center justify-center gap-2 overflow-hidden bg-surface-raised p-4 text-center"
    >
      <span aria-hidden="true" className={cn('absolute inset-0 -z-10 animate-pulse-soft', GLOW)} />
      <span
        aria-hidden="true"
        className="absolute inset-0 -z-10 animate-shimmer bg-shimmer opacity-50"
      />
      <span className="flex size-12 items-center justify-center rounded-2xl border border-border bg-surface/80 text-brand shadow-sm backdrop-blur">
        {queued ? (
          <Clock aria-hidden="true" className="size-7" />
        ) : (
          <SpinnerIcon className="size-7" />
        )}
      </span>
      {queued ? null : (
        <p
          aria-hidden="true"
          className="text-xl leading-7 font-semibold text-foreground tabular-nums"
        >
          {formatNumber(percent / 100, locale, { style: 'percent' })}
        </p>
      )}
      <p className="max-w-[16rem] text-sm text-muted">{status}</p>
      <p className="text-xs text-subtle tabular-nums">
        {t('studio.generations.progress.elapsed', {
          time: isolateLtr(formatElapsed(now - generation.createdAt, locale)),
        })}
      </p>
      <Progress
        size="sm"
        value={queued ? undefined : percent}
        label={t('studio.generations.progress.percent', {
          percent: formatNumber(percent / 100, locale, { style: 'percent' }),
        })}
        className="w-full max-w-56"
      />
      {onCancel ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => onCancel(generation)}
          className="mt-1"
        >
          {t('studio.generations.cancel.action')}
        </Button>
      ) : null}
    </div>
  );
}

/** A failed or canceled generation: what happened, that nothing was charged, and a way forward. */
export function OutcomeBody({
  generation,
  onRetry,
}: {
  generation: GenerationDTO;
  onRetry?: GenerationHandlers['onRetry'];
}) {
  const { t } = useI18n();
  const failed = generation.status === 'failed';
  return (
    <div className="flex min-h-52 w-full flex-col items-center justify-center gap-2.5 bg-surface-raised p-5 text-center">
      <span
        aria-hidden="true"
        className={cn(
          'flex size-12 items-center justify-center rounded-2xl ring-1 [&_svg]:size-6',
          failed
            ? 'bg-danger-soft text-danger ring-danger/30'
            : 'bg-foreground/[0.06] text-muted ring-border',
        )}
      >
        {failed ? <TriangleAlert /> : <Ban />}
      </span>
      <p className="text-sm font-semibold text-foreground">
        {failed ? t('studio.generations.failure.title') : t('studio.generations.canceled.title')}
      </p>
      <p className="max-w-[18rem] text-sm text-muted">
        {failed ? failureReason(t, generation) : t('studio.generations.canceled.note')}
      </p>
      {failed ? (
        <p className="text-xs text-subtle">{t('studio.generations.failure.refunded')}</p>
      ) : null}
      {failed && onRetry ? (
        <Button size="sm" variant="secondary" onClick={() => onRetry(generation)} className="mt-1">
          {t('studio.generations.failure.retry')}
        </Button>
      ) : null}
    </div>
  );
}

function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full bg-black/65 px-2 text-xs font-medium text-white backdrop-blur-sm [&_svg]:size-3.5',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The results of a finished generation: one tile, or a two-column mosaic for several. Three
 * results show the first across both columns, so the mosaic has no empty cell.
 */
export function ResultsBody({
  generation,
  onOpen,
}: {
  generation: GenerationDTO;
  onOpen?: GenerationHandlers['onOpen'];
}) {
  const { t, locale } = useI18n();
  const { outputs } = generation;
  const shared = boundedAspect(generationAspect(generation));
  const label = promptLabel(generation.prompt);
  const first = outputs[0];
  const seconds = first?.durationMs ? Math.round(first.durationMs / 1000) : undefined;
  const hero = outputs.length === 3;

  return (
    <div className="relative">
      <div className={cn('grid gap-px bg-border', outputs.length > 1 && 'grid-cols-2')}>
        {outputs.map((asset, index) => {
          const span = hero && index === 0 ? 'col-span-2' : undefined;
          const presentation = presentationOf(asset);
          const aspect = boundedAspect(assetAspect(asset) ?? shared);
          const alt =
            asset.kind === 'video'
              ? t(
                  presentation === 'video'
                    ? 'studio.generations.media.video'
                    : 'studio.generations.media.videoPreview',
                  { prompt: label },
                )
              : t('studio.generations.media.image', { index: index + 1, prompt: label });
          const media = (
            <MediaPreview
              asset={asset}
              alt={alt}
              aspect={aspect}
              variant="thumb"
              eager={index === 0}
              controls
            />
          );
          // A real video keeps its own controls; every other result opens the viewer.
          if (presentation === 'video' || !onOpen) {
            return (
              <div key={asset.id} className={cn('relative bg-surface-raised', span)}>
                {media}
              </div>
            );
          }
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => onOpen(generation, index)}
              aria-label={`${t('studio.generations.actions.open')}: ${alt}`}
              className={cn(
                'group/tile relative block w-full cursor-zoom-in bg-surface-raised outline-none focus-visible:z-10 focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-inset',
                span,
              )}
            >
              <span className="pointer-events-none block">{media}</span>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition duration-200 group-hover/tile:bg-black/30 group-hover/tile:opacity-100 group-focus-visible/tile:bg-black/30 group-focus-visible/tile:opacity-100"
              >
                {asset.kind === 'video' ? (
                  <Play className="size-9 fill-current drop-shadow" />
                ) : (
                  <Expand className="size-7 drop-shadow" />
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute start-2 top-2 flex gap-1.5">
        {generation.kind === 'video' && seconds !== undefined ? (
          <Pill>
            <Play aria-hidden="true" className="fill-current" />
            {formatSeconds(seconds, locale)}
          </Pill>
        ) : null}
        {generation.isPublic ? (
          <Pill>
            <Globe aria-hidden="true" />
            {t('studio.generations.card.shared')}
          </Pill>
        ) : null}
      </div>
    </div>
  );
}
