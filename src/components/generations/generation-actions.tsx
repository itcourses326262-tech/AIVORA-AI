'use client';

/**
 * The "more actions" menu of a generation. It lists only what the page can do (a handler was given)
 * and what makes sense for the state: a running generation can be canceled, a finished one
 * downloaded, shared, reused or used as an input image, a failed one retried.
 *
 * Props
 * - `generation`: the generation the menu acts on.
 * - `handlers`: see `GenerationHandlers`; downloads need none, they are links to the media route.
 * - `size`: the trigger button size.
 */
import {
  Copy,
  Download,
  Ellipsis,
  Expand,
  Globe,
  GlobeLock,
  Heart,
  HeartOff,
  ImagePlus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { downloadAssets } from '@/lib/generations/download';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { isActive } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { IconButton, type IconButtonSize } from '../ui/icon-button';

export interface GenerationActionsProps {
  generation: GenerationDTO;
  handlers?: GenerationHandlers;
  size?: IconButtonSize;
  className?: string;
}

/** Whether a result can serve as the input of an image tool (an image, or a video with a still). */
export function canUseAsInput(generation: GenerationDTO): boolean {
  const first = generation.outputs[0];
  return (
    generation.status === 'succeeded' &&
    first !== undefined &&
    (first.kind === 'image' || Boolean(first.thumbUrl))
  );
}

export function GenerationActions({
  generation,
  handlers = {},
  size = 'sm',
  className,
}: GenerationActionsProps) {
  const { t } = useI18n();
  const done = generation.status === 'succeeded' && generation.outputs.length > 0;
  const active = isActive(generation);
  const retryable = generation.status === 'failed' || generation.status === 'canceled';

  const primary: ReactNode[] = [];
  if (done && handlers.onOpen) {
    primary.push(
      <DropdownMenuItem key="open" onSelect={() => handlers.onOpen?.(generation, 0)}>
        <Expand aria-hidden="true" />
        {t('studio.generations.actions.open')}
      </DropdownMenuItem>,
    );
  }
  if (done) {
    primary.push(
      <DropdownMenuItem key="download" onSelect={() => void downloadAssets(generation.outputs)}>
        <Download aria-hidden="true" />
        {generation.outputs.length > 1
          ? t('studio.generations.actions.downloadAll')
          : t('studio.generations.actions.download')}
      </DropdownMenuItem>,
    );
  }
  if (done && handlers.onToggleFavorite) {
    primary.push(
      <DropdownMenuItem key="favorite" onSelect={() => handlers.onToggleFavorite?.(generation)}>
        {generation.isFavorite ? <HeartOff aria-hidden="true" /> : <Heart aria-hidden="true" />}
        {generation.isFavorite
          ? t('studio.generations.actions.unfavorite')
          : t('studio.generations.actions.favorite')}
      </DropdownMenuItem>,
    );
  }
  if (done && handlers.onTogglePublic) {
    primary.push(
      <DropdownMenuItem key="share" onSelect={() => handlers.onTogglePublic?.(generation)}>
        {generation.isPublic ? <GlobeLock aria-hidden="true" /> : <Globe aria-hidden="true" />}
        {generation.isPublic
          ? t('studio.generations.actions.unshare')
          : t('studio.generations.actions.share')}
      </DropdownMenuItem>,
    );
  }
  if (done && generation.isPublic && handlers.onCopyLink) {
    primary.push(
      <DropdownMenuItem key="copy" onSelect={() => handlers.onCopyLink?.(generation)}>
        <Copy aria-hidden="true" />
        {t('studio.generations.actions.copyLink')}
      </DropdownMenuItem>,
    );
  }

  const reuse: ReactNode[] = [];
  if (handlers.onReuse) {
    reuse.push(
      <DropdownMenuItem key="reuse" onSelect={() => handlers.onReuse?.(generation)}>
        <SlidersHorizontal aria-hidden="true" />
        {t('studio.generations.actions.reuse')}
      </DropdownMenuItem>,
    );
  }
  if (canUseAsInput(generation) && handlers.onUseAsInput) {
    reuse.push(
      <DropdownMenuItem key="input" onSelect={() => handlers.onUseAsInput?.(generation, 0)}>
        <ImagePlus aria-hidden="true" />
        {t('studio.generations.actions.useAsInput')}
      </DropdownMenuItem>,
    );
  }
  if (retryable && handlers.onRetry) {
    reuse.push(
      <DropdownMenuItem key="retry" onSelect={() => handlers.onRetry?.(generation)}>
        <RotateCcw aria-hidden="true" />
        {t('studio.generations.actions.retry')}
      </DropdownMenuItem>,
    );
  }

  const danger: ReactNode[] = [];
  if (active && handlers.onCancel) {
    danger.push(
      <DropdownMenuItem key="cancel" onSelect={() => handlers.onCancel?.(generation)}>
        <X aria-hidden="true" />
        {t('studio.generations.cancel.action')}
      </DropdownMenuItem>,
    );
  }
  if (handlers.onDelete) {
    danger.push(
      <DropdownMenuItem key="delete" destructive onSelect={() => handlers.onDelete?.(generation)}>
        <Trash2 aria-hidden="true" />
        {t('studio.generations.actions.delete')}
      </DropdownMenuItem>,
    );
  }

  const groups = [primary, reuse, danger].filter((group) => group.length > 0);
  if (groups.length === 0) return null;

  return (
    <DropdownMenu
      label={t('studio.generations.actions.menu')}
      align="end"
      trigger={
        <IconButton
          label={t('studio.generations.actions.menu')}
          size={size}
          className={className}
          tooltip={false}
        >
          <Ellipsis />
        </IconButton>
      }
    >
      {groups.map((group, index) => (
        <div key={index} role="presentation">
          {index > 0 ? <DropdownMenuSeparator /> : null}
          {group}
        </div>
      ))}
    </DropdownMenu>
  );
}
