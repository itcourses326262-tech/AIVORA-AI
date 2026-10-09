'use client';

/**
 * One result file, whatever it is: an image, the Demo video (an animated GIF, which is an `<img>`)
 * or a real video. The box exists before the file arrives (`aspect`), so the page does not jump
 * when the pictures load; a shimmer fills it meanwhile and a quiet message replaces a file that
 * fails to load.
 *
 * Props
 * - `asset`: the `AssetDTO` to show.
 * - `alt`: the description for assistive technology (required; use the prompt).
 * - `variant`: `thumb` (default) uses the small still and does not download a video that has a
 *   poster (a video without one loads its first frame); `full` uses the file itself. With
 *   `prefers-reduced-motion`, an animated GIF in a thumbnail stays a still.
 * - `fit`: `cover` fills the box (grids), `contain` shows everything (viewer).
 * - `aspect`: width / height of the box. Omit it to size the box to the file.
 * - `natural`: show a picture at its own pixel size (zoomed in the viewer); the parent scrolls.
 * - `controls`: native video controls (default true for a real video).
 * - `eager`: skip lazy loading for pictures above the fold.
 */
import { ImageOff } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { AssetDTO } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { presentationOf } from '@/lib/generations/media';
import { usePrefersReducedMotion } from '@/lib/generations/use-media-query';
import { cn } from '@/lib/utils';

export interface MediaPreviewProps {
  asset: AssetDTO;
  alt: string;
  variant?: 'thumb' | 'full';
  fit?: 'cover' | 'contain';
  aspect?: number;
  natural?: boolean;
  controls?: boolean;
  eager?: boolean;
  className?: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

function MediaFile({
  asset,
  alt,
  src,
  fit,
  boxed,
  natural,
  controls,
  eager,
  video,
  thumbnail,
}: {
  asset: AssetDTO;
  alt: string;
  src: string;
  fit: 'cover' | 'contain';
  boxed: boolean;
  natural: boolean;
  controls: boolean;
  eager: boolean;
  video: boolean;
  thumbnail: boolean;
}) {
  const { t } = useI18n();
  // A thumbnail video is not downloaded (`preload="none"`): the poster is its picture and no data
  // event will ever come, so there is nothing to wait for.
  const posterOnly = video && thumbnail && Boolean(asset.thumbUrl);
  const [state, setState] = useState<LoadState>(posterOnly ? 'loaded' : 'loading');
  const sizing = boxed
    ? cn('absolute inset-0 size-full', fit === 'cover' ? 'object-cover' : 'object-contain')
    : natural
      ? 'block h-auto max-h-none w-auto max-w-none'
      : 'block h-auto max-h-[inherit] w-auto max-w-full object-contain';

  return (
    <>
      {state === 'loading' ? (
        <span aria-hidden="true" className="absolute inset-0 animate-shimmer bg-shimmer" />
      ) : null}
      {state === 'error' ? (
        <span
          role="img"
          aria-label={t('studio.generations.media.loadFailed')}
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-raised p-3 text-center text-xs text-muted"
        >
          <ImageOff aria-hidden="true" className="size-6 text-subtle" />
          {t('studio.generations.media.loadFailed')}
        </span>
      ) : video ? (
        <video
          src={src}
          poster={asset.thumbUrl}
          aria-label={alt}
          controls={controls}
          playsInline
          preload={posterOnly ? 'none' : 'metadata'}
          // Never hidden while it loads: its poster (or first frame) is the preview, and the
          // shimmer behind it only shows through where there is nothing to draw yet.
          className={sizing}
          onLoadedData={() => setState('loaded')}
          onError={() => setState('error')}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- user media is served by our own authenticated route; the image optimizer would add nothing
        <img
          ref={(node) => {
            // A cached file can finish loading before React attaches `onLoad`.
            if (node?.complete && node.naturalWidth > 0) setState('loaded');
          }}
          src={src}
          alt={alt}
          width={asset.width}
          height={asset.height}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          draggable={false}
          className={cn(
            sizing,
            'transition-opacity duration-300',
            state === 'loading' && 'opacity-0',
          )}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
        />
      )}
    </>
  );
}

export function MediaPreview({
  asset,
  alt,
  variant = 'thumb',
  fit = 'cover',
  aspect,
  natural = false,
  controls = true,
  eager = false,
  className,
}: MediaPreviewProps) {
  const reducedMotion = usePrefersReducedMotion();
  const presentation = presentationOf(asset);
  const thumbnail = variant === 'thumb';
  // A looping GIF keeps playing in a grid; a person who asked for less motion gets its still.
  const stillOnly =
    presentation === 'animated-image' && thumbnail && reducedMotion && asset.thumbUrl;
  const src =
    stillOnly || (thumbnail && presentation === 'image' && asset.thumbUrl)
      ? (asset.thumbUrl as string)
      : asset.url;
  const boxed = aspect !== undefined;
  const style: CSSProperties | undefined = boxed ? { aspectRatio: String(aspect) } : undefined;

  return (
    <div
      style={style}
      className={cn(
        'relative overflow-hidden',
        boxed
          ? 'w-full'
          : natural
            ? 'inline-flex'
            : 'inline-flex max-h-full max-w-full items-center justify-center',
        className,
      )}
    >
      <MediaFile
        key={src}
        asset={asset}
        alt={alt}
        src={src}
        fit={fit}
        boxed={boxed}
        natural={natural}
        controls={controls}
        eager={eager}
        video={presentation === 'video'}
        thumbnail={thumbnail}
      />
    </div>
  );
}
