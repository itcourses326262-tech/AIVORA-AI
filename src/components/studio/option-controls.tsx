'use client';

import { Minus, Plus } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { aspectValue } from '@/lib/catalog/aspect';
import type { AspectRatio, Resolution } from '@/lib/catalog/types';
import { imagesText } from '@/lib/generations/format';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber, formatSeconds } from '@/lib/utils';
import { isRtl } from '../ui/dir';
import { IconButton } from '../ui/icon-button';
import { nextIndexForKey } from '../ui/keyboard';
import { SegmentedControl } from '../ui/radio-group';

// ---- Aspect ratio --------------------------------------------------------------------------------

const SHAPE_BOX = 22;

/** The outline of a ratio, drawn at a fixed size so every chip lines up. */
function RatioShape({ ratio }: { ratio: AspectRatio }) {
  const value = aspectValue(ratio);
  const width = value >= 1 ? SHAPE_BOX : Math.round(SHAPE_BOX * value);
  const height = value >= 1 ? Math.round(SHAPE_BOX / value) : SHAPE_BOX;
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{ width: SHAPE_BOX, height: SHAPE_BOX }}
    >
      <span className="rounded-[3px] border-2 border-current" style={{ width, height }} />
    </span>
  );
}

export interface AspectPickerProps {
  labelledBy: string;
  ratios: readonly AspectRatio[];
  value: AspectRatio | null;
  onChange: (ratio: AspectRatio) => void;
}

/** Aspect-ratio chips with the shape of each ratio; a radio group (arrows move and select). */
export function AspectPicker({ labelledBy, ratios, value, onChange }: AspectPickerProps) {
  const { t } = useI18n();
  const refs = useRef(new Map<AspectRatio, HTMLButtonElement>());
  const tabStop = value && ratios.includes(value) ? value : ratios[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ratios.findIndex((ratio) => refs.current.get(ratio) === document.activeElement);
    const next = nextIndexForKey(event.key, index, ratios.length, {
      orientation: 'both',
      rtl: isRtl(event.currentTarget),
    });
    const target = next === null ? undefined : ratios[next];
    if (!target) return;
    event.preventDefault();
    refs.current.get(target)?.focus();
    onChange(target);
  };

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className="grid grid-cols-[repeat(auto-fill,minmax(3.75rem,1fr))] gap-1.5"
    >
      {ratios.map((ratio) => {
        const checked = ratio === value;
        return (
          <button
            key={ratio}
            ref={(node) => {
              if (node) refs.current.set(ratio, node);
              else refs.current.delete(ratio);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={t('studio.aspect.option', { ratio })}
            tabIndex={ratio === tabStop ? 0 : -1}
            data-state={checked ? 'checked' : 'unchecked'}
            onClick={() => onChange(ratio)}
            className={cn(
              'flex min-h-14 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 text-xs font-medium transition-colors duration-150 pointer-coarse:min-h-16',
              checked
                ? 'border-primary bg-brand-soft text-foreground ring-1 ring-primary'
                : 'border-border bg-surface text-muted hover:border-border-strong hover:text-foreground',
            )}
          >
            <RatioShape ratio={ratio} />
            {/* "9:16" must not be reordered by the bidirectional algorithm in Arabic. */}
            <bdi dir="ltr" className="tabular-nums">
              {ratio}
            </bdi>
          </button>
        );
      })}
    </div>
  );
}

// ---- Number of images ----------------------------------------------------------------------------

export interface CountStepperProps {
  labelledBy: string;
  value: number;
  min?: number;
  max: number;
  onChange: (count: number) => void;
}

/** "- 2 +" with the number spoken as "2 images". */
export function CountStepper({ labelledBy, value, min = 1, max, onChange }: CountStepperProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex items-center gap-3">
      <div className="inline-flex items-center rounded-lg border border-field bg-surface">
        <IconButton
          label={t('studio.count.decrease')}
          size="sm"
          tooltip={false}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          <Minus />
        </IconButton>
        <output
          aria-live="polite"
          className="min-w-9 text-center text-sm font-semibold text-foreground tabular-nums"
        >
          {formatNumber(value, locale)}
        </output>
        <IconButton
          label={t('studio.count.increase')}
          size="sm"
          tooltip={false}
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          <Plus />
        </IconButton>
      </div>
      <span className="text-sm text-muted">{imagesText(i18n, value)}</span>
    </div>
  );
}

// ---- Video ---------------------------------------------------------------------------------------

export interface DurationControlProps {
  labelledBy: string;
  durations: readonly number[];
  value: number | null;
  onChange: (seconds: number) => void;
}

export function DurationControl({ labelledBy, durations, value, onChange }: DurationControlProps) {
  const { locale } = useI18n();
  return (
    <SegmentedControl
      aria-labelledby={labelledBy}
      fullWidth
      value={value === null ? undefined : String(value)}
      onValueChange={(next) => onChange(Number(next))}
      options={durations.map((seconds) => ({
        value: String(seconds),
        label: formatSeconds(seconds, locale),
      }))}
    />
  );
}

export interface ResolutionControlProps {
  labelledBy: string;
  resolutions: readonly Resolution[];
  value: Resolution | null;
  onChange: (resolution: Resolution) => void;
}

export function ResolutionControl({
  labelledBy,
  resolutions,
  value,
  onChange,
}: ResolutionControlProps) {
  return (
    <SegmentedControl
      aria-labelledby={labelledBy}
      fullWidth
      value={value ?? undefined}
      onValueChange={(next) => onChange(next as Resolution)}
      options={resolutions.map((resolution) => ({
        value: resolution,
        label: <bdi dir="ltr">{resolution}</bdi>,
      }))}
    />
  );
}
