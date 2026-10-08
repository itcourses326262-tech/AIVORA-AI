'use client';

import { CircleAlert } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { getTool, toolNeedsImage } from '@/lib/tools';
import { useI18n } from '@/lib/i18n/client';
import { ImageInputField } from './image-input';
import { ControlSection } from './control-section';
import { ModelPicker } from './model-picker';
import { AspectPicker, CountStepper, DurationControl, ResolutionControl } from './option-controls';
import { AdvancedOptions } from './advanced-options';
import { showsAspect } from './form';
import { PromptField } from './prompt-field';
import type { StudioController } from './use-studio';
import { Skeleton } from '../ui/skeleton';
import { Switch } from '../ui/switch';

/** The sentence under a control whose value the server or the form refused. */
function FieldNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export interface PromptSectionProps {
  studio: StudioController;
  variant: 'panel' | 'composer';
}

/** The prompt box wired to the studio. */
export function PromptSection({ studio, variant }: PromptSectionProps) {
  const { form, model } = studio.form;
  const id = useId();
  return (
    <PromptField
      id={`prompt-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`}
      value={form.prompt}
      onChange={studio.setPrompt}
      onSubmit={() => studio.generate({ keyboard: true })}
      tool={form.tool}
      maxChars={model?.limits.maxPromptChars}
      error={studio.messages.prompt}
      tools={studio.promptTools}
      variant={variant}
      textareaRef={studio.promptRef}
    />
  );
}

/** The input-image control of the image tools (nothing for the text tools). */
export function ImageSection({
  studio,
  variant,
}: {
  studio: StudioController;
  variant: 'dropzone' | 'compact';
}) {
  const { t } = useI18n();
  if (!toolNeedsImage(studio.form.form.tool)) return null;
  const field = (
    <ImageInputField input={studio.image} variant={variant} error={studio.messages.inputAssetId} />
  );
  if (variant === 'compact') return field;
  return <ControlSection title={t('studio.image.label')}>{field}</ControlSection>;
}

function OptionsSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-5">
      <Skeleton className="h-14 rounded-xl" />
      <Skeleton className="h-10 rounded-xl" />
    </div>
  );
}

/** Model, shape, count, duration, resolution, advanced options and the share switch. */
export function OptionsSections({ studio }: { studio: StudioController }) {
  const { t } = useI18n();
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { form, model, toolModels, patch, setModel } = studio.form;
  const { limits } = model ?? {};
  const needsImage = toolNeedsImage(form.tool);
  const kind = getTool(form.tool)?.kind ?? 'image';

  return (
    <>
      <ControlSection title={t('studio.model.label')} labelId={`${base}-model`}>
        <ModelPicker
          labelledBy={`${base}-model`}
          state={studio.models}
          models={toolModels}
          value={model?.id ?? null}
          onChange={setModel}
          onRetry={studio.models.reload}
        />
        <FieldNote>{studio.messages.modelId}</FieldNote>
      </ControlSection>

      {studio.models.status === 'loading' ? <OptionsSkeleton /> : null}

      {model && limits ? (
        <>
          {showsAspect(model, form.tool) ? (
            <ControlSection title={t('studio.aspect.label')} labelId={`${base}-aspect`}>
              <AspectPicker
                labelledBy={`${base}-aspect`}
                ratios={limits.aspectRatios}
                value={form.aspectRatio}
                onChange={(aspectRatio) => patch({ aspectRatio })}
              />
              <FieldNote>{studio.messages.aspectRatio}</FieldNote>
            </ControlSection>
          ) : needsImage ? (
            <p className="rounded-xl border border-border bg-surface-raised px-3.5 py-2.5 text-sm text-muted">
              {t('studio.image.followsAspect')}
            </p>
          ) : null}

          {kind === 'image' && limits.maxCount > 1 ? (
            <ControlSection title={t('studio.count.label')} labelId={`${base}-count`}>
              <CountStepper
                labelledBy={`${base}-count`}
                value={form.count ?? limits.defaultCount}
                max={limits.maxCount}
                onChange={(count) => patch({ count })}
              />
              <FieldNote>{studio.messages.count}</FieldNote>
            </ControlSection>
          ) : null}

          {limits.durations && limits.durations.length > 1 ? (
            <ControlSection title={t('studio.video.duration')} labelId={`${base}-duration`}>
              <DurationControl
                labelledBy={`${base}-duration`}
                durations={limits.durations}
                value={form.durationSec}
                onChange={(durationSec) => patch({ durationSec })}
              />
              <FieldNote>{studio.messages.durationSec}</FieldNote>
            </ControlSection>
          ) : null}

          {limits.resolutions && limits.resolutions.length > 1 ? (
            <ControlSection title={t('studio.video.resolution')} labelId={`${base}-resolution`}>
              <ResolutionControl
                labelledBy={`${base}-resolution`}
                resolutions={limits.resolutions}
                value={form.resolution}
                onChange={(resolution) => patch({ resolution })}
              />
              <FieldNote>{studio.messages.resolution}</FieldNote>
            </ControlSection>
          ) : null}

          <AdvancedOptions
            model={model}
            withStrength={needsImage}
            values={{
              negativePrompt: form.negativePrompt,
              seed: form.seed,
              strength: form.strength ?? 0.6,
            }}
            onChange={(next) => patch(next)}
            errors={{
              negativePrompt: studio.messages.negativePrompt,
              seed: studio.messages.seed,
              strength: studio.messages.strength,
            }}
          />

          <Switch
            checked={form.isPublic}
            onCheckedChange={(isPublic) => patch({ isPublic })}
            label={t('studio.share.label')}
            description={t('studio.share.hint')}
          />
        </>
      ) : null}
    </>
  );
}
