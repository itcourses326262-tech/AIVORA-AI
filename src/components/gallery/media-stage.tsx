'use client';

import type { AssetDTO, Kind } from '@/lib/api-types';
import type { TFunction } from '@/lib/i18n';
import { assetAspect, boundedAspect, presentationOf, promptLabel } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { MediaPreview } from '../generations/media-preview';
import { ZoomPan } from './zoom-pan';

export interface MediaStageProps {
  outputs: readonly AssetDTO[];
  kind: Kind;
  /** Names the pictures for assistive technology. */
  prompt: string;
  /** The result on show. */
  index: number;
  onIndexChange: (index: number) => void;
  className?: string;
}

/** The accessible name of result number `index` (the Demo video is a GIF and counts as a preview). */
function altOf(t: TFunction, asset: AssetDTO, index: number, prompt: string): string {
  const label = promptLabel(prompt);
  if (asset.kind === 'video') {
    return t(
      presentationOf(asset) === 'video'
        ? 'studio.generations.media.video'
        : 'studio.generations.media.videoPreview',
      { prompt: label },
    );
  }
  return t('studio.generations.media.image', { index: index + 1, prompt: label });
}

/**
 * The big view of a creation's results, as large as the screen allows: a picture can be zoomed and
 * moved, a real video has its player, and a creation with several results gets a strip to switch
 * between them. Shared by the detail page and the public share page.
 */
export function MediaStage({
  outputs,
  kind,
  prompt,
  index,
  onIndexChange,
  className,
}: MediaStageProps) {
  const { t } = useI18n();
  const position = Math.min(Math.max(index, 0), Math.max(outputs.length - 1, 0));
  const asset = outputs[position];
  if (!asset) return null;

  const alt = altOf(t, asset, position, prompt);
  const ratio = boundedAspect(assetAspect(asset) ?? 1);
  const video = presentationOf(asset) === 'video';

  return (
    <div className={cn('grid gap-3', className)}>
      {/* The box is as tall as the screen allows and no wider than its picture needs. */}
      <div
        className="mx-auto w-full"
        style={{ maxWidth: `calc(min(78dvh, 60rem) * ${ratio})` }}
        data-kind={kind}
      >
        <div
          className="relative overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-sm"
          style={{ aspectRatio: String(ratio) }}
        >
          {video ? (
            <MediaPreview
              key={asset.id}
              asset={asset}
              alt={alt}
              variant="full"
              fit="contain"
              aspect={ratio}
              eager
              className="size-full"
            />
          ) : (
            <ZoomPan key={asset.id} asset={asset} alt={alt} />
          )}
        </div>
      </div>

      {outputs.length > 1 ? (
        <ul
          aria-label={t('gallery.detail.results')}
          className="no-scrollbar flex justify-center gap-2 overflow-x-auto px-1 py-1"
        >
          {outputs.map((output, outputIndex) => {
            const current = outputIndex === position;
            return (
              <li key={output.id} className="shrink-0">
                <button
                  type="button"
                  aria-current={current ? 'true' : undefined}
                  aria-label={t('gallery.detail.showResult', {
                    index: outputIndex + 1,
                    total: outputs.length,
                  })}
                  onClick={() => onIndexChange(outputIndex)}
                  className={cn(
                    'relative block size-16 cursor-pointer overflow-hidden rounded-lg border bg-surface-raised outline-none focus-visible:ring-[3px] focus-visible:ring-ring sm:size-20',
                    current
                      ? 'border-transparent ring-2 ring-brand'
                      : 'border-border opacity-80 hover:opacity-100',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- user media is served by our own route */}
                  <img
                    src={output.thumbUrl ?? output.url}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
