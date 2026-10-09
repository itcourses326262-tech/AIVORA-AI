'use client';

import { SlidersHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { useI18n } from '@/lib/i18n/client';
import { Button } from '../ui/button';
import { CreditNotice, GenerateButton } from './generate-bar';
import { ModelChip } from './model-chip';
import { ImageSection, PromptSection } from './sections';
import type { StudioController } from './use-studio';

/**
 * Toasts float above the tab bar by `--shell-bottom-inset`; while the composer is there they must
 * clear it as well, or they would cover the prompt and the Generate button.
 */
function useToastInset(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const body = document.body;
    const apply = () =>
      body.style.setProperty(
        '--shell-bottom-inset',
        `calc(var(--bottom-nav-height) + env(safe-area-inset-bottom) + ${element.offsetHeight}px)`,
      );
    apply();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      body.style.removeProperty('--shell-bottom-inset');
    };
  }, [ref]);
}

export interface ComposerProps {
  studio: StudioController;
  onOpenSettings: () => void;
}

/**
 * The phone's control strip, pinned above the tab bar: the picture to start from (image tools), the
 * prompt, the model in use (one tap to change it), and the Generate button. Everything else is one tap away in the settings sheet.
 */
export function Composer({ studio, onOpenSettings }: ComposerProps) {
  const { t } = useI18n();
  const { cost, model } = studio.form;
  const strip = useRef<HTMLDivElement>(null);
  useToastInset(strip);
  return (
    <div
      ref={strip}
      className="sticky bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] z-20 grid grid-cols-1 gap-2 border-t border-border bg-surface/95 px-3 pt-3 pb-3 backdrop-blur-md"
    >
      <ImageSection studio={studio} variant="compact" />
      <PromptSection studio={studio} variant="composer" />
      <ModelChip studio={studio} />
      <CreditNotice
        compact
        status={{
          cost,
          balance: studio.balance,
          signedOut: studio.signedOut,
          unconfirmed: studio.emailUnconfirmed,
        }}
        loginHref={studio.loginHref}
      />
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="lg"
          className="shrink-0 px-4"
          startIcon={<SlidersHorizontal aria-hidden="true" />}
          onClick={onOpenSettings}
        >
          {t('studio.mobile.settings')}
        </Button>
        <div className="min-w-0 flex-1">
          <GenerateButton
            cost={cost}
            balance={studio.balance}
            signedOut={studio.signedOut}
            unconfirmed={studio.emailUnconfirmed}
            busy={studio.busy}
            noModel={!model}
            onGenerate={(event) => studio.generate({ keyboard: event.detail === 0 })}
          />
        </div>
      </div>
    </div>
  );
}
