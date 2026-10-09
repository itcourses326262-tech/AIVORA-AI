'use client';

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/ui/radio-group';
import { CodeWindow, type CodeWindowLabels } from './code-window';
import {
  readCodeLanguage,
  subscribeToCodeLanguage,
  writeCodeLanguage,
} from './code-language-storage';
import {
  DEFAULT_QUICKSTART_LANGUAGE,
  QUICKSTART_LANGUAGES,
  isQuickstartLanguage,
  type QuickstartLanguage,
} from './snippets';
import type { CodeLine } from './tokenize';

interface CodeLanguageValue {
  language: QuickstartLanguage;
  setLanguage: (language: QuickstartLanguage) => void;
}

const CodeLanguageContext = createContext<CodeLanguageValue | null>(null);

function useCodeLanguage(): CodeLanguageValue {
  const value = useContext(CodeLanguageContext);
  if (!value)
    throw new Error('Code language components must be used inside <CodeLanguageProvider>');
  return value;
}

/**
 * The language of every example in the quickstart. Choosing one switches all of them at once and
 * is remembered on this device for the next visit. The server (and the hydrating render) show the
 * default; a saved choice replaces it right after hydration.
 */
export function CodeLanguageProvider({ children }: { children: ReactNode }) {
  const language = useSyncExternalStore(
    subscribeToCodeLanguage,
    readCodeLanguage,
    () => DEFAULT_QUICKSTART_LANGUAGE,
  );
  const value = useMemo<CodeLanguageValue>(
    () => ({ language, setLanguage: writeCodeLanguage }),
    [language],
  );
  return <CodeLanguageContext.Provider value={value}>{children}</CodeLanguageContext.Provider>;
}

const LANGUAGE_NAMES: Record<QuickstartLanguage, string> = {
  bash: 'cURL',
  javascript: 'JavaScript',
  python: 'Python',
};

/** Product names, not words: they read the same in every language. */
const WINDOW_TITLES: Record<QuickstartLanguage, string> = {
  bash: 'cURL',
  javascript: 'JavaScript (fetch)',
  python: 'Python (requests)',
};

export function LanguagePicker({ label }: { label: string }) {
  const { language, setLanguage } = useCodeLanguage();
  return (
    <SegmentedControl
      aria-label={label}
      value={language}
      onValueChange={(next) => {
        if (isQuickstartLanguage(next)) setLanguage(next);
      }}
      options={QUICKSTART_LANGUAGES.map((value) => ({ value, label: LANGUAGE_NAMES[value] }))}
    />
  );
}

export interface LanguageSample {
  lines: readonly CodeLine[];
  text: string;
}

export interface LanguageCodeProps {
  samples: Record<QuickstartLanguage, LanguageSample>;
  /** Names the example for assistive technology, e.g. the step it belongs to. */
  scope: string;
  labels: CodeWindowLabels;
}

/** One example, shown in the language the reader chose. */
export function LanguageCode({ samples, scope, labels }: LanguageCodeProps) {
  const { language } = useCodeLanguage();
  const sample = samples[language];
  return (
    <CodeWindow
      lines={sample.lines}
      text={sample.text}
      title={WINDOW_TITLES[language]}
      scope={scope}
      labels={labels}
    />
  );
}
