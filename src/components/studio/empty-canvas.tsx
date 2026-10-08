'use client';

import { Sparkles } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

export interface EmptyCanvasProps {
  /** Example prompts of the current tool, in the active language. */
  examples: readonly string[];
  onPick: (prompt: string) => void;
  className?: string;
}

/** The first-run canvas: an invitation and a handful of ideas that fill the prompt when picked. */
export function EmptyCanvas({ examples, onPick, className }: EmptyCanvasProps) {
  const { t } = useI18n();
  return (
    <div
      className={cn(
        'relative isolate overflow-hidden rounded-3xl border border-border bg-surface px-5 py-10 text-center sm:px-6 sm:py-14 xl:px-10',
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-aurora opacity-90" />
      <span
        aria-hidden="true"
        className="mx-auto mb-5 flex size-16 items-center justify-center rounded-3xl bg-primary-gradient text-primary-foreground shadow-glow"
      >
        <Sparkles className="size-8" />
      </span>
      <h3 className="text-xl font-semibold text-foreground sm:text-2xl">
        {t('studio.canvas.empty.title')}
      </h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted sm:text-base">
        {t('studio.canvas.empty.description')}
      </p>
      <div className="@container mx-auto mt-8 grid max-w-2xl gap-2.5 text-start">
        <p className="text-center text-xs font-medium tracking-wide text-subtle">
          {t('studio.canvas.empty.examples')}
        </p>
        <ul className="grid gap-2 @lg:grid-cols-2">
          {examples.slice(0, 4).map((example) => (
            <li key={example}>
              <button
                type="button"
                dir="auto"
                onClick={() => onPick(example)}
                className="h-full w-full cursor-pointer rounded-xl border border-border bg-surface/80 p-3.5 text-start text-sm leading-6 text-muted backdrop-blur transition-[border-color,color,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong hover:text-foreground"
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
