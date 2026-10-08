'use client';

import { ChevronDown, Dices, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { ModelDTO } from '@/lib/api-types';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber } from '@/lib/utils';
import { Field } from '../ui/field';
import { IconButton } from '../ui/icon-button';
import { Input } from '../ui/input';
import { Slider } from '../ui/slider';
import { Textarea } from '../ui/textarea';
import { MAX_SEED, parseSeed, toAsciiDigits } from './form';

export interface AdvancedValues {
  negativePrompt: string;
  seed: string;
  strength: number;
}

export interface AdvancedOptionsProps {
  model: ModelDTO;
  /** Strength only exists for tools that take an input image. */
  withStrength: boolean;
  values: AdvancedValues;
  onChange: (patch: Partial<AdvancedValues>) => void;
  /** Sentences for fields the server or the form refused. */
  errors: { negativePrompt?: string; seed?: string; strength?: string };
}

/** A fresh random seed: whole, inside what the models accept. */
export function randomSeed(): number {
  const bytes = new Uint32Array(1);
  if (typeof crypto?.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else bytes[0] = Math.floor(Math.random() * (MAX_SEED + 1));
  return bytes[0] ?? 0;
}

/**
 * The options most people never touch, behind a disclosure: negative prompt, seed (with a dice) and
 * strength. Each exists only when the model supports it; with none, nothing is rendered.
 */
export function AdvancedOptions({
  model,
  withStrength,
  values,
  onChange,
  errors,
}: AdvancedOptionsProps) {
  const { t, locale } = useI18n();
  const regionId = useId();
  const [open, setOpen] = useState(false);
  const { limits } = model;
  const showStrength = limits.supportsStrength && withStrength;
  if (!limits.supportsNegativePrompt && !limits.supportsSeed && !showStrength) return null;

  // An error inside must never stay hidden.
  const expanded = open || Boolean(errors.seed || errors.negativePrompt || errors.strength);

  return (
    <div className="rounded-xl border border-border bg-surface">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={() => setOpen(!expanded)}
        className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-3.5 text-sm font-semibold text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      >
        {t('studio.advanced.title')}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'size-4 text-muted transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div id={regionId} hidden={!expanded} className="grid gap-4 px-3.5 pb-3.5">
        {limits.supportsNegativePrompt ? (
          <Field
            label={t('studio.advanced.negative.label')}
            hint={t('studio.advanced.negative.hint')}
            error={errors.negativePrompt}
            optional
          >
            <Textarea
              rows={2}
              dir="auto"
              value={values.negativePrompt}
              placeholder={t('studio.advanced.negative.placeholder')}
              onChange={(event) => onChange({ negativePrompt: event.target.value })}
            />
          </Field>
        ) : null}

        {limits.supportsSeed ? (
          <Field
            label={t('studio.advanced.seed.label')}
            hint={t('studio.advanced.seed.hint')}
            error={
              errors.seed ??
              (parseSeed(values.seed) === null
                ? t('studio.advanced.seed.invalid', { max: MAX_SEED })
                : undefined)
            }
            optional
          >
            <Input
              inputMode="numeric"
              autoComplete="off"
              dir="ltr"
              value={values.seed}
              placeholder={t('studio.advanced.seed.placeholder')}
              onChange={(event) => onChange({ seed: toAsciiDigits(event.target.value) })}
              endAdornment={
                <span className="flex items-center gap-0.5">
                  {values.seed ? (
                    <IconButton
                      label={t('studio.advanced.seed.clear')}
                      size="sm"
                      onClick={() => onChange({ seed: '' })}
                    >
                      <X />
                    </IconButton>
                  ) : null}
                  <IconButton
                    label={t('studio.advanced.seed.random')}
                    size="sm"
                    onClick={() => onChange({ seed: String(randomSeed()) })}
                  >
                    <Dices />
                  </IconButton>
                </span>
              }
            />
          </Field>
        ) : null}

        {showStrength ? (
          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <span id={`${regionId}-strength`} className="text-sm font-medium text-foreground">
                {t('studio.advanced.strength.label')}
              </span>
              <span className="text-sm text-muted tabular-nums" aria-hidden="true">
                {formatNumber(values.strength, locale, { style: 'percent' })}
              </span>
            </div>
            <Slider
              aria-labelledby={`${regionId}-strength`}
              min={0}
              max={1}
              step={0.05}
              value={values.strength}
              formatValue={(value) => formatNumber(value, locale, { style: 'percent' })}
              onValueChange={(strength) => onChange({ strength })}
            />
            <p className="text-xs text-muted">{t('studio.advanced.strength.hint')}</p>
            {errors.strength ? (
              <p role="alert" className="text-sm text-danger">
                {errors.strength}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
