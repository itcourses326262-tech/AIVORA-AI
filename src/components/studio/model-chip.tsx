'use client';

import { ChevronDown, Sparkles } from 'lucide-react';
import { useId, useState } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Sheet } from '../ui/sheet';
import { Button } from '../ui/button';
import { ModelPicker, priceLine } from './model-picker';
import type { StudioController } from './use-studio';

/**
 * One line above the phone's Generate button that names the model in use and its price. Tapping it
 * opens the list of models to choose from, so the choice is never buried in the settings sheet.
 */
export function ModelChip({ studio }: { studio: StudioController }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const headingId = `${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-models`;
  const { model, toolModels, setModel } = studio.form;
  const loading = studio.models.status === 'loading';

  const name = loading ? t('studio.model.loading') : (model?.label ?? t('studio.model.choose'));
  const price = model ? priceLine(model, i18n) : '';

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={loading}
        onClick={() => setOpen(true)}
        className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 text-start text-sm transition-colors hover:bg-surface-overlay focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
      >
        <Sparkles aria-hidden="true" className="size-4 shrink-0 text-brand" />
        <span className="shrink-0 text-muted">{t('studio.model.label')}:</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {name}
          {price ? <span className="font-normal text-muted"> · {price}</span> : null}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand">
          {t('studio.model.change')}
          <ChevronDown aria-hidden="true" className="size-3.5" />
        </span>
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        title={t('studio.model.chooseTitle')}
        bodyClassName="grid grid-cols-1 content-start gap-3 py-4"
        footer={
          <Button fullWidth size="lg" onClick={() => setOpen(false)}>
            {t('studio.mobile.done')}
          </Button>
        }
      >
        <span id={headingId} className="sr-only">
          {t('studio.model.label')}
        </span>
        <ModelPicker
          labelledBy={headingId}
          state={studio.models}
          models={toolModels}
          value={model?.id ?? null}
          onChange={(modelId) => {
            setModel(modelId);
            setOpen(false);
          }}
          onRetry={studio.models.reload}
        />
      </Sheet>
    </>
  );
}
