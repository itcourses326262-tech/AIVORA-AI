'use client';

import { Coins, TriangleAlert } from 'lucide-react';
import type { ModelDTO } from '@/lib/api-types';
import { creditsText } from '@/lib/generations/format';
import type { Translator } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { ErrorState } from '../ui/error-state';
import { RadioGroup, type RadioOption } from '../ui/radio-group';
import { Badge, type BadgeVariant } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import type { ModelsState } from './use-models';

const BADGE_VARIANT: Record<NonNullable<ModelDTO['badges']>[number], BadgeVariant> = {
  fast: 'info',
  quality: 'brand',
  new: 'success',
  demo: 'outline',
  audio: 'info',
};

/** "1 credit per image" / "From 2 credits per second". */
export function priceLine(model: ModelDTO, i18n: Pick<Translator, 't' | 'plural'>): string {
  const { t } = i18n;
  if (model.pricing.type === 'image') {
    return t('studio.model.pricePerImage', { price: creditsText(i18n, model.pricing.perImage) });
  }
  const { perSecond } = model.pricing;
  const offered = model.limits.resolutions ?? [];
  const prices = (
    offered.length > 0 ? offered : (Object.keys(perSecond) as Array<keyof typeof perSecond>)
  )
    .map((resolution) => perSecond[resolution])
    .filter((price): price is number => typeof price === 'number');
  if (prices.length === 0) return '';
  const lowest = Math.min(...prices);
  const price = creditsText(i18n, lowest);
  return prices.some((candidate) => candidate !== lowest)
    ? t('studio.model.priceFromPerSecond', { price })
    : t('studio.model.pricePerSecond', { price });
}

export interface ModelPickerProps {
  /** Id of the heading that names this group. */
  labelledBy: string;
  state: ModelsState;
  /** The models that serve the current tool. */
  models: readonly ModelDTO[];
  value: string | null;
  onChange: (modelId: string) => void;
  onRetry: () => void;
}

/** The models of the current tool as cards: badges, what they are for, their price, availability. */
export function ModelPicker({
  labelledBy,
  state,
  models,
  value,
  onChange,
  onRetry,
}: ModelPickerProps) {
  const i18n = useI18n();
  const { t, locale } = i18n;

  if (state.status === 'loading') {
    return (
      <div role="status" aria-busy="true" className="grid gap-2">
        <span className="sr-only">{t('studio.model.loading')}</span>
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <ErrorState
        headingLevel={4}
        title={t('studio.model.loadFailed')}
        error={state.error}
        onRetry={onRetry}
        className="py-6"
      />
    );
  }
  if (models.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong p-4 text-sm">
        <p className="font-medium text-foreground">{t('studio.model.none')}</p>
        <p className="mt-1 text-muted">{t('studio.model.noneHint')}</p>
      </div>
    );
  }

  const options: RadioOption[] = models.map((model) => ({
    value: model.id,
    disabled: !model.available,
    label: (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {model.label}
        {model.badges?.map((badge) => (
          <Badge key={badge} size="sm" variant={BADGE_VARIANT[badge]}>
            {t(`studio.model.badge.${badge}`)}
          </Badge>
        ))}
      </span>
    ),
    description: (
      <span className="grid gap-1.5">
        <span className="line-clamp-3 text-xs leading-5 text-muted">
          {model.description[locale]}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1 font-medium text-foreground tabular-nums">
            <Coins aria-hidden="true" className="size-3.5 text-brand" />
            {priceLine(model, i18n)}
          </span>
          {model.available ? null : (
            <span className="inline-flex items-center gap-1 font-medium text-warning">
              <TriangleAlert aria-hidden="true" className="size-3.5" />
              {t('studio.model.notConfigured')}
            </span>
          )}
        </span>
      </span>
    ),
  }));

  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      appearance="card"
      options={options}
      value={value ?? ''}
      onValueChange={onChange}
    />
  );
}
