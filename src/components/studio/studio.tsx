'use client';

import { useState } from 'react';
import { GenerationConfirm, MediaViewer } from '@/components/generations';
import { useMediaQuery } from '@/lib/generations/use-media-query';
import { useI18n } from '@/lib/i18n/client';
import { isTool } from '@/lib/tools';
import { Button } from '../ui/button';
import { Sheet } from '../ui/sheet';
import { Tabs, TabsContent } from '../ui/tabs';
import { Canvas } from './canvas';
import { Composer } from './composer';
import { GenerateBar } from './generate-bar';
import type { StudioPrefill } from './prefill';
import { ImageSection, OptionsSections, PromptSection } from './sections';
import { StudioSkeleton } from './studio-skeleton';
import { ToolTabs } from './tool-tabs';
import { useStudio } from './use-studio';

/** Below this width the controls move into a sheet and the prompt sits above the tab bar. */
const DESKTOP_QUERY = '(min-width: 64rem)';

function Workspace({ prefill, desktop }: { prefill: StudioPrefill; desktop: boolean }) {
  const { t } = useI18n();
  const studio = useStudio(prefill);
  const { form, model, cost, setTool } = studio.form;
  const [settingsOpen, setSettingsOpen] = useState(false);

  const dialogs = (
    <>
      <GenerationConfirm
        confirmation={studio.confirmation}
        onConfirm={studio.confirm}
        onDismiss={studio.dismiss}
      />
      <MediaViewer
        generation={studio.viewer?.generation ?? null}
        index={studio.viewer?.index ?? 0}
        onIndexChange={studio.setViewerIndex}
        onClose={studio.closeViewer}
        handlers={studio.handlers}
        modelLabel={
          studio.viewer ? studio.modelLabel(studio.viewer.generation.modelId).label : undefined
        }
      />
    </>
  );
  const live = (
    <p role="status" aria-live="polite" className="sr-only">
      {studio.announcement}
    </p>
  );

  return (
    <Tabs
      appearance="pills"
      value={form.tool}
      onValueChange={(value) => {
        if (isTool(value)) setTool(value);
      }}
    >
      <h1 className="sr-only">{t('studio.title')}</h1>
      {live}
      {desktop ? (
        <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] xl:grid-cols-[25rem_minmax(0,1fr)]">
          <aside
            aria-label={t('studio.controls')}
            className="flex flex-col border-e border-border bg-surface lg:sticky lg:top-[var(--topbar-height)] lg:h-[calc(100dvh-var(--topbar-height))]"
          >
            <div className="shrink-0 p-4 pb-3">
              <ToolTabs layout="grid" />
            </div>
            <TabsContent
              value={form.tool}
              tabIndex={-1}
              className="mt-0 flex min-h-0 flex-1 animate-none flex-col outline-none"
            >
              <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-6 overflow-y-auto px-4 pt-2 pb-6">
                <PromptSection studio={studio} variant="panel" />
                <ImageSection studio={studio} variant="dropzone" />
                <OptionsSections studio={studio} />
              </div>
              <GenerateBar
                cost={cost}
                balance={studio.balance}
                busy={studio.busy}
                noModel={!model}
                onGenerate={(event) => studio.generate({ keyboard: event.detail === 0 })}
              />
            </TabsContent>
          </aside>
          <section aria-label={t('studio.canvas.title')} className="min-w-0 p-6">
            <Canvas studio={studio} />
          </section>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-var(--topbar-height)-var(--bottom-nav-height)-env(safe-area-inset-bottom))] flex-col">
          <div className="sticky top-[var(--topbar-height)] z-20 border-b border-border bg-background/90 px-3 py-2 backdrop-blur-md">
            <ToolTabs layout="row" />
          </div>
          <TabsContent
            value={form.tool}
            tabIndex={-1}
            className="mt-0 flex-1 animate-none px-4 pt-4 pb-6 outline-none"
          >
            <Canvas studio={studio} />
          </TabsContent>
          <Composer studio={studio} onOpenSettings={() => setSettingsOpen(true)} />
          <Sheet
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            side="bottom"
            title={t('studio.mobile.settingsTitle')}
            bodyClassName="grid grid-cols-1 content-start gap-6 py-4"
            footer={
              <Button fullWidth size="lg" onClick={() => setSettingsOpen(false)}>
                {t('studio.mobile.done')}
              </Button>
            }
          >
            <OptionsSections studio={studio} />
          </Sheet>
        </div>
      )}
      {dialogs}
    </Tabs>
  );
}

export interface StudioProps {
  /** What the URL asked for (`tool`, `model`, `prompt`, `input`). */
  prefill: StudioPrefill;
}

/**
 * The studio: controls on the left and results on the right on a wide screen; results first with a
 * prompt strip above the tab bar and the other controls in a sheet on a phone. The layout is picked
 * in the browser, so the first paint is a skeleton that suits both.
 */
export function Studio({ prefill }: StudioProps) {
  const desktop = useMediaQuery(DESKTOP_QUERY, true);
  if (desktop === null) return <StudioSkeleton />;
  return <Workspace prefill={prefill} desktop={desktop} />;
}
