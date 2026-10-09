'use client';

import {
  Clapperboard,
  Download,
  Heart,
  ImagePlus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { GenerationDTO } from '@/lib/api-types';
import { downloadAssets } from '@/lib/generations/download';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { downloadHref, isActive } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '../ui/button';
import { buttonVariants } from '../ui/button-variants';
import { inputHref, reuseHref } from './links';

/**
 * On a phone the actions are two to a row and their labels may wrap (a long Arabic label does not
 * fit half a screen on one line); from `sm` they are ordinary buttons side by side.
 */
const CELL =
  'h-auto min-h-10 w-full py-2 text-center whitespace-normal sm:h-10 sm:w-auto sm:py-0 sm:whitespace-nowrap';

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
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
      {done ? (
        <a
          href={downloadHref(asset)}
          download=""
          className={cn(buttonVariants({ variant: 'primary' }), CELL, 'col-span-2 sm:col-auto')}
        >
          <Download aria-hidden="true" className="size-4" />
          {t('gallery.detail.download')}
        </a>
      ) : null}
      {done && generation.outputs.length > 1 ? (
        <Button
          variant="secondary"
          className={CELL}
          startIcon={<Download />}
          onClick={() => void downloadAssets(generation.outputs)}
        >
          {t('studio.generations.actions.downloadAll')}
        </Button>
      ) : null}
      {done ? (
        <Button
          variant="secondary"
          className={CELL}
          aria-pressed={generation.isFavorite}
          startIcon={<Heart className={cn(generation.isFavorite && 'fill-danger text-danger')} />}
          onClick={() => handlers.onToggleFavorite?.(generation)}
        >
          {generation.isFavorite
            ? t('studio.generations.actions.unfavorite')
            : t('studio.generations.actions.favorite')}
        </Button>
      ) : null}
      <Button
        href={reuseHref(generation)}
        variant="secondary"
        className={CELL}
        startIcon={<SlidersHorizontal />}
      >
        {t('studio.generations.actions.reuse')}
      </Button>
      {usableAsInput ? (
        <>
          <Button
            href={inputHref('image-to-image', asset.id)}
            variant="secondary"
            className={CELL}
            startIcon={<ImagePlus />}
          >
            {t(video ? 'gallery.detail.editFrame' : 'gallery.detail.edit')}
          </Button>
          <Button
            href={inputHref('image-to-video', asset.id)}
            variant="secondary"
            className={CELL}
            startIcon={<Clapperboard />}
          >
            {t(video ? 'gallery.detail.animateFrame' : 'gallery.detail.animate')}
          </Button>
        </>
      ) : null}
      {isActive(generation) ? (
        <Button
          variant="outline"
          className={CELL}
          startIcon={<X />}
          onClick={() => handlers.onCancel?.(generation)}
        >
          {t('studio.generations.cancel.action')}
        </Button>
      ) : null}
      <Button
        variant="outline"
        className={cn(CELL, 'text-danger hover:bg-danger-soft')}
        startIcon={<Trash2 />}
        onClick={() => handlers.onDelete?.(generation)}
      >
        {t('studio.generations.actions.delete')}
      </Button>
    </div>
  );
}
