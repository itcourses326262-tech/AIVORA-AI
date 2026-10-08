'use client';

import { CircleAlert, Dices, Sparkles, Undo2 } from 'lucide-react';
import { useLayoutEffect, useRef, type KeyboardEvent, type Ref } from 'react';
import type { Tool } from '@/lib/catalog/types';
import { charCount } from '@/lib/generations/format';
import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '@/lib/i18n/client';
import { cn, formatNumber } from '@/lib/utils';
import { Button } from '../ui/button';
import {
  CONTROL_BORDER,
  CONTROL_BORDER_INVALID,
  CONTROL_BOX,
  CONTROL_FOCUS,
} from '../ui/control-styles';
import { IconButton } from '../ui/icon-button';
import { useMergedRef } from '../ui/use-merged-ref';
import { exampleTitle } from './examples';
import type { PromptTools } from './use-prompt-tools';

const PLACEHOLDER_KEYS: Record<Tool, MessageKey> = {
  'text-to-image': 'studio.prompt.placeholder.textToImage',
  'image-to-image': 'studio.prompt.placeholder.imageToImage',
  'text-to-video': 'studio.prompt.placeholder.textToVideo',
  'image-to-video': 'studio.prompt.placeholder.imageToVideo',
};

export interface PromptFieldProps {
  /** Id of the textarea (the label and the error point at it). */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Ctrl+Enter or Cmd+Enter. */
  onSubmit: () => void;
  tool: Tool;
  /** The longest prompt the chosen model takes. */
  maxChars: number | undefined;
  /** Why the prompt cannot be used, in words. */
  error?: string | null;
  tools: PromptTools;
  /** `panel`: the roomy field of the side panel; `composer`: the compact one above a phone's tab bar. */
  variant: 'panel' | 'composer';
  textareaRef?: Ref<HTMLTextAreaElement>;
}

function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Measured after every render: the text may also change from outside (an example, Undo).
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);
  return ref;
}

/**
 * The prompt: a textarea with a character counter against the model's limit, Enhance (with Undo),
 * "Surprise me" and example chips. Ctrl/Cmd+Enter sends.
 */
export function PromptField({
  id,
  value,
  onChange,
  onSubmit,
  tool,
  maxChars,
  error,
  tools,
  variant,
  textareaRef,
}: PromptFieldProps) {
  const { t, locale } = useI18n();
  const growRef = useAutoGrow(value);
  const errorId = `${id}-error`;
  const noteId = `${id}-note`;
  const countId = `${id}-count`;
  const length = charCount(value);
  const over = maxChars !== undefined && length > maxChars;
  const near = maxChars !== undefined && length > maxChars * 0.9;
  const panel = variant === 'panel';

  const setRefs = useMergedRef(growRef, textareaRef);

  // Undo removes its own button, so focus goes back to the text it restored.
  const undo = () => {
    tools.undo();
    growRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      onSubmit();
    }
  };

  const enhanceButton = panel ? (
    <Button
      size="sm"
      variant="ghost"
      startIcon={<Sparkles aria-hidden="true" className="text-brand" />}
      loading={tools.enhancing}
      title={t('studio.prompt.enhanceTitle')}
      onClick={() => void tools.enhance()}
    >
      {tools.enhancing ? t('studio.prompt.enhancing') : t('studio.prompt.enhance')}
    </Button>
  ) : (
    <IconButton
      label={t('studio.prompt.enhance')}
      loading={tools.enhancing}
      onClick={() => void tools.enhance()}
    >
      <Sparkles className="text-brand" />
    </IconButton>
  );

  const counter =
    maxChars === undefined ? null : (
      <span
        id={countId}
        className={cn(
          'ms-auto shrink-0 text-xs tabular-nums',
          over ? 'font-medium text-danger' : near ? 'text-warning' : 'text-subtle',
        )}
      >
        <span aria-hidden="true">
          {formatNumber(length, locale)} / {formatNumber(maxChars, locale)}
        </span>
        <span className="sr-only">
          {t('common.form.characterCount', { count: length, max: maxChars })}
        </span>
      </span>
    );

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex min-h-6 items-center justify-between gap-2">
        {panel ? (
          <label htmlFor={id} className="text-sm font-semibold text-foreground">
            {t('studio.prompt.label')}
          </label>
        ) : null}
        {panel ? (
          <Button
            size="sm"
            variant="ghost"
            className="-me-2 h-7"
            startIcon={<Dices aria-hidden="true" />}
            title={t('studio.prompt.surpriseTitle')}
            onClick={tools.surprise}
          >
            {t('studio.prompt.surprise')}
          </Button>
        ) : null}
      </div>

      <div
        className={cn(
          CONTROL_BOX,
          error || over ? CONTROL_BORDER_INVALID : CONTROL_BORDER,
          CONTROL_FOCUS,
          'flex flex-col',
          !panel && 'min-h-11 flex-row items-end',
        )}
      >
        <textarea
          id={id}
          ref={setRefs}
          rows={panel ? 5 : 1}
          value={value}
          dir="auto"
          aria-label={panel ? undefined : t('studio.prompt.label')}
          aria-invalid={error || over ? true : undefined}
          aria-describedby={
            [error ? errorId : null, panel && counter ? countId : null, noteId]
              .filter(Boolean)
              .join(' ') || undefined
          }
          placeholder={t(PLACEHOLDER_KEYS[tool])}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            'block w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-subtle',
            panel ? 'max-h-72 min-h-28 px-3 pt-2.5 pb-1' : 'max-h-32 min-h-11 flex-1 px-3 py-2.5',
          )}
        />
        {panel ? (
          <div className="flex items-center gap-1 px-1.5 pb-1.5">
            {enhanceButton}
            {tools.improved ? (
              <Button
                size="sm"
                variant="ghost"
                startIcon={<Undo2 aria-hidden="true" />}
                onClick={undo}
              >
                {t('studio.prompt.undo')}
              </Button>
            ) : null}
            {counter}
          </div>
        ) : (
          <div className="flex items-center gap-0.5 p-1">
            {enhanceButton}
            <IconButton label={t('studio.prompt.surprise')} onClick={tools.surprise}>
              <Dices />
            </IconButton>
          </div>
        )}
      </div>

      {error ? (
        <p id={errorId} role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <div id={noteId} role="status" aria-live="polite">
        {tools.improved ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Sparkles aria-hidden="true" className="size-3.5 text-brand" />
            <span>
              {t('studio.prompt.enhanced')}
              {tools.improved.translated ? ` ${t('studio.prompt.translated')}` : ''}
            </span>
            {!panel ? (
              <button
                type="button"
                onClick={undo}
                className="font-medium text-brand underline-offset-4 hover:underline"
              >
                {t('studio.prompt.undo')}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {panel && value.trim() === '' ? (
        <div className="grid grid-cols-1 gap-1.5">
          <p className="text-xs text-muted">{t('studio.prompt.examples')}</p>
          <ul className="flex flex-wrap gap-1.5">
            {tools.examples.slice(0, 4).map((example) => (
              <li key={example} className="max-w-full min-w-0">
                <button
                  type="button"
                  dir="auto"
                  title={example}
                  onClick={() => onChange(example)}
                  className="max-w-full cursor-pointer truncate rounded-full border border-border bg-surface px-3 py-1.5 text-start text-xs text-muted transition-colors duration-150 hover:border-border-strong hover:text-foreground pointer-coarse:py-2.5"
                >
                  {exampleTitle(example)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
