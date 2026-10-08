'use client';

import { Check } from 'lucide-react';
import { GenerationCard } from '@/components/generations';
import type { GenerationDTO } from '@/lib/api-types';
import type { GenerationHandlers } from '@/lib/generations/handlers';
import { promptLabel } from '@/lib/generations/media';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';
import { detailHref } from './links';
import { modelInfo } from './model-info';

export interface TileProps {
  generation: GenerationDTO;
  handlers: GenerationHandlers;
  /** Multi-select mode: the whole card is one switch that chooses it. */
  selecting: boolean;
  selected: boolean;
  /** `range` is true when Shift was held. */
  onSelect: (id: string, range: boolean) => void;
}

/**
 * One creation in the grid: the shared card, or, while choosing, the card behind a full-size
 * switch. The card is `inert` then, so Tab and screen readers meet one control per creation
 * instead of the card's own buttons.
 */
export function Tile({ generation, handlers, selecting, selected, onSelect }: TileProps) {
  const { t } = useI18n();
  const model = modelInfo(generation.modelId);

  return (
    <div className={cn('relative rounded-2xl', selected && 'ring-[3px] ring-brand')}>
      <div inert={selecting}>
        <GenerationCard
          generation={generation}
          modelLabel={model.label}
          demo={model.demo}
          handlers={handlers}
          href={detailHref(generation.id)}
        />
      </div>
      {selecting ? (
        <button
          type="button"
          aria-pressed={selected}
          aria-label={t('gallery.select.item', { prompt: promptLabel(generation.prompt, 80) })}
          onClick={(event) => onSelect(generation.id, event.shiftKey)}
          className="group absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute end-3 top-3 flex size-7 items-center justify-center rounded-full border-2 shadow-md transition-colors duration-150',
              selected
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-white bg-black/50 text-transparent group-hover:bg-black/65',
            )}
          >
            <Check className="size-4" strokeWidth={3} />
          </span>
        </button>
      ) : null}
    </div>
  );
}
