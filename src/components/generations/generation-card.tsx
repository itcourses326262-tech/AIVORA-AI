'use client';

/**
 * One generation as a card: its results (or the placeholder while it runs, or why it failed), the
 * prompt, the model, the cost and the time, a favorite button and the actions menu. The studio shows
 * a column of these; the gallery reuses the same card.
 *
 * Props
 * - `generation`: the `GenerationDTO` to show. The card re-renders as polling replaces it.
 * - `modelLabel`: display name of the model; falls back to the model id.
 * - `demo`: marks a Demo (sample) model.
 * - `handlers`: which actions exist, see `GenerationHandlers`. The card shows an action only when
 *   its handler is given.
 * - `pending`: the request that creates this generation has not been accepted yet (optimistic card);
 *   actions that need a real id are disabled.
 * - `href`: makes the prompt a link (the gallery sends it to the detail page, which every card has,
 *   a failed one included).
 * - `ref`: the `<article>`, so a page can move focus to a new card.
 * - `className`: extra classes for the article.
 *
 * The article is focusable (`tabIndex=-1`) and named by the prompt and the status, so the studio can
 * send a screen-reader user to a result that just appeared.
 */
import { Heart } from 'lucide-react';
import Link from 'next/link';
import type { Ref } from 'react';
import type { GenerationDTO } from '@/lib/api-types';
import { creditsText } from '@/lib/generations/format';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { isActive, promptLabel } from '@/lib/generations/media';
import { useMinuteClock } from '@/lib/generations/use-now';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { IconButton } from '../ui/icon-button';
import { ActiveBody, OutcomeBody, ResultsBody } from './card-bodies';
import { GenerationActions } from './generation-actions';

export interface GenerationCardProps {
  generation: GenerationDTO;
  modelLabel?: string;
  demo?: boolean;
  handlers?: GenerationHandlers;
  pending?: boolean;
  href?: string;
  ref?: Ref<HTMLElement>;
  className?: string;
}

export function GenerationCard({
  generation,
  modelLabel,
  demo = false,
  handlers = {},
  pending = false,
  href,
  ref,
  className,
}: GenerationCardProps) {
  const { t, locale, plural } = useI18n();
  const clock = useMinuteClock();
  const active = isActive(generation);
  const done = generation.status === 'succeeded' && generation.outputs.length > 0;
  const kind = t(`studio.generations.kind.${generation.kind}`);
  const label = t('studio.generations.card.label', {
    kind,
    prompt: promptLabel(generation.prompt, 100),
  });

  return (
    <article
      ref={ref}
      tabIndex={-1}
      aria-label={`${label}. ${t(`studio.generations.status.${generation.status}`)}`}
      aria-busy={active || undefined}
      data-status={generation.status}
      data-generation-id={generation.id}
      className={cn(
        'group/card flex min-w-0 animate-fade-in flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-xs transition-shadow duration-200 outline-none hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring',
        className,
      )}
    >
      {active ? (
        <ActiveBody generation={generation} pending={pending} onCancel={handlers.onCancel} />
      ) : done ? (
        <ResultsBody generation={generation} onOpen={handlers.onOpen} />
      ) : (
        <OutcomeBody generation={generation} onRetry={handlers.onRetry} />
      )}
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          <p dir="auto" title={generation.prompt} className="line-clamp-2 text-sm text-foreground">
            {href ? (
              <Link
                href={href}
                className="rounded-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                {generation.prompt}
              </Link>
            ) : (
              generation.prompt
            )}
          </p>
          <p className="mt-1.5 flex items-center gap-x-1.5 text-xs whitespace-nowrap text-muted">
            <span className="min-w-0 truncate">{modelLabel ?? generation.modelId}</span>
            {demo ? (
              <span className="shrink-0 rounded-sm bg-foreground/[0.08] px-1 text-[0.6875rem] font-medium">
                {t('studio.generations.card.demo')}
              </span>
            ) : null}
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <span className="shrink-0 tabular-nums">
              {creditsText({ t, plural }, generation.cost)}
            </span>
            <span aria-hidden="true" className="shrink-0">
              ·
            </span>
            <time
              dateTime={new Date(generation.createdAt).toISOString()}
              className="shrink-0 tabular-nums"
            >
              {formatRelativeTime(generation.createdAt, locale, clock)}
            </time>
          </p>
        </div>
        <div className="-me-1 flex shrink-0 items-center">
          {done && handlers.onToggleFavorite ? (
            <IconButton
              label={t('studio.generations.card.favorite')}
              size="sm"
              aria-pressed={generation.isFavorite}
              onClick={() => handlers.onToggleFavorite?.(generation)}
            >
              <Heart
                className={cn(
                  'transition-colors',
                  generation.isFavorite && 'fill-danger text-danger',
                )}
              />
            </IconButton>
          ) : null}
          {pending ? null : <GenerationActions generation={generation} handlers={handlers} />}
        </div>
      </div>
    </article>
  );
}
