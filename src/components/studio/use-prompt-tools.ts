'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Kind, Tool } from '@/lib/catalog/types';
import { enhancePrompt } from '@/lib/generations/api';
import { errorMessage } from '@/components/ui/error-message';
import { toast } from '@/components/ui/toast';
import { useI18n } from '@/lib/i18n/client';
import { examplesFor, randomExample } from './examples';

export interface PromptToolsOptions {
  tool: Tool;
  kind: Kind;
  prompt: string;
  /** The longest prompt the chosen model takes; an improved prompt is cut to fit. */
  maxChars: number | undefined;
  setPrompt: (prompt: string) => void;
}

export interface PromptTools {
  examples: string[];
  surprise: () => void;
  enhance: () => Promise<void>;
  enhancing: boolean;
  /** Present while the prompt on screen is exactly the improved one. */
  improved: { translated: boolean } | null;
  undo: () => void;
}

function fit(text: string, max: number | undefined): string {
  if (max === undefined) return text;
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const cut = chars.slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.7 ? cut.slice(0, space) : cut).trimEnd();
}

/** Example prompts, "Surprise me", and the enhance / undo pair of the prompt box. */
export function usePromptTools({
  tool,
  kind,
  prompt,
  maxChars,
  setPrompt,
}: PromptToolsOptions): PromptTools {
  const { t, locale } = useI18n();
  const examples = useMemo(() => examplesFor(t, tool), [t, tool]);
  const [enhancing, setEnhancing] = useState(false);
  const [result, setResult] = useState<{
    original: string;
    improved: string;
    translated: boolean;
  } | null>(null);
  const run = useRef<AbortController | null>(null);

  useEffect(() => () => run.current?.abort(), []);

  const surprise = useCallback(() => {
    const next = randomExample(examples, prompt);
    if (next) setPrompt(next);
  }, [examples, prompt, setPrompt]);

  const enhance = useCallback(async () => {
    const draft = prompt.trim();
    if (draft === '') {
      toast.info(t('studio.prompt.enhanceNeedsText'), { id: 'enhance-needs-text' });
      return;
    }
    run.current?.abort();
    const controller = new AbortController();
    run.current = controller;
    setEnhancing(true);
    try {
      const response = await enhancePrompt({ prompt: draft, kind, locale }, controller.signal);
      if (controller.signal.aborted) return;
      const improved = fit(response.prompt, maxChars);
      setResult({ original: prompt, improved, translated: response.translated });
      setPrompt(improved);
    } catch (error) {
      if (controller.signal.aborted) return;
      toast.error(t('studio.prompt.enhance'), { description: errorMessage(t, error) });
    } finally {
      if (run.current === controller) {
        run.current = null;
        setEnhancing(false);
      }
    }
  }, [prompt, kind, locale, maxChars, setPrompt, t]);

  const undo = useCallback(() => {
    if (!result) return;
    setPrompt(result.original);
    setResult(null);
  }, [result, setPrompt]);

  const improved = result && prompt === result.improved ? { translated: result.translated } : null;
  return { examples, surprise, enhance, enhancing, improved, undo };
}
