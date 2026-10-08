'use client';

/**
 * The lightbox for the results of a generation: the file at a large size, previous / next across
 * the results of that generation (arrow keys follow what the user sees, so they swap in Arabic),
 * zoom to the real pixel size, download, favorite, share and the rest of the actions menu.
 *
 * Props
 * - `generation`: the generation to show, or `null` while closed.
 * - `index`, `onIndexChange`: the result on screen (controlled by the page).
 * - `onClose`: called on Escape, the backdrop and the close button.
 * - `handlers`: see `GenerationHandlers`; favorite, share and the menu appear only when given.
 * - `modelLabel`: display name of the model for the caption.
 *
 * It is a `Dialog`, so focus is trapped, the page behind is inert and focus returns to the opener.
 */
import { ChevronLeft, ChevronRight, Download, Heart, Share2, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { triggerDownload } from '@/lib/generations/download';
import { clipText, creditsText } from '@/lib/generations/format';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { downloadHref, presentationOf, promptLabel } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { Dialog } from '../ui/dialog';
import { isRtl } from '../ui/dir';
import { Directional } from '../ui/icon';
import { IconButton } from '../ui/icon-button';
import { GenerationActions } from './generation-actions';
import { MediaPreview } from './media-preview';

export interface MediaViewerProps {
  generation: GenerationDTO | null;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  handlers?: GenerationHandlers;
  modelLabel?: string;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable="true"], [role="menu"]') !== null
  );
}

export function MediaViewer({
  generation,
  index,
  onIndexChange,
  onClose,
  handlers = {},
  modelLabel,
}: MediaViewerProps) {
  const { t, locale, plural } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoomed, setZoomed] = useState(false);
  // The dialog plays an exit animation after `generation` turns null: keep showing the last one.
  const [last, setLast] = useState(generation);
  if (generation && generation !== last) setLast(generation);
  const current = generation ?? last;
  const outputs = current?.outputs ?? [];
  const total = outputs.length;
  const position = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
  const open = generation !== null;

  // Zoom belongs to the picture on screen: a new picture starts fitted.
  const [zoomKey, setZoomKey] = useState(`${current?.id}:${position}`);
  if (zoomKey !== `${current?.id}:${position}`) {
    setZoomKey(`${current?.id}:${position}`);
    setZoomed(false);
  }

  useEffect(() => {
    if (!open || total < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (typingInto(event.target)) return;
      const rtl = isRtl(stageRef.current);
      const forward = (event.key === 'ArrowRight') !== rtl;
      event.preventDefault();
      onIndexChange((position + (forward ? 1 : -1) + total) % total);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, total, position, onIndexChange]);

  if (!current || total === 0) return null;
  const asset = outputs[position];
  if (!asset) return null;

  const presentation = presentationOf(asset);
  const label = promptLabel(current.prompt);
  const alt =
    asset.kind === 'video'
      ? t(
          presentation === 'video'
            ? 'studio.generations.media.video'
            : 'studio.generations.media.videoPreview',
          { prompt: label },
        )
      : t('studio.generations.media.image', { index: position + 1, prompt: label });
  const canZoom = presentation !== 'video';
  const step = (delta: number) => onIndexChange((position + delta + total) % total);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="xl"
      className="max-w-5xl"
      title={clipText(current.prompt, 90)}
      description={`${modelLabel ?? current.modelId} · ${creditsText({ t, plural }, current.cost)} · ${formatRelativeTime(current.createdAt, locale)}`}
    >
      <div className="grid gap-3">
        <div className="relative overflow-hidden rounded-xl border border-border bg-surface-raised">
          <div
            ref={stageRef}
            className={cn(
              'flex max-h-[calc(100dvh-19rem)] min-h-48 overflow-auto p-2',
              zoomed ? 'items-start justify-start' : 'items-center justify-center',
              canZoom && (zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'),
            )}
            onClick={canZoom ? () => setZoomed((value) => !value) : undefined}
          >
            <MediaPreview
              key={asset.id}
              asset={asset}
              alt={alt}
              variant="full"
              fit="contain"
              natural={zoomed}
              eager
              className={cn(!zoomed && 'max-h-[calc(100dvh-20rem)]')}
            />
          </div>
          {total > 1 ? (
            <>
              <IconButton
                label={t('studio.generations.viewer.previous')}
                variant="secondary"
                className="absolute start-2 top-1/2 -translate-y-1/2 rounded-full opacity-90"
                onClick={() => step(-1)}
              >
                <Directional>
                  <ChevronLeft />
                </Directional>
              </IconButton>
              <IconButton
                label={t('studio.generations.viewer.next')}
                variant="secondary"
                className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full opacity-90"
                onClick={() => step(1)}
              >
                <Directional>
                  <ChevronRight />
                </Directional>
              </IconButton>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {total > 1 ? (
            <p aria-live="polite" className="me-2 text-sm text-muted tabular-nums">
              {t('studio.generations.viewer.position', { index: position + 1, total })}
            </p>
          ) : null}
          <div className="ms-auto flex items-center gap-1">
            {canZoom ? (
              <IconButton
                label={
                  zoomed
                    ? t('studio.generations.viewer.zoomOut')
                    : t('studio.generations.viewer.zoomIn')
                }
                onClick={() => setZoomed((value) => !value)}
              >
                {zoomed ? <ZoomOut /> : <ZoomIn />}
              </IconButton>
            ) : null}
            <IconButton
              label={t('studio.generations.actions.download')}
              onClick={() => triggerDownload(downloadHref(asset))}
            >
              <Download />
            </IconButton>
            {handlers.onToggleFavorite ? (
              <IconButton
                label={t('studio.generations.card.favorite')}
                aria-pressed={current.isFavorite}
                onClick={() => handlers.onToggleFavorite?.(current)}
              >
                <Heart className={cn(current.isFavorite && 'fill-danger text-danger')} />
              </IconButton>
            ) : null}
            {handlers.onTogglePublic ? (
              <IconButton
                label={
                  current.isPublic
                    ? t('studio.generations.actions.unshare')
                    : t('studio.generations.actions.share')
                }
                onClick={() => handlers.onTogglePublic?.(current)}
              >
                <Share2 className={cn(current.isPublic && 'text-brand')} />
              </IconButton>
            ) : null}
            <GenerationActions
              generation={current}
              handlers={{ ...handlers, onOpen: undefined }}
              size="md"
            />
          </div>
        </div>

        <p
          dir="auto"
          className="max-h-28 overflow-y-auto text-sm leading-6 whitespace-pre-wrap text-muted"
        >
          {current.prompt}
        </p>
      </div>
    </Dialog>
  );
}
