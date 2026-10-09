'use client';

import { Play } from 'lucide-react';
import Link from 'next/link';
import { aspectValue } from '@/lib/catalog/aspect';
import { assetAspect, boundedAspect } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatSeconds } from '@/lib/utils';
import { MediaPreview } from '../generations/media-preview';
import { Badge } from '../ui/badge';
import { sharePath } from './links';
import { modelInfo } from './model-info';
import type { PublicCreation } from './public-creation';

/** Height of the text block below the picture (two lines of prompt, model and owner). */
const FOOTER_PX = 96;

function ratioOf(creation: PublicCreation): number {
  return boundedAspect(
    assetAspect(creation.outputs[0]) ?? aspectValue(creation.params.aspectRatio),
  );
}

/** About how tall a card is at `width` pixels; `Masonry` uses it to pick the shortest column. */
export function estimateExploreHeight(creation: PublicCreation, width: number): number {
  return width / ratioOf(creation) + FOOTER_PX;
}

export interface ExploreCardProps {
  creation: PublicCreation;
  /** Load the picture at once (the first row). */
  eager?: boolean;
  className?: string;
}

/**
 * A shared creation in the public feed: its first result, the prompt, the model and the owner's
 * first name. The prompt is the one link; it stretches over the whole card, so a click anywhere
 * opens `/s/<id>` and a keyboard or screen-reader user meets one link per card.
 */
export function ExploreCard({ creation, eager = false, className }: ExploreCardProps) {
  const { t, locale } = useI18n();
  const model = modelInfo(creation.modelId);
  const first = creation.outputs[0];
  const seconds = first?.durationMs ? Math.round(first.durationMs / 1000) : undefined;

  return (
    <article
      className={cn(
        'group/card relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-[box-shadow,transform] duration-200 focus-within:ring-[3px] focus-within:ring-ring hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      <div className="relative bg-surface-raised">
        {first ? (
          <MediaPreview
            asset={first}
            alt=""
            variant="thumb"
            aspect={ratioOf(creation)}
            eager={eager}
            controls={false}
          />
        ) : null}
        {creation.kind === 'video' && seconds !== undefined ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute start-2 top-2 inline-flex h-6 items-center gap-1 rounded-full bg-black/65 px-2 text-xs font-medium text-white backdrop-blur-sm [&_svg]:size-3.5"
          >
            <Play className="fill-current" />
            {formatSeconds(seconds, locale)}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-1 gap-2 p-3">
        <h2 dir="auto" className="line-clamp-2 text-sm leading-6 text-foreground">
          <Link
            href={sharePath(creation.id)}
            className="rounded-sm outline-none after:absolute after:inset-0 after:content-['']"
          >
            {creation.prompt}
          </Link>
        </h2>
        <p className="flex min-w-0 items-center gap-x-2 text-xs text-muted">
          <Badge size="sm" className="max-w-[60%] min-w-0 truncate">
            <span className="truncate">{model.label}</span>
          </Badge>
          {creation.ownerFirstName ? (
            <span className="min-w-0 truncate">
              {t('gallery.explore.card.by')} <bdi>{creation.ownerFirstName}</bdi>
            </span>
          ) : null}
        </p>
      </div>
    </article>
  );
}
