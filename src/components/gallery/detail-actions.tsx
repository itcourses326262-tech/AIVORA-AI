'use client';

import { Clapperboard, Download, Heart, ImagePlus, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { GenerationDTO } from '@/lib/api-types';
import { downloadAssets } from '@/lib/generations/download';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { downloadHref, isActive } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { buttonVariants } from '../ui/button-variants';
import { inputHref, reuseHref } from './links';

export interface DetailActionsProps {
  generation: GenerationDTO;
  /** The result on show: "download" and "use as input" mean this one. */
  outputIndex: number;
  handlers: Pick<GenerationHandlers, 'onToggleFavorite' | 'onCancel' | 'onDelete'>;
}

/** Everything the owner can do with one creation, in the order they will want it. */
export function DetailActions({ generation, outputIndex, handlers }: DetailActionsProps) {
  const { t } = useI18n();
  const asset = generation.outputs[outputIndex];
  const done = generation.status === 'succeeded' && asset !== undefined;
  // A video offers its still frame; a result with neither a picture nor a still cannot be an input.
  const usableAsInput = done && (asset.kind === 'image' || Boolean(asset.thumbUrl));
  const video = asset?.kind === 'video';

  return (
    <div className="flex flex-wrap gap-2">
      {done ? (
        <a
          href={downloadHref(asset)}
          download=""
          className={cn(buttonVariants({ variant: 'primary' }), 'grow sm:grow-0')}
        >
          <Download aria-hidden="true" className="size-4" />
          {t('gallery.detail.download')}
        </a>
      ) : null}
      {done && generation.outputs.length > 1 ? (
        <Button
          variant="secondary"
          startIcon={<Download />}
          onClick={() => void downloadAssets(generation.outputs)}
        >
          {t('studio.generations.actions.downloadAll')}
        </Button>
      ) : null}
      {done ? (
        <Button
          variant="secondary"
          aria-pressed={generation.isFavorite}
          startIcon={<Heart className={cn(generation.isFavorite && 'fill-danger text-danger')} />}
          onClick={() => handlers.onToggleFavorite?.(generation)}
        >
          {generation.isFavorite
            ? t('studio.generations.actions.unfavorite')
            : t('studio.generations.actions.favorite')}
        </Button>
      ) : null}
      <Button href={reuseHref(generation)} variant="secondary" startIcon={<SlidersHorizontal />}>
        {t('studio.generations.actions.reuse')}
      </Button>
      {usableAsInput ? (
        <>
          <Button
            href={inputHref('image-to-image', asset.id)}
            variant="secondary"
            startIcon={<ImagePlus />}
          >
            {t(video ? 'gallery.detail.editFrame' : 'gallery.detail.edit')}
          </Button>
          <Button
            href={inputHref('image-to-video', asset.id)}
            variant="secondary"
            startIcon={<Clapperboard />}
          >
            {t(video ? 'gallery.detail.animateFrame' : 'gallery.detail.animate')}
          </Button>
        </>
      ) : null}
      {isActive(generation) ? (
        <Button
          variant="outline"
          startIcon={<X />}
          onClick={() => handlers.onCancel?.(generation)}
        >
          {t('studio.generations.cancel.action')}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className="text-danger hover:bg-danger-soft"
        startIcon={<Trash2 />}
        onClick={() => handlers.onDelete?.(generation)}
      >
        {t('studio.generations.actions.delete')}
      </Button>
    </div>
  );
}
